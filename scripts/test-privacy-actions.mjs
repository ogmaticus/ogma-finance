import assert from "node:assert/strict";
import vm from "./test-vm.mjs";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
const records = new Map(),
  storage = new Map(),
  nodes = new Map(),
  redirects = [];
const node = (id) => {
  if (!nodes.has(id))
    nodes.set(id, {
      open: false,
      inert: false,
      textContent: "",
      addEventListener() {},
      showModal() {
        this.open = true;
      },
      close() {
        this.open = false;
      },
    });
  return nodes.get(id);
};
const connection = {
  transaction() {
    const tx = {
      objectStore() {
        return {
          getAll() {
            const request = {};
            queueMicrotask(() => {
              request.result = [...records.values()];
              request.onsuccess?.();
            });
            return request;
          },
          delete(key) {
            records.delete(key);
            queueMicrotask(() => tx.oncomplete?.());
          },
        };
      },
    };
    return tx;
  },
};
const context = vm.createContext({
  console,
  Date,
  Map,
  Set,
  JSON,
  URL,
  Blob,
  AbortController,
  queueMicrotask,
  clearTimeout() {},
  setTimeout() {
    return 1;
  },
  localStorage: {
    getItem: (k) => storage.get(k) || null,
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k),
  },
  document: { querySelector: () => node("main"), getElementById: node },
  window: { addEventListener() {}, location: { assign: (url) => redirects.push(url) } },
  navigator: { onLine: true },
  $: (selector) => node(selector),
  db: null,
  cats: [],
  page: "Обзор",
  backupBusy: false,
  ocrBusy: false,
  importSaving: false,
  draft: [],
  ocrFiles: [],
  render() {},
  renderProfile() {},
  showNotice: async () => {},
  askConfirm: async () => true,
  askForm: async () => ({ confirmation: "УДАЛИТЬ" }),
  animateDialogClose: async (dialog) => dialog.close(),
  offlineAccess: () => JSON.parse(storage.get("finance-offline-access") || "null"),
  forgetOfflineAccess: () => storage.delete("finance-offline-access"),
});
for (const file of [
  "data-model.js",
  "sync-core.js",
  "sync.js",
  "file-vault.js",
  "record-actions.js",
  "privacy-ui.js",
])
  vm.runInContext(readFileSync("public/" + file, "utf8"), context);
context.connection = connection;
vm.runInContext("openVault=async()=>connection", context);
const run = (code) => vm.runInContext(code, context),
  json = (value) => JSON.parse(JSON.stringify(value));
const budget = {
  accounts: [
    { id: "a", name: "A", opening: 100 },
    { id: "b", name: "B", opening: 0 },
    { id: "c", name: "C", opening: 0 },
  ],
  ops: [
    {
      id: "expense",
      name: "Покупка",
      amount: 10,
      type: "expense",
      account: "a",
      date: "2026-10-14",
      category: "Кафе",
    },
    {
      id: "self",
      name: "Перевод",
      amount: 5,
      type: "transfer",
      account: "a",
      to: "b",
      date: "2026-10-14",
      category: "Перевод",
    },
    {
      id: "other",
      name: "Перевод",
      amount: 8,
      type: "transfer",
      account: "c",
      to: "a",
      date: "2026-10-14",
      category: "Перевод",
    },
  ],
  goals: [{ id: "goal", name: "Цель", target: 100, saved: 20, date: "2026-12-01" }],
  limits: {},
  accountAliases: { 2264: "a" },
};
context.budget = budget;
const moved = json(run("accountDeletionData(budget,'a','move','b')"));
assert.deepEqual(
  moved.accounts.filter((r) => !r.deletedAt).map((r) => r.id),
  ["b", "c"],
);
assert.equal(moved.ops.find((r) => r.id === "expense").account, "b");
assert.ok(moved.ops.find((r) => r.id === "self").deletedAt);
assert.equal(moved.ops.find((r) => r.id === "other").to, "b");
assert.equal(moved.accountAliases[2264], undefined);
assert.throws(() => run("accountDeletionData(budget,'a','move','a')"));
assert.equal(run("FinanceData.live(accountDeletionData(budget,'a','delete').ops).length"), 0);
assert.equal(
  run(
    "FinanceData.live(FinanceData.merge(budget,accountDeletionData(budget,'a','delete')).accounts).length",
  ),
  2,
);
run(
  "cloudSession={user:{id:'alice'},signOutUrl:'/signout'};cloudIdentityVerified=true;hydrateBudget(budget);save=(options)=>persistBudget(db,options);budgetOwner=()=>cloudSession?.user?.id||'guest'",
);
await run("deleteGoal('goal')");
assert.equal(run("liveRecords('goals').length"), 0);
assert.ok(run("db.goals[0].deletedAt"));
storage.set("finance-user-bob", "bob");
storage.set("finance-prototype-v1", "guest");
for (const key of [
  "finance-user-alice",
  "finance-user-alice-migrated",
  "finance-before-restore-alice",
  "finance-before-schema-alice",
])
  storage.set(key, "alice-private");
