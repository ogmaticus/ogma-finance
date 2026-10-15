import { budgetOfBytes } from "./budget-size-fixture.mjs";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
globalThis.FinanceData = (await import("../public/data-model.js")).FinanceData;
import vm from "./test-vm.mjs";
import ts from "typescript";
import { Miniflare } from "miniflare";
const bodyModule =
  "data:text/javascript;base64," +
  Buffer.from(
    ts.transpileModule(readFileSync("server/request-body.ts", "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
    }).outputText,
  ).toString("base64");
const { BudgetSchema } = await import("../public/budget-schema.js");
const apiSource = ts
  .transpileModule(readFileSync("server/budget.ts", "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  })
  .outputText.replace(
    /from ["'](\.\.?\/[^"']+)["']/g,
    (_all, path) =>
      "from " +
      JSON.stringify(
        path.endsWith("request-body")
          ? bodyModule
          : new URL(path, new URL("../server/budget.ts", import.meta.url)).href,
      ),
  );
const api = await import(
  "data:text/javascript;base64," + Buffer.from(apiSource).toString("base64")
);
const mf = new Miniflare({
  modules: true,
  script: 'export default {fetch(){return new Response("test")}}',
  compatibilityDate: "2026-05-15",
  d1Databases: { DB: "test-budget" },
  r2Buckets: ["BUCKET"],
});
try {
  const DB = await mf.getD1Database("DB"),
    BUCKET = await mf.getR2Bucket("BUCKET"),
    env = { DB, BUCKET };
  for (const file of readdirSync("drizzle")
    .filter((file) => file.endsWith(".sql"))
    .sort())
    for (const sql of readFileSync("drizzle/" + file, "utf8").split("--> statement-breakpoint"))
      await DB.prepare(sql).run();
  const userA = { userId: "alice" },
    userB = { userId: "bob" },
    origin = "https://finance.example";
  const budget = {
    accounts: [{ id: "card", name: "Карта 2264", opening: 10000, last4: "2264" }],
    ops: [
      {
        id: "op-1",
        name: "Покупка",
        amount: 200,
        type: "expense",
        date: "2026-07-27",
        account: "card",
        category: "Кафе",
        rawCategory: "Фастфуд",
        customField: "keep",
      },
    ],
    goals: [],
    limits: { Кафе: 2000 },
    budgetsByMonth: { "2026-07": { Кафе: 1800 }, "2026-08": {} },
    categories: ["Кафе"],
    merchantRules: [{ key: "ekspress", category: "Кафе" }],
    futureField: { preserved: true },
  };
  const request = (path, method = "GET", data) =>
    new Request(origin + path, {
      method,
      headers: { Origin: origin, "Content-Type": "application/json", "X-Finance-Schema": "3" },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
  const call = (handler, req, user) => api.safeResponse(() => handler(req, user, env));
  const smallBudget = budgetOfBytes(1850000),
    largeBudget = budgetOfBytes(1950000);
  assert.equal(
    (
      await call(
        api.handleBudget,
        request("/api/budget", "PUT", { revision: 0, data: smallBudget }),
        { userId: "size-test" },
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await call(
        api.handleBudget,
        request("/api/budget", "PUT", { revision: 1, data: smallBudget }),
        { userId: "size-test" },
      )
    ).status,
    200,
    "1.85MB budget and snapshot both save",
  );
  const rejected = await call(
    api.handleBudget,
    request("/api/budget", "PUT", { revision: 2, data: largeBudget }),
    { userId: "size-test" },
  );
  assert.equal(rejected.status, 413);
  assert.match((await rejected.json()).error, /1 900 000/);
  assert.equal(
    (await (await call(api.handleBudget, request("/api/budget"), { userId: "size-test" })).json())
      .revision,
    2,
    "oversize rejection must not change saved revision",
  );
  for (const message of ["D1_ERROR: string or blob too big", "SQLITE_TOOBIG"]) {
    const response = await api.safeResponse(async () => {
      throw Error(message);
    });
    assert.equal(response.status, 413);
    assert.match((await response.json()).error, /1 900 000/);
  }
  assert.equal((await call(api.handleBudget, request("/api/budget"), null)).status, 401);
  assert.deepEqual(await (await call(api.handleBudget, request("/api/budget"), userB)).json(), {
    revision: 0,
    data: null,
    updatedAt: null,
    generation: 0,
    deleting: false,
  });
  const switched = request("/api/budget", "PUT", { revision: 0, data: budget });
  switched.headers.set("X-Finance-Owner", "alice");
  assert.equal((await call(api.handleBudget, switched, userB)).status, 401);
  assert.equal(
    (
      await call(
        api.handleBudget,
        request("/api/budget", "PUT", { revision: 0, data: budget }),
        userA,
      )
    ).status,
    200,
  );
  assert.deepEqual(
    (await (await call(api.handleBudget, request("/api/budget"), userA)).json()).data,
    BudgetSchema.parse(budget),
  );
  assert.equal(
    (
      await call(
        api.handleBudget,
        request("/api/budget", "PUT", { revision: 0, data: budget }),
        userA,
      )
    ).status,
    409,
  );
  const oldRequest = request("/api/budget");
  oldRequest.headers.delete("X-Finance-Schema");
  const oldView = await (await call(api.handleBudget, oldRequest, userA)).json();
  assert.equal(oldView.data.schemaVersion, 2);
  assert.equal(oldView.data.ops[0].amount, 200);
  assert.equal(oldView.data.ops[0].amountMinor, undefined);
  for (const [handler, path, limit] of [
    [api.handleBudget, "/api/budget", 1965536],
    [api.handleFiles, "/api/files", 11 * 1024 * 1024],
  ]) {
    let cancelled = false;
    const stream = new ReadableStream({
      pull(controller) {
        controller.enqueue(new Uint8Array(1024 * 1024));
      },
      cancel() {
        cancelled = true;
      },
    });
    const oversized = new Request(origin + path, {
      method: handler === api.handleBudget ? "PUT" : "POST",
      headers: { Origin: origin, "Content-Type": "application/json", "X-Finance-Schema": "3" },
      body: stream,
      duplex: "half",
    });
    assert.equal((await call(handler, oversized, userA)).status, 413);
    assert.equal(cancelled, true);
  }
  const priorLog = console.error,
    logs = [];
  console.error = (value) => logs.push(value);
  try {
    assert.equal(
      (
        await api.safeResponse(async () => {
          throw Error(
            "D1_ERROR: database failure alice@example.test SELECT data FROM budget_documents",
          );
        }, request("/api/budget"))
      ).status,
      503,
    );
  } finally {
    console.error = priorLog;
  }
  const log = JSON.parse(logs[0]);
  assert.equal(log.route, "/api/budget");
  assert.equal(log.method, "GET");
  assert.ok(log.requestId);
  assert.ok(log.message.includes("database failure"));
  assert.ok(!log.message.includes("alice@example.test"));
  assert.ok(!log.message.includes("SELECT data"));
  const next = { ...budget, ops: [...budget.ops, { ...budget.ops[0], id: "op-2", amount: 849 }] };
  const concurrent = await Promise.all([
    call(api.handleBudget, request("/api/budget", "PUT", { revision: 1, data: next }), userA),
    call(api.handleBudget, request("/api/budget", "PUT", { revision: 1, data: budget }), userA),
  ]);
  assert.deepEqual(concurrent.map((r) => r.status).sort(), [200, 409]);
  const backup = await (
    await call(api.handleBackups, request("/api/backups?revision=1"), userA)
  ).json();
  assert.deepEqual(backup.data, BudgetSchema.parse(budget));
  assert.equal(
    (await call(api.handleBackups, request("/api/backups?revision=1"), userB)).status,
    404,
  );
  assert.equal(
    (
      await call(
        api.handleBudget,
        new Request(origin + "/api/budget", {
          method: "PUT",
          headers: { Origin: "https://evil.example" },
          body: JSON.stringify({ revision: 2, data: budget }),
        }),
        userA,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await call(
        api.handleBudget,
        request("/api/budget", "PUT", {
          revision: 2,
          data: { ...budget, ops: [{ ...budget.ops[0], date: "2026-02-30" }] },
        }),
        userA,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await call(
        api.handleBudget,
        request("/api/budget", "PUT", {
          revision: 2,
          data: { ...budget, ops: [{ ...budget.ops[0], account: "missing" }] },
        }),
        userA,
      )
    ).status,
    400,
  );
  for (const budgetsByMonth of [
    { "2026-13": {} },
    { "2026-10": { Кафе: -1 } },
    { "2026-10": [] },
    JSON.parse('{"2026-10":{"__proto__":1}}'),
  ])
    assert.equal(
      (
        await call(
          api.handleBudget,
          request("/api/budget", "PUT", { revision: 2, data: { ...budget, budgetsByMonth } }),
          userA,
        )
      ).status,
      400,
    );
  assert.equal(
    (
      await call(
        api.handleBudget,
        request("/api/budget", "PUT", { revision: 2, data: backup.data, snapshot: true }),
        userA,
      )
    ).status,
    200,
  );
  assert.equal(
    (await (await call(api.handleBackups, request("/api/backups"), userA)).json()).versions.length,
    2,
  );
  const png = Uint8Array.from(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4oQAAAAASUVORK5CYII=",
      "base64",
    ),
  );
  const imageRequest = () => {
    const form = new FormData();
    form.append("file", new File([png], "screenshot.png", { type: "image/png" }));
    form.append("sourceId", "example-source");
    return new Request(origin + "/api/files", {
      method: "POST",
      headers: { Origin: origin },
      body: form,
    });
  };
  assert.equal((await call(api.handleFiles, imageRequest(), null)).status, 401);
  const savedResponse = await call(api.handleFiles, imageRequest(), userA);
  assert.equal(savedResponse.status, 200);
  const saved = await savedResponse.json();
  assert.ok(saved.id);
  assert.equal((await (await call(api.handleFiles, imageRequest(), userA)).json()).id, saved.id);
  assert.equal(
    (await (await call(api.handleFiles, request("/api/files"), userB)).json()).files.length,
    0,
  );
  assert.equal(
    (
      await api.safeResponse(() =>
        api.handleFile(request("/api/files/" + saved.id), userB, env, saved.id),
      )
    ).status,
    404,
  );
  const downloaded = await api.safeResponse(() =>
    api.handleFile(request("/api/files/" + saved.id), userA, env, saved.id),
  );
  assert.equal(downloaded.status, 200);
  assert.deepEqual(new Uint8Array(await downloaded.arrayBuffer()), png);
  for (let i = 0; i < 105; i++)
    await DB.prepare(
      "INSERT INTO screenshot_files (id,owner,hash,object_key,name,mime,size,source_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
    )
      .bind(
        "page-" + String(i).padStart(3, "0"),
        "alice",
        "hash-" + i,
        "key-" + i,
        "image.png",
        "image/png",
        8,
        "source-" + i,
        "2026-10-14T00:00:00.000Z",
      )
      .run();
  const firstPage = await (await call(api.handleFiles, request("/api/files"), userA)).json();
  assert.equal(firstPage.files.length, 100);
  assert.ok(firstPage.nextCursor);
  const secondPage = await (
    await call(
      api.handleFiles,
      request("/api/files?cursor=" + encodeURIComponent(firstPage.nextCursor)),
      userA,
    )
  ).json();
  assert.equal(secondPage.files.length, 6);
  assert.equal(secondPage.nextCursor, null);
  assert.equal(new Set([...firstPage.files, ...secondPage.files].map((f) => f.id)).size, 106);
  assert.equal(
    (
      await (
        await call(
          api.handleFiles,
          request("/api/files?cursor=" + encodeURIComponent(firstPage.nextCursor)),
          userB,
        )
      ).json()
    ).files.length,
    0,
  );
  assert.equal((await call(api.handleFiles, request("/api/files?cursor=bad"), userA)).status, 400);
  // Lifecycle regressions use only isolated test identities.
  const retained = { userId: "retention" };
  assert.equal(
    (
      await call(
        api.handleBudget,
        request("/api/budget", "PUT", { revision: 0, data: budget }),
        retained,
      )
    ).status,
    200,
  );
  for (let revision = 1; revision <= 100; revision++)
    assert.equal(
      (
        await call(
          api.handleBudget,
          request("/api/budget", "PUT", { revision, data: budget }),
          retained,
        )
      ).status,
      200,
    );
  assert.equal(
    (await (await call(api.handleBackups, request("/api/backups"), retained)).json()).versions
      .length,
    1,
    "100 edits do not produce 100 snapshots",
  );
  await DB.prepare("UPDATE budget_versions SET created_at=? WHERE owner=?")
    .bind(new Date(Date.now() - 31 * 60000).toISOString(), "retention")
    .run();
  assert.equal(
    (
      await call(
        api.handleBudget,
        request("/api/budget", "PUT", { revision: 101, data: budget }),
        retained,
      )
    ).status,
    200,
  );
  assert.equal(
    (await (await call(api.handleBackups, request("/api/backups"), retained)).json()).versions
      .length,
    2,
    "30 minutes permit a periodic snapshot",
  );
  assert.equal(
    (
      await call(
        api.handleBudget,
        request("/api/budget", "PUT", { revision: 102, data: budget, snapshot: true }),
        retained,
      )
    ).status,
    200,
  );
  assert.equal(
    (await (await call(api.handleBackups, request("/api/backups"), retained)).json()).versions
      .length,
    3,
    "restore flag forces a snapshot",
  );
  await DB.prepare("DELETE FROM budget_versions WHERE owner=?").bind("retention").run();
  for (let month = 0; month < 15; month++) {
    const date = new Date();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() - month);
    for (let i = 0; i < 4; i++)
      await DB.prepare(
        "INSERT INTO budget_versions(owner,revision,data,created_at) VALUES (?,?,?,?)",
      )
        .bind("retention", 1000 + month * 4 + i, JSON.stringify(budget), date.toISOString())
        .run();
  }
  assert.equal(
    (
      await call(
        api.handleBudget,
        request("/api/budget", "PUT", { revision: 103, data: budget }),
        retained,
      )
    ).status,
    200,
  );
  const history = (
    await DB.prepare("SELECT revision,created_at FROM budget_versions WHERE owner=?")
      .bind("retention")
      .all()
  ).results;
  assert.ok(history.length <= 42);
  assert.ok(history.length > 30, "monthly history remains beyond last 30");
  const months = new Set(history.map((v) => v.created_at.slice(0, 7)));
  assert.equal(months.size, 12, "one snapshot kept for every month in the last year");
  const fileReq = (method, user, requestOverride) =>
    api.safeResponse(() =>
      api.handleFile(
        requestOverride || request("/api/files/" + saved.id, method),
        user,
        env,
        saved.id,
      ),
    );
  assert.equal((await fileReq("DELETE", userB)).status, 404);
  assert.equal(
    (
      await fileReq(
        "DELETE",
        userA,
        new Request(origin + "/api/files/" + saved.id, {
          method: "DELETE",
          headers: { Origin: "https://evil.example" },
        }),
      )
    ).status,
    403,
  );
  const withFile = { ...budget, ops: [{ ...budget.ops[0], screenshotId: saved.id }] };
  assert.equal(
    (
      await call(
        api.handleBudget,
        request("/api/budget", "PUT", { revision: 3, data: withFile }),
        userA,
      )
    ).status,
    200,
  );
  const objectKey = (
    await DB.prepare("SELECT object_key FROM screenshot_files WHERE id=?").bind(saved.id).first()
  ).object_key;
  assert.equal((await fileReq("DELETE", userA)).status, 200);
  assert.equal(await BUCKET.get(objectKey), null);
  const withoutFile = await (await call(api.handleBudget, request("/api/budget"), userA)).json();
  assert.equal(withoutFile.data.ops[0].screenshotId, undefined);
  assert.ok(withoutFile.data.removedScreenshotIds[saved.id]);
  assert.equal((await fileReq("GET", userA)).status, 404);
  assert.equal(
    globalThis.FinanceData.merge(withFile, withoutFile.data).ops[0].screenshotId,
    undefined,
    "stale merge cannot restore a deleted image link",
  );
  assert.equal((await call(api.handleBudget, request("/api/budget", "DELETE"), userA)).status, 200);
  assert.equal(
    (await (await call(api.handleBudget, request("/api/budget"), userA)).json()).data,
    null,
  );
  for (const table of ["budget_documents", "budget_versions", "screenshot_files"])
    assert.equal(
      (
        await DB.prepare("SELECT COUNT(*) AS count FROM " + table + " WHERE owner=?")
          .bind("alice")
          .first()
      ).count,
      0,
    );
  assert.equal(
    (
      await call(
        api.handleBudget,
        request("/api/budget", "PUT", { revision: 0, data: budget }),
        userA,
      )
    ).status,
    409,
    "old-device write blocked even when revision is zero",
  );
  assert.equal(
    (await call(api.handleFiles, imageRequest(), userA)).status,
    409,
    "old-device screenshot upload blocked",
  );
  assert.equal(
    (await (await call(api.handleBudget, request("/api/budget"), retained)).json()).revision,
    104,
    "another user is untouched",
  );
  const fresh = request("/api/budget", "PUT", { revision: 0, data: budget });
  fresh.headers.set("X-Finance-Generation", "1");
  assert.equal(
    (await call(api.handleBudget, fresh, userA)).status,
    200,
    "new budget starts in the new generation",
  );
  const racing = { userId: "race" };
  let raceKey;
  const raceEnv = {
    DB,
    BUCKET: {
      put: async (key, ...args) => {
        raceKey = key;
        await BUCKET.put(key, ...args);
        assert.equal(
          (await call(api.handleBudget, request("/api/budget", "DELETE"), racing)).status,
          200,
        );
      },
      delete: (...args) => BUCKET.delete(...args),
    },
  };
  assert.equal(
    (await api.safeResponse(() => api.handleFiles(imageRequest(), racing, raceEnv))).status,
    409,
  );
  assert.equal(
    await BUCKET.get(raceKey),
    null,
    "in-flight upload is cleaned after a remote deletion",
  );
  assert.equal(
    (
      await DB.prepare("SELECT COUNT(*) AS count FROM screenshot_files WHERE owner=?")
        .bind("race")
        .first()
    ).count,
    0,
  );
  console.log(
    "PASS: 100-save snapshot cap, timed/forced snapshots, 30 + 12-month retention, image deletion ownership/origin/references, full purge, stale-device and in-flight upload barriers",
  );
  console.log(
    "PASS: real D1/R2 isolation, concurrent writes, backups, budget preservation, date validation and screenshot archive",
  );
} finally {
  await mf.dispose();
}
const store = new Map(),
  calls = [];
const localStorage = {
  getItem: (k) => store.get(k) || null,
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
const context = vm.createContext({
  console,
  localStorage,
  structuredClone,
  Set,
  Map,
  Date,
  JSON,
  Blob,
  URL,
  AbortController,
  clearTimeout: () => {},
  setTimeout: () => 1,
  window: { addEventListener: () => {} },
  document: { querySelector: () => null },
  $: () => null,
  go: () => {},
  render: () => {},
  page: "Обзор",
  cats: [],
  db: null,
  fetch: async (path, options) => {
    calls.push({ path, options });
    return {
      ok: true,
      json: async () =>
        path === "/api/session"
          ? { user: { id: "alice", name: "Алиса", email: "a@example.com" } }
          : { revision: 0, data: null, updatedAt: null, generation: 0, deleting: false },
    };
  },
});
vm.runInContext(readFileSync("public/data-model.js", "utf8"), context);
vm.runInContext(
  readFileSync("public/sync-core.js", "utf8") + readFileSync("public/sync.js", "utf8"),
  context,
);
const legacy = {
  accounts: [{ id: "old", name: "Моя карта", opening: 55 }],
  ops: [],
  goals: [],
  limits: {},
  customValue: 123,
};
store.set("finance-prototype-v1", JSON.stringify(legacy));
await vm.runInContext("initializeCloud()", context);
assert.equal(
  calls.some((c) => c.options?.method === "PUT"),
  false,
  "no automatic demo/legacy upload",
);
assert.equal(vm.runInContext("db.accounts.length", context), 0, "new account starts empty");
assert.equal(store.get("finance-prototype-v1"), JSON.stringify(legacy), "old budget unchanged");
vm.runInContext(
  "db.accounts.push({id:'new',name:'Новая карта',opening:0});persistBudget(db)",
  context,
);
assert.equal(
  vm.runInContext("cloudState", context),
  "pending",
  "new changes save even before legacy import",
);
assert.equal(JSON.parse(store.get("finance-user-alice")).data.accounts.length, 1);
assert.equal(store.has("finance-user-bob"), false);
const merged = vm.runInContext(
  `mergeBudgets({accounts:[{id:'a',name:'Remote'}],ops:[{id:'o1'}],goals:[],limits:{A:1},categories:['A'],future:7},{accounts:[{id:'b',name:'Local'}],ops:[{id:'o2'}],goals:[],limits:{B:2},categories:['B'],custom:8})`,
  context,
);
assert.equal(merged.accounts.length, 2);
assert.equal(merged.ops.length, 2);
assert.equal(merged.future, 7);
assert.equal(merged.custom, 8);
console.log(
  "PASS: legacy preserved, no automatic import, per-user cache, merge preserves future fields and edits start syncing",
);

store.set("finance-user-alice", JSON.stringify({ data: legacy, revision: 1, dirty: true }));
context.fetch = async (path) => ({
  ok: true,
  json: async () =>
    path === "/api/session"
      ? { user: { id: "alice", name: "Алиса" } }
      : { revision: 2, data: { ...legacy, customValue: 999 }, updatedAt: "2026-10-13T12:00:00Z" },
});
await vm.runInContext("initializeCloud()", context);
assert.equal(vm.runInContext("cloudState", context), "conflict");
vm.runInContext("persistBudget(db)", context);
assert.equal(
  JSON.parse(store.get("finance-user-alice")).revision,
  1,
  "unresolved local edits retain base revision across reloads",
);
await vm.runInContext("initializeCloud()", context);
assert.equal(
  vm.runInContext("cloudState", context),
  "conflict",
  "reload cannot silently overwrite another device",
);
console.log("PASS: conflict remains protected after editing and reloading");

// Opening a remembered account offline must never authorize writes to a different account.
vm.runInContext(
  readFileSync("public/pwa.js", "utf8") + readFileSync("public/file-vault.js", "utf8"),
  context,
);
context.queuedUploads = 0;
vm.runInContext("uploadQueuedScreenshots=async()=>{queuedUploads++}", context);
context.navigator = { onLine: false };
store.set(
  "finance-offline-access",
  JSON.stringify({ enabled: true, user: { id: "alice", name: "Алиса" } }),
);
store.set("finance-user-alice", JSON.stringify({ data: legacy, revision: 1, dirty: true }));
vm.runInContext("cloudSession=null;cloudIdentityVerified=false", context);
await vm.runInContext("initializeCloud()", context);
assert.equal(vm.runInContext("db.customValue", context), undefined);
assert.equal(vm.runInContext("cloudIdentityVerified", context), false);
vm.runInContext("persistBudget(db)", context);
assert.equal(
  vm.runInContext("cloudState", context),
  "offline",
  "offline edits do not falsely show ongoing server save",
);
const before = calls.length;
await vm.runInContext("syncBudget()", context);
assert.equal(calls.length, before);
context.navigator.onLine = true;
const reconnectCalls = [];
context.fetch = async (path, options) => {
  reconnectCalls.push({ path, options });
  return {
    ok: true,
    json: async () =>
      path === "/api/session"
        ? { user: { id: "bob", name: "Боб" } }
        : {
            revision: 1,
            data: {
              ...legacy,
              accounts: [{ ...legacy.accounts[0], name: "bob-only" }],
              customValue: "bob-only",
            },
            updatedAt: "2026-10-13T12:00:00Z",
          },
  };
};
await vm.runInContext("reconnectCloud()", context);
assert.equal(vm.runInContext("db.accounts[0].name", context), "bob-only");
assert.equal(
  reconnectCalls.some((c) => c.options?.method === "PUT"),
  false,
  "alice budget must not upload to bob",
);
assert.equal(JSON.parse(store.get("finance-user-alice")).data.customValue, undefined);
assert.equal(store.get("finance-offline-access"), undefined);
console.log(
  "PASS: offline budget opens only after opt-in, account is rechecked on reconnect, switching users preserves local changes without uploading to another account",
);

assert.ok(
  context.queuedUploads > 0,
  "opening a signed-in budget resumes queued screenshot uploads",
);
