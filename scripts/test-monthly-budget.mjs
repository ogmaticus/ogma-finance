import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "./test-vm.mjs";
import { webcrypto } from "node:crypto";
const context = vm.createContext({
  Intl,
  Date,
  Map,
  Set,
  structuredClone,
  Blob,
  TextEncoder,
  TextDecoder,
  crypto: webcrypto,
});
for (const file of [
  "data-model.js",
  "sync-core.js",
  "budget-core.js",
  "backup-zip.js",
  "backup-core.js",
])
  vm.runInContext(readFileSync("public/" + file, "utf8"), context);
const Budget = vm.runInContext("FinanceBudget", context),
  Backup = vm.runInContext("FinanceBackup", context),
  Zip = vm.runInContext("FinanceZip", context);
const base = {
  accounts: [
    { id: "card", name: "Карта", opening: 0 },
    { id: "cash", name: "Наличные", opening: 0 },
  ],
  ops: [],
  goals: [],
  limits: { Продукты: 1000, Кафе: 1000 },
  categories: [],
  custom: "keep",
};
const op = (id, category, amount, type = "expense", date = "2026-10-04") => ({
  id,
  category,
  amount,
  type,
  date,
  account: "card",
  name: id,
  ...(type === "transfer" ? { to: "cash" } : {}),
});
base.ops = [
  op("buy", "Продукты", 1100),
  op("refund", "Продукты", 100, "refund"),
  op("cafe", "Кафе", 801.01),
  op("new", "Новая категория банка", 50),
  op("income", "Зарплата", 5000, "income"),
  op("transfer", "Перевод", 10000, "transfer"),
  op("september", "Продукты", 4000, "expense", "2026-09-30"),
];
const untouched = JSON.stringify(base),
  october = Budget.setLimit(base, "2026-10", "Продукты", 80000);
assert.equal(JSON.stringify(base), untouched, "old document untouched");
assert.equal(october.limits.Продукты, 100000, "legacy limits kept");
assert.equal(Budget.plan(october, "2026-11").Продукты, 100000, "another month unchanged");
const november = Budget.setLimit(october, "2026-11", "Продукты", 120000);
assert.equal(Budget.plan(november, "2026-10").Продукты, 80000);
const report = Budget.report(november, "2026-10", ["Продукты", "Кафе", "Зарплата", "Перевод"]);
assert.equal(report.totalLimit, 180000);
assert.equal(report.plannedSpent, 180101);
assert.equal(report.remaining, -101);
assert.equal(report.totalSpent, 185101);
assert.equal(report.unplannedSpent, 5000);
assert.equal(report.over[0].category, "Продукты");
assert.equal(report.over[0].remaining, -20000);
assert.equal(report.near[0].category, "Кафе");
assert.equal(
  report.rows.some((row) => row.category === "Перевод"),
  false,
);
assert.equal(
  report.rows.some((row) => row.category === "Зарплата"),
  false,
);
const zero = Budget.setLimit(base, "2026-10", "Кафе", 0);
assert.equal(
  Budget.report(zero, "2026-10").over.find((row) => row.category === "Кафе").remaining,
  -80101,
);
const removed = Budget.setLimit(zero, "2026-10", "Кафе", null);
assert.equal(Budget.plan(removed, "2026-10").Кафе, undefined);
assert.equal(Budget.plan(removed, "2026-11").Кафе, 100000);
const empty = Budget.setLimit(removed, "2026-10", "Продукты", null);
assert.equal(
  Object.keys(Budget.plan(empty, "2026-10")).length,
  0,
  "explicit empty plan must not fall back",
);
const rounded = Budget.report(
  { ...base, limits: { Кафе: 1 }, ops: [op("one", "Кафе", 0.1), op("two", "Кафе", 0.2)] },
  "2026-10",
);
assert.equal(rounded.plannedSpent, 30);
assert.equal(rounded.remaining, 70);
const credit = Budget.report(
  { ...base, ops: [op("old-refund", "Продукты", 100, "refund")] },
  "2026-10",
);
assert.equal(credit.rows.find((row) => row.category === "Продукты").percent, 0);
assert.equal(credit.remaining, 210000);
assert.equal(Budget.previousMonth("2026-01"), "2025-12");
const copied = Budget.copyPlan(november, "2026-10", "2026-12");
assert.deepEqual(JSON.parse(JSON.stringify(copied.budgetsByMonth["2026-12"])), {
  Продукты: 80000,
  Кафе: 100000,
});
copied.budgetsByMonth["2026-12"].Кафе = 0;
assert.equal(copied.budgetsByMonth["2026-10"].Кафе, 100000);
context.remote = {
  ...base,
  budgetsByMonth: { "2026-09": { Кафе: 900 }, "2026-10": { Кафе: 1000 } },
};
context.local = empty;
const merged = vm.runInContext("mergeBudgets(remote,local)", context);
assert.equal(merged.budgetsByMonth["2026-09"].Кафе, 90000);
assert.equal(
  Object.keys(merged.budgetsByMonth["2026-10"]).length,
  0,
  "removed limits cannot return during migration",
);
for (const plans of [
  [],
  null,
  { "2026-13": {} },
  { "2026-10": [] },
  { "2026-10": { Кафе: -1 } },
  JSON.parse('{"2026-10":{"__proto__":1}}'),
])
  assert.throws(() => Budget.validatePlans(plans));