storage.set("finance-offline-access", JSON.stringify({ user: { id: "alice" } }));
records.set("a", { key: "a", owner: "alice", sourceId: "one", cloudFileId: null });
records.set("b", { key: "b", owner: "bob", sourceId: "two" });
records.set("g", { key: "g", owner: "guest", sourceId: "three" });
run("cloudDirty=false");
await run("openLogoutDialog()");
assert.equal(node("#logoutdialog").open, true, "unsent originals require logout choice");
assert.equal(redirects.length, 0);
run(
  "syncBudget=async()=>{};uploadQueuedScreenshots=async()=>{};retryScreenshotArchives=async()=>true;cloudDirty=true",
);
await run("logoutAccount('sync')");
assert.equal(redirects.length, 0, "failed sync must not log out");
assert.ok(records.has("a"));
assert.ok(node("#logouterror").textContent.includes("Не всё"));
await run("logoutAccount('discard')");
assert.deepEqual(redirects, ["/signout"]);
assert.equal(records.has("a"), false);
assert.ok(records.has("b") && records.has("g"));
for (const key of [
  "finance-user-alice",
  "finance-user-alice-migrated",
  "finance-before-restore-alice",
  "finance-before-schema-alice",
  "finance-offline-access",
])
  assert.equal(storage.has(key), false, key);
assert.equal(storage.get("finance-user-bob"), "bob");
assert.equal(storage.get("finance-prototype-v1"), "guest");
assert.equal(run("db.ops.length"), 0);
run("cloudSession={user:{id:'alice'}};hydrateBudget(budget);cloudGeneration=0;cloudDirty=true");
records.set("old", { key: "old", owner: "alice" });
await run("acceptRemoteReset({generation:1,revision:0,data:null})");
assert.equal(run("cloudGeneration"), 1);
assert.equal(run("cloudDirty"), false);
assert.equal(run("db.ops.length"), 0);
assert.equal(records.has("old"), false);
storage.set(
  "finance-user-alice",
  JSON.stringify({ data: budget, revision: 0, generation: 1, dirty: true }),
);
records.set("stale", { key: "stale", owner: "alice" });
context.fetch = async (path) => ({
  ok: true,
  json: async () =>
    path === "/api/session"
      ? { user: { id: "alice" } }
      : { generation: 2, revision: 0, data: null },
});
await run("initializeCloud()");
assert.equal(
  run("db.ops.length"),
  0,
  "dirty revision-zero cache cannot return after a remote purge",
);
assert.equal(run("cloudDirty"), false);
assert.equal(records.has("stale"), false);
assert.equal(JSON.parse(storage.get("finance-user-alice")).generation, 2);
vm.runInContext(readFileSync("public/ocr-parser.js", "utf8"), context);
context.FinanceOCR = context.window.FinanceOCR;
context.askForm = async () => ({
  name: "Обновлённая цель",
  target: "200",
  saved: "50",
  date: "2027-01-01",
});
run("hydrateBudget(budget)");
await run("editGoal('goal')");
assert.equal(run("liveRecords('goals')[0].targetMinor"), 20000);
assert.equal(run("liveRecords('goals')[0].savedMinor"), 5000);
assert.notEqual(run("liveRecords('goals')[0].updatedAt"), "1970-01-01T00:00:00.000Z");
let deleteCalls = 0;
context.deleteCalls = 0;
run(
  "cloudFetch=async(path,options)=>{if(path==='/api/budget'&&options?.method==='DELETE'){deleteCalls++;return {generation:3}}throw Error('unexpected')};hydrateBudget(budget);cloudDirty=true",
);
context.askForm = async () => ({ confirmation: "УДАЛИТЬ" });
records.set("delete", { key: "delete", owner: "alice" });
storage.set("finance-before-restore-alice", "finance-before-schema-alice", "private");
await run("deleteAllMyData()");
assert.equal(context.deleteCalls, 1);
assert.equal(run("db.ops.length"), 0);
assert.equal(run("cloudDirty"), false);
assert.equal(records.has("delete"), false);
assert.equal(storage.has("finance-before-restore-alice"), false);
assert.ok(records.has("b"));
console.log(
  "PASS: account move/delete, self-transfer removal, goal tombstone, unsent logout warning, failed-sync exit blocked, owner-only localStorage/IndexedDB purge and remote reset clearing",
);

const startup = vm.createContext({
  console,
  Date,
  Map,
  Set,
  JSON,
  Blob,
  URL,
  TextEncoder,
  TextDecoder,
  crypto: webcrypto,
  window: { addEventListener() {} },
  document: {
    getElementById: () => ({ addEventListener() {} }),
    querySelectorAll: () => [],
    addEventListener() {},
  },
  navigator: { onLine: true },
});
for (const match of readFileSync("public/app.html", "utf8").matchAll(
  /<script src="([^"?]+)(?:\?[^"]*)?"><\/script>/g,
)) {
  if (match[1] === "app.js") break;
  vm.runInContext(readFileSync("public/" + match[1], "utf8"), startup, { filename: match[1] });
}
console.log("PASS: actual HTML script order initializes all feature modules before app globals");
