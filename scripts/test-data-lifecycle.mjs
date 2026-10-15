import assert from "node:assert/strict";
import vm from "./test-vm.mjs";
import { readFileSync } from "node:fs";
const context = vm.createContext({ Date, Map, Set, JSON });
for (const file of ["data-model.js", "sync-core.js", "budget-core.js"])
  vm.runInContext(readFileSync("public/" + file, "utf8"), context);
const Model = context.FinanceData,
  Budget = vm.runInContext("FinanceBudget", context);
const json = (value) => JSON.parse(JSON.stringify(value));
const base = {
  accounts: [{ id: "card", name: "Карта", opening: 10 }],
  ops: [
    {
      id: "expense",
      name: "Покупка",
      amount: 10,
      type: "expense",
      date: "2026-10-01",
      account: "card",
      category: "Кафе",
    },
    {
      id: "other",
      name: "Другое",
      amount: 5,
      type: "expense",
      date: "2026-10-02",
      account: "card",
      category: "Кафе",
    },
  ],
  goals: [{ name: "Подушка", target: 100, saved: 10, date: "2027-01-01" }],
  merchantRules: [{ key: "магазин", name: "Магазин", category: "Кафе" }],
  limits: { Кафе: 100 },
  budgetsByMonth: { "2026-10": { Кафе: 100, Продукты: 500 } },
  accountAliases: { 2264: "card" },
  custom: { keep: true },
};
const original = JSON.stringify(base),
  migrated = Model.normalize(base, "2026-10-01T00:00:00.000Z");
assert.equal(JSON.stringify(base), original);
assert.equal(migrated.schemaVersion, 3);
assert.ok(migrated.goals[0].id);
assert.ok(migrated.merchantRules[0].id);
assert.equal(migrated.ops[0].updatedAt, Model.EPOCH);
assert.equal(Model.normalize(base).goals[0].id, migrated.goals[0].id);
assert.deepEqual(json(migrated.custom), base.custom);
let a = Model.remove(migrated, "ops", "expense", "2026-10-02T10:00:00.000Z");
delete a.limits.Кафе;
delete a.budgetsByMonth["2026-10"].Кафе;
delete a.accountAliases[2264];
a = Model.stamp(a, migrated, "2026-10-02T10:00:00.000Z");
let b = Model.normalize(migrated);
b.ops[1].amountMinor = 800;
b.budgetsByMonth["2026-10"].Продукты = 60000;
b = Model.stamp(b, migrated, "2026-10-02T11:00:00.000Z");
const merged = Model.merge(b, a, "2026-10-03T00:00:00.000Z");
assert.equal(
  Model.live(merged.ops).some((record) => record.id === "expense"),
  false,
  "deletion on A must survive an unrelated later edit on B",
);
assert.equal(Model.live(merged.ops)[0].amountMinor, 800);
assert.equal(merged.limits.Кафе, undefined);
assert.equal(merged.accountAliases[2264], undefined);
assert.equal(merged.budgetsByMonth["2026-10"].Кафе, undefined);
assert.equal(merged.budgetsByMonth["2026-10"].Продукты, 60000);
assert.equal(Budget.report(merged, "2026-10").totalSpent, 800);
const exported = Model.exportData(merged);
assert.equal(exported.ops.length, 1);
assert.ok(exported.deletionMarkers.ops.expense);
const gc = Model.normalize(merged, "2027-02-01T00:00:00.000Z");
assert.equal(
  gc.ops.some((record) => record.id === "expense"),
  false,
  "full tombstone removed after 90 days",
);
assert.equal(
  Model.live(Model.merge(migrated, gc, "2027-02-02T00:00:00.000Z").ops).some(
    (record) => record.id === "expense",
  ),
  false,
  "a stale device cannot resurrect a compacted tombstone",
);
const restoredKey = Model.stamp(
  Budget.setLimit(merged, "2026-10", "Кафе", 5000),
  merged,
  "2026-10-04T00:00:00.000Z",
);
assert.equal(
  restoredKey.budgetsByMonth["2026-10"].Кафе,
  5000,
  "a removed limit can be explicitly added again",
);
const changedAlias = json(merged);
changedAlias.accountAliases[2264] = "card";
const readdedAlias = Model.stamp(changedAlias, merged, "2026-10-04T00:00:00.000Z");
assert.equal(readdedAlias.accountAliases[2264], "card");
const tieA = Model.stamp(
    { ...migrated, ops: [{ ...migrated.ops[0], amountMinor: 2000 }, migrated.ops[1]] },
    migrated,
    "2026-10-05T00:00:00.000Z",
  ),
  tieB = Model.stamp(
    { ...migrated, ops: [{ ...migrated.ops[0], amountMinor: 3000 }, migrated.ops[1]] },
    migrated,
    "2026-10-05T00:00:00.000Z",
  );
assert.equal(Model.merge(tieA, tieB).ops[0].amountMinor, 3000);
const replaced = Model.replacement(base, merged, "2026-10-06T00:00:00.000Z");
assert.equal(
  Model.live(replaced.ops).length,
  2,
  "an explicit backup restore can recover a deleted record",
);
Model.validateMetadata(replaced);
console.log(
  "PASS: stable legacy migration, record/key clocks, unrelated offline changes, deletion-safe merge, 90-day compaction, re-adding keys, equal-time local winner and explicit restore",
);

const removedImage = Model.normalize({
  ...base,
  removedScreenshotIds: { old: "2026-10-02T00:00:00.000Z" },
});
const imageRestore = Model.replacement(
  { ...base, ops: [{ ...base.ops[0], screenshotId: "old" }] },
  removedImage,
);
assert.equal(
  imageRestore.ops[0].screenshotId,
  undefined,
  "restoring an old budget cannot restore a deleted image reference",
);