const copy = await Backup.create(november, []),
  restored = await Backup.read(await Zip.build(copy.entries));
assert.deepEqual(
  JSON.parse(JSON.stringify(restored.data.budgetsByMonth)),
  JSON.parse(JSON.stringify(november.budgetsByMonth)),
);
assert.equal(restored.data.custom, undefined);
assert.deepEqual(
  JSON.parse(JSON.stringify(Backup.validateBudget(base))),
  JSON.parse(
    JSON.stringify(
      vm.runInContext("BudgetSchema.parse(remote)", Object.assign(context, { remote: base })),
    ),
  ),
);
console.log(
  "PASS: monthly independence, legacy fallback, explicit empty/zero plans, cent-accurate totals, refunds, income/transfer exclusion, 80%/exceeded states, copying, migration and ZIP round-trip",
);

// Exercise the real limit controls and category history with a small DOM stand-in.
const elements = new Map(),
  element = (selector) => {
    if (!elements.has(selector))
      elements.set(selector, {
        value: "",
        innerHTML: "",
        textContent: "",
        hidden: false,
        open: false,
        classList: { toggle() {} },
        showModal() {
          this.open = true;
        },
        append() {},
      });
    return elements.get(selector);
  };
const store = new Map();
Object.assign(context, {
  console,
  URL,
  navigator: { onLine: true },
  window: {},
  setTimeout: () => 1,
  clearTimeout() {},
  document: {
    querySelector: element,
    querySelectorAll: () => [],
    getElementById: (id) => element("#" + id),
  },
  localStorage: {
    getItem: (key) => store.get(key) || null,
    setItem: (key, value) => store.set(key, String(value)),
  },
  fetch: async () => {
    throw Error("unused");
  },
});
for (const file of [
  "month-picker.js",
  "budget-ui.js",
  "sync.js",
  "file-vault.js",
  "pwa.js",
  "ui.js",
  "category-history.js",
  "accounts.js",
  "import-ui.js",
  "app.js",
])
  vm.runInContext(readFileSync("public/" + file, "utf8"), context);
context.fixture = structuredClone(base);
context.prevent = { preventDefault() {} };
vm.runInContext(
  'hydrateBudget(fixture);setFinanceMonth("2026-10");animateDialogClose=dialog=>{dialog.open=false};go("Бюджет");limit("Кафе","2026-10")',
  context,
);
element("#budgetlimitamount").value = "700";
vm.runInContext("saveMonthlyLimit(prevent)", context);
assert.equal(JSON.parse(store.get("finance-prototype-v1")).budgetsByMonth["2026-10"].Кафе, 70000);
assert.equal(vm.runInContext("db.limits.Кафе", context), 100000);
assert.ok(element("#content").innerHTML.includes("Превышение на"));
assert.ok(element("#content").innerHTML.includes("Новая категория банка"));
vm.runInContext('showCategoryHistory("Продукты","2026-10")', context);
assert.equal(vm.runInContext("historyMonth", context), "2026-10");
assert.equal(
  vm.runInContext("categoryHistoryRows(historyCategory,historyMonth).length", context),
  2,
);
vm.runInContext('limit("Кафе","2026-10")', context);
element("#budgetlimitamount").value = "";
vm.runInContext("saveMonthlyLimit(prevent)", context);
assert.equal(vm.runInContext('FinanceBudget.plan(db,"2026-10").Кафе', context), undefined);
vm.runInContext('limit("Кафе","2026-10");cloudSession={user:{id:"other-user"}}', context);
element("#budgetlimitamount").value = "50";
vm.runInContext("saveMonthlyLimit(prevent)", context);
assert.equal(vm.runInContext('FinanceBudget.plan(db,"2026-10").Кафе', context), undefined);
assert.ok(element("#budgetlimiterror").textContent.includes("Аккаунт изменился"));
console.log(
  "PASS: real limit controls persist the selected month, warnings render, history opens for that month and account changes cannot apply an old form",
);

vm.runInContext('cloudSession=null;setFinanceMonth("2026-10")', context);
const beforeSelection = vm.runInContext("JSON.stringify(db)", context),
  beforeStored = store.get("finance-prototype-v1");
