import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { Money } from "../public/money.js";
import { BudgetSchema } from "../public/budget-schema.js";
import { defaultOperationDate, operationDateOrder } from "../public/dates.js";
import { screenshotSourceId } from "../public/screenshot-source.js";
const bodyModule =
  "data:text/javascript;base64," +
  Buffer.from(
    ts.transpileModule(readFileSync("server/request-body.ts", "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
    }).outputText,
  ).toString("base64");
const { readLimitedBody, BodyLimitError } = await import(bodyModule);
assert.equal(Money.format(-1), "-0,01\u00a0₽");
assert.equal(Money.input(Number.MAX_SAFE_INTEGER), "90071992547409.91");
assert.ok(Money.format(Number.MAX_SAFE_INTEGER).endsWith(",91\u00a0₽"));
assert.equal(Money.toMinor("0,10"), 10);
assert.equal(Money.add(Money.toMinor(0.1), Money.toMinor(0.2)), 30);
assert.equal(Money.toMinor("1.005"), 101);
assert.throws(() => Money.add(Number.MAX_SAFE_INTEGER, 1));
const legacy = {
  accounts: [{ id: "a", name: "A", opening: 0.1 }],
  ops: [
    {
      id: "one",
      name: "Покупка",
      amount: 0.2,
      type: "expense",
      date: "2026-10-14",
      account: "a",
      category: "Кафе",
      note: "Комментарий",
    },
  ],
  goals: [{ name: "Цель", target: 100.01, saved: 0.3, date: "2027-01-01" }],
  limits: { Кафе: 10.01 },
  unknown: { secret: "discard" },
};
const parsed = BudgetSchema.parse(legacy);
assert.equal(parsed.accounts[0].openingMinor, 10);
assert.equal(parsed.ops[0].amountMinor, 20);
assert.equal(parsed.goals[0].targetMinor, 10001);
assert.equal(parsed.goals[0].savedMinor, 30);
assert.equal(parsed.limits.Кафе, 1001);
assert.equal(parsed.ops[0].amount, undefined);
assert.equal(parsed.unknown, undefined);
assert.deepEqual(BudgetSchema.parse(parsed), parsed);
for (const [field, value] of [
  ["note", "x".repeat(1001)],
  ["sourceId", "x".repeat(401)],
  ["screenshotId", "../private"],
  ["time", "24:00"],
  ["bankCategory", "x".repeat(101)],
  ["amountMinor", 0.5],
])
  assert.throws(
    () => BudgetSchema.parse({ ...parsed, ops: [{ ...parsed.ops[0], [field]: value }] }),
    field,
  );
let cancelled = 0,
  reads = 0;
const large = new ReadableStream({
  pull(controller) {
    reads++;
    controller.enqueue(new Uint8Array(32));
  },
  cancel() {
    cancelled++;
  },
});
await assert.rejects(
  readLimitedBody(
    new Request("https://test/api/budget", { method: "PUT", body: large, duplex: "half" }),
    64,
  ),
  BodyLimitError,
);
assert.equal(cancelled, 1);
assert.ok(reads <= 5, "stream stops early without a Content-Length header");
assert.equal(
  new TextDecoder().decode(
    await readLimitedBody(new Request("https://test", { method: "POST", body: "ok" }), 2),
  ),
  "ok",
);
assert.equal(defaultOperationDate("2026-10", new Date(2026, 9, 14)), "2026-10-14");
assert.equal(defaultOperationDate("2024-02", new Date(2026, 9, 14)), "2024-02-29");
assert.equal(defaultOperationDate("2026-02", new Date(2026, 9, 14)), "2026-02-28");
assert.equal(
  [
    { date: "2026-10-01" },
    { date: "2026-10-14", time: "10:00" },
    { date: "2026-10-14", time: "11:00" },
  ].sort(operationDateOrder)[0].time,
  "11:00",
);
const one = new File(["one"], "image.png", { lastModified: 1 }),
  two = new File(["two"], "image.png", { lastModified: 1 });
assert.equal(one.size, two.size);
assert.notEqual(await screenshotSourceId(one), await screenshotSourceId(two));
assert.equal(
  await screenshotSourceId(one),
  await screenshotSourceId(new File(["one"], "different.png")),
);
const headers = readFileSync("public/_headers", "utf8");
assert.ok(headers.includes("script-src 'self' 'wasm-unsafe-eval'"));
assert.ok(!headers.includes("script-src 'self' 'unsafe-inline'"));
assert.ok(headers.includes("frame-ancestors 'none'"));
console.log(
  "PASS: integer money migration/rounding, schema field limits and unknown stripping, idempotence, bounded chunked bodies, default dates, date/time sort, content-based screenshot identities and CSP",
);

const shellCode = ts
  .transpileModule(readFileSync("server/app-shell.ts", "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  })
  .outputText.replace(/import html from [^;]+;/, 'const html="<html>shell</html>";');
const shell = await import(
  "data:text/javascript;base64," + Buffer.from(shellCode).toString("base64")
);
const response = shell.appShellResponse();
assert.equal(response.headers.get("Content-Type"), "text/html; charset=utf-8");
assert.equal(response.headers.get("Content-Security-Policy"), shell.APP_CSP);
assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
assert.equal(response.headers.get("Referrer-Policy"), "same-origin");
