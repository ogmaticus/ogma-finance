import assert from "node:assert/strict";
import { BudgetSchema, BUDGET_MAX_BYTES } from "../public/budget-schema.js";
import { parseBudget } from "../public/sync-core.js";
import { budgetOfBytes } from "./budget-size-fixture.mjs";
assert.equal(BUDGET_MAX_BYTES, 1900000);
const small = budgetOfBytes(1850000),
  large = budgetOfBytes(1950000);
assert.equal(new TextEncoder().encode(JSON.stringify(BudgetSchema.parse(small))).length, 1850000);
assert.throws(() => BudgetSchema.parse(large), /предел хранения 1 900 000 байт/);
assert.equal(
  parseBudget(JSON.stringify(large)).ops.length,
  1800,
  "existing oversize local data must remain readable",
);
console.log(
  "PASS: exact UTF-8 sizes 1.85MB accepted / 1.95MB rejected; existing oversize data remains readable without truncation",
);