vm.runInContext("shiftFinanceMonth(1)", context);
assert.equal(element("#month").value, "2026-11");
assert.equal(element("#monthlabel").textContent, "Ноябрь 2026");
assert.ok(element("#content").innerHTML.includes("ноябрь 2026"));
assert.equal(store.get("finance-view-month"), "2026-11");
assert.equal(vm.runInContext("JSON.stringify(db)", context), beforeSelection);
assert.equal(
  store.get("finance-prototype-v1"),
  beforeStored,
  "changing month cannot write budget data",
);
element("#month").value = "2026-10";
vm.runInContext("initializeMonthSelection()", context);
assert.equal(element("#month").value, "2026-11", "month survives reload");
vm.runInContext('setFinanceMonth("2026-12");shiftFinanceMonth(1)', context);
assert.equal(element("#month").value, "2027-01");
vm.runInContext("shiftFinanceMonth(-1)", context);
assert.equal(element("#month").value, "2026-12");
vm.runInContext("openMonthPicker()", context);
element("#pickeryear").value = "2025";
element("#pickermonth").value = "07";
vm.runInContext("applyMonthPicker(prevent)", context);
assert.equal(element("#month").value, "2025-07");
assert.equal(element("#monthpickerdialog").open, false);
vm.runInContext("openMonthPicker()", context);
element("#pickeryear").value = "1.5";
vm.runInContext("applyMonthPicker(prevent)", context);
assert.equal(element("#month").value, "2025-07");
assert.equal(element("#monthpickerdialog").open, true);
assert.ok(element("#monthpickererror").textContent);
vm.runInContext(
  'animateDialogClose($("#monthpickerdialog"));showCategoryHistory("Продукты","2026-10");openMonthPicker("history")',
  context,
);
element("#pickeryear").value = "2026";
element("#pickermonth").value = "09";
vm.runInContext("applyMonthPicker(prevent)", context);
assert.equal(vm.runInContext("historyMonth", context), "2026-09");
assert.equal(
  vm.runInContext("categoryHistoryRows(historyCategory,historyMonth).length", context),
  1,
);
assert.equal(element("#month").value, "2025-07", "history has its own month");
vm.runInContext("shiftHistoryMonth(1)", context);
assert.equal(vm.runInContext("historyMonth", context), "2026-10");
vm.runInContext('setFinanceMonth("0001-01")', context);
assert.equal(element("#monthprevious").disabled, true);
vm.runInContext('setFinanceMonth("9999-12")', context);
assert.equal(element("#monthnext").disabled, true);
assert.equal(vm.runInContext('financeMonthShift("2026-01",-1)', context), "2025-12");
assert.equal(vm.runInContext('setFinanceMonth("2026-13")', context), false);
console.log(
  "PASS: visible month arrows, month/year dialog, year rollover, independent history, preference after reload, invalid selections rejected and budget data unchanged",
);

vm.runInContext('hydrateBudget(fixture);setFinanceMonth("2026-10");go("Категории")', context);
assert.ok(element("#content").innerHTML.includes('class="category-limit-button"'));
assert.ok(element("#content").innerHTML.includes("Задать лимит"));
assert.ok(element("#content").innerHTML.includes("Изменить лимит"));
vm.runInContext('limit("Новая категория банка","2026-10")', context);
assert.equal(element("#budgetlimitdialog").open, true);
assert.equal(element("#budgetlimittitle").textContent, "Новая категория банка");
const beforeCancel = vm.runInContext("JSON.stringify(db)", context);
vm.runInContext('animateDialogClose($("#budgetlimitdialog"))', context);
assert.equal(vm.runInContext("JSON.stringify(db)", context), beforeCancel);
vm.runInContext('showCategoryHistory("Новая категория банка","2026-09")', context);
assert.ok(element("#categoryhistorycontent").innerHTML.includes("Задать лимит"));
assert.ok(element("#categoryhistorycontent").innerHTML.includes('data-month="2026-09"'));
vm.runInContext("limit(historyCategory,historyMonth)", context);
element("#budgetlimitamount").value = "600";
vm.runInContext("saveMonthlyLimit(prevent)", context);
assert.equal(
  vm.runInContext('FinanceBudget.plan(db,"2026-09")["Новая категория банка"]', context),
  60000,
);
assert.equal(
  vm.runInContext('FinanceBudget.plan(db,"2026-10")["Новая категория банка"]', context),
  undefined,
);
assert.equal(element("#categoryhistory").open, true);
assert.equal(element("#budgetlimitdialog").open, false);
assert.ok(element("#categoryhistorycontent").innerHTML.includes("Изменить лимит"));
assert.ok(
  element("#categoryhistorycontent").innerHTML.includes(vm.runInContext("money(60000)", context)),
);
assert.equal(vm.runInContext('categoryLimitHTML("Перевод","2026-10")', context), "");
assert.equal(vm.runInContext('categoryLimitHTML("Зарплата","2026-10")', context), "");
console.log(
  "PASS: category tiles and history expose limit controls, the input dialog opens, cancellation changes nothing and saving refreshes the correct history month",
);
