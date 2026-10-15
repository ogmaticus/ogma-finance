import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
const SHELL = JSON.parse((await import("node:fs")).readFileSync("release.json", "utf8")).shell;
const nodes = new Map(),
  node = (key) => {
    if (!nodes.has(key))
      nodes.set(key, {
        value: "",
        innerHTML: "",
        textContent: "",
        hidden: false,
        dataset: {},
        classList: {
          add() {},
          remove() {},
          toggle() {},
          contains() {
            return false;
          },
        },
        append() {},
        setAttribute(key, value) {
          this[key] = value;
        },
        addEventListener() {},
        removeEventListener() {},
        showModal() {
          this.open = true;
        },
        close() {
          this.open = false;
        },
      });
    return nodes.get(key);
  };
const listeners = new Map();
const storage = new Map();
globalThis.document = {
  documentElement: node("html"),
  querySelector: node,
  querySelectorAll: () => [],
  getElementById: (id) => node("#" + id),
  addEventListener(type, handler) {
    listeners.set(type, handler);
  },
};
globalThis.window = { addEventListener() {} };
globalThis.localStorage = {
  getItem: (key) => storage.get(key) || null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
};
Object.defineProperty(globalThis, "navigator", { value: { onLine: true }, configurable: true });
Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
const app = await import("../public/app.js?v=" + SHELL);
const { state } = await import("../public/state.js?v=" + SHELL);
const shell = await import("../public/shell-ui.js?v=" + SHELL);
assert.equal(state.db.schemaVersion, 3);
assert.ok(state.db.ops.every((op) => Number.isSafeInteger(op.amountMinor)));
assert.ok(
  node("#content").innerHTML.includes("Обзор") || node("#content").innerHTML.includes("Всего"),
);
assert.equal(globalThis.db, undefined);
assert.equal(globalThis.FinanceData, undefined);
app.go("Счета");
assert.ok(node("#content").innerHTML.includes("Основная карта"));
app.go("Категории");
assert.ok(node("#content").innerHTML.includes("data-action="));
assert.match(node("#content").innerHTML, /Категории магазинов/);
for (const file of readdirSync("public").filter(
  (name) => name.endsWith(".js") && name !== "sw.js",
)) {
  const code = readFileSync("public/" + file, "utf8");
  assert.ok(!/on(?:click|change|submit|input)=/.test(code), file + " contains an inline event");
  assert.ok(!/globalThis\.Finance|window\.Finance/.test(code), file + " exports a browser global");
}
assert.ok(!/on(?:click|change|submit|input)=/.test(readFileSync("public/app.html", "utf8")));
console.log(
  "PASS: native ES module graph links and renders, money state is canonical, no application globals or inline handlers",
);

const target = {
  dataset: { action: "showBudget" },
  tagName: "BUTTON",
  closest(selector) {
    return selector === "#categoryhistory" ? null : this;
  },
};
const clickAction = (dataset) =>
  listeners.get("click")({
    target: { ...target, dataset },
    preventDefault() {},
  });
const navBefore = JSON.stringify(state.db);
for (const page of [
  "Обзор",
  "Операции",
  "Бюджет",
  "Ещё",
  "Аналитика",
  "Счета",
  "Цели",
  "Категории",
  "Личный кабинет",
  "Настройки",
]) {
  clickAction({ action: "navigatePage", page });
  assert.equal(state.page, page);
  assert.equal(node("#title").textContent, page);
  assert.equal((node("#nav").innerHTML.match(/<button /g) || []).length, 5);
  const selected = ["Обзор", "Операции", "Бюджет"].includes(page) ? page : "Ещё";
  assert.match(
    node("#nav").innerHTML,
    new RegExp(`data-page="${selected}"[^>]*aria-current="page"`),
  );
}
clickAction({ action: "navigatePage", page: "invalid" });
assert.equal(state.page, "Настройки");
assert.equal(JSON.stringify(state.db), navBefore, "navigation does not change budget data");
clickAction({ action: "openAddChooser" });
assert.equal(node("#adddialog").open, true);
await shell.chooseAdd(null, { dataset: { addMode: "screenshot" } });
assert.equal(node("#adddialog").open, false);
assert.equal(state.page, "Импорт");
const form = node("#form");
form.elements = {};
for (const field of [
  "name",
  "amount",
  "type",
  "date",
  "time",
  "account",
  "category",
  "to",
  "note",
]) {
  form[field] = form.elements[field] = { value: "", innerHTML: "" };
}
form.reset = () => {
  for (const field of Object.values(form.elements)) field.value = "";
  form.type.value = "expense";
};
shell.openAddChooser();
await shell.chooseAdd(null, { dataset: { addMode: "manual" } });
assert.equal(node("#adddialog").open, false);
assert.equal(node("#modal").open, true);
assert.equal(node("#formtitle").textContent, "Новая операция");
const existing = state.db.ops.find((op) => !op.deletedAt);
clickAction({ action: "openOverviewOperation", opId: existing.id });
assert.equal(state.editId, existing.id);
assert.equal(Number(form.amount.value.replace(",", ".")), existing.amountMinor / 100);
assert.equal(JSON.stringify(state.db), navBefore, "opening forms does not save an operation");
console.log(
  "PASS: all primary and secondary routes, active navigation, both add flows, editable recent operations, no budget mutation",
);

// Real report + mixed operations: order, refunds, transfers, safe labels and import memory.
const { FinanceBudget } = await import("../public/budget-core.js?v=" + SHELL);
const { FinanceData } = await import("../public/data-model.js?v=" + SHELL);
const { BudgetSchema } = await import("../public/budget-schema.js?v=" + SHELL);
const sample = structuredClone(state.db);
sample.budgetsByMonth["2026-10"] = { Продукты: 10000 };
sample.ops = [
  {
    ...existing,
    id: "expense",
    name: "<Покупка>",
    date: "2026-10-13",
    time: "10:00",
    type: "expense",
    category: "Продукты",
    amountMinor: 15001,
  },
  {
    ...existing,
    id: "refund",
    name: "Возврат",
    date: "2026-10-13",
    time: "11:00",
    type: "refund",
    category: "Продукты",
    amountMinor: 101,
  },
  {
    ...existing,
    id: "income",
    name: "Поступление",
    date: "2026-10-14",
    time: "08:00",
    type: "income",
    category: "Зарплата",
    amountMinor: 20000,
  },
  {
    ...existing,
    id: "transfer",
    name: "Между счетами",
    date: "2026-10-14",
    time: "09:00",
    type: "transfer",
    to: sample.accounts[1].id,
    amountMinor: 10000,
  },
  { ...existing, id: "old", name: "Раньше", date: "2026-10-10", time: "22:00", amountMinor: 10 },
  {
    ...existing,
    id: "oldest",
    name: "Самая старая",
    date: "2026-10-01",
    time: "22:00",
    amountMinor: 10,
  },
];
const report = FinanceBudget.report(sample, "2026-10", ["Продукты"]);
assert.equal(report.over[0].remaining, -4900);
const overviewArgs = {
  all: 123456,
  income: 20000,
  expense: 14900,
  report,
  ops: sample.ops,
  accounts: sample.accounts,
  month: "2026-10",
  hasImported: false,
};
const overview = shell.overviewMarkup(overviewArgs);
assert.deepEqual(
  [...overview.matchAll(/data-op-id="([^"]+)"/g)].map((match) => match[1]),
  ["transfer", "income", "refund", "expense", "old"],
);
assert.ok(!overview.includes("<Покупка>"));
assert.ok(overview.includes("&lt;Покупка&gt;"));
assert.match(overview, /Превышение на/);
assert.match(overview, /data-category="Продукты" data-month="2026-10"/);
assert.match(overview, /Добавьте со скриншота/);
assert.ok(
  !shell.overviewMarkup({ ...overviewArgs, hasImported: true }).includes("Добавьте со скриншота"),
);
assert.equal(shell.operationDayLabel("2026-10-14", "2026-10-14"), "Сегодня");
assert.equal(shell.operationDayLabel("2026-09-30", "2026-10-01"), "Вчера");
assert.deepEqual(shell.monthProgress("2024-02", "2024-02-29"), {
  days: 29,
  elapsed: 29,
  percent: 100,
});
assert.equal(shell.monthProgress("2026-09", "2026-10-14").percent, 100);
assert.equal(shell.monthProgress("2026-11", "2026-10-14").percent, 0);
assert.ok(
  !shell.overviewMarkup({ ...overviewArgs, ops: [], hasImported: true }).includes("data-op-id="),
);
sample.ops[0].sourceId = "screenshot_test";
const imported = FinanceData.normalize(sample);
assert.equal(imported.hasScreenshotImport, true);
imported.ops = [];
assert.equal(
  BudgetSchema.parse(imported).hasScreenshotImport,
  true,
  "deleting imported rows cannot restore the invitation",
);
const { FinanceBackup } = await import("../public/backup-core.js?v=" + SHELL);
const { FinanceZip } = await import("../public/backup-zip.js?v=" + SHELL);
const backup = await FinanceBackup.create(imported, []);
const restored = await FinanceBackup.read(await FinanceZip.build(backup.entries));
assert.equal(restored.data.hasScreenshotImport, true);
assert.equal(
  FinanceData.merge(imported, { ...imported, hasScreenshotImport: false }).hasScreenshotImport,
  true,
);
assert.throws(() => BudgetSchema.parse({ ...imported, hasScreenshotImport: "yes" }));
console.log(
  "PASS: recent date/time order, report alerts and refunds, safe labels, calendar progress, screenshot import memory across deletion, merge and ZIP restore",
);
listeners.get("click")({ target, preventDefault() {} });
assert.equal(node("#title").textContent, "Бюджет");

const { persistBudget } = await import("../public/sync.js?v=" + SHELL);
const unchangedBudget = JSON.stringify(state.db);
listeners.get("click")({
  target: { ...target, dataset: { action: "selectTheme", themeMode: "dark" } },
  preventDefault() {},
});
assert.equal(document.documentElement.dataset.theme, "dark");
assert.equal(JSON.stringify(state.db), unchangedBudget);
app.go("Личный кабинет");
assert.match(node("#content").innerHTML, /Оформление/);
const before = JSON.stringify(state.db);
state.db.ops[0].amountMinor = -1;
assert.throws(() => persistBudget(state.db));
assert.equal(JSON.stringify(state.db), before, "invalid edits cannot mutate the last valid budget");

// Compact budget rows open the existing limit form and retain its monthly scope.
const savedDb = state.db;
const savedCats = state.cats;
state.cats = [...savedCats, "Нулевая", "Пустая"];
state.db = FinanceData.normalize({
  ...savedDb,
  ops: [],
  limits: {},
  budgetsByMonth: { "2026-10": { Продукты: 10000, Нулевая: 0 } },
});
node("#month").value = "2026-10";
app.go("Бюджет");
const compact = node("#content").innerHTML;
assert.match(compact, /compact-budget-row/);
assert.match(compact, /unused-categories/);
assert.ok(
  compact.indexOf("Нулевая") < compact.indexOf("unused-categories"),
  "zero limit remains visible",
);
clickAction({ action: "editBudgetCategoryLimit", category: "Продукты", month: "2026-10" });
assert.equal(node("#budgetlimitdialog").open, true);
assert.equal(Number(node("#budgetlimitamount").value), 100);
node("#budgetlimitamount").value = "250,01";
const { saveMonthlyLimit } = await import("../public/budget-ui.js?v=" + SHELL);
saveMonthlyLimit({ preventDefault() {} });
assert.equal(state.db.budgetsByMonth["2026-10"].Продукты, 25001);
assert.equal(state.db.budgetsByMonth["2026-11"], undefined);
state.db = savedDb;
state.cats = savedCats;
console.log(
  "PASS: compact budget, empty category disclosure, explicit zero visibility, row opens and saves a cent-accurate limit for the selected month",
);

const analytics = await import("../public/analytics-ui.js?v=" + SHELL);
const chartData = structuredClone(sample);
chartData.ops = [
  ...sample.ops,
  {
    ...existing,
    id: "previous",
    date: "2026-09-20",
    type: "expense",
    category: "Продукты",
    amountMinor: 10000,
  },
  {
    ...existing,
    id: "previousOnly",
    date: "2026-09-21",
    type: "expense",
    category: "Только раньше",
    amountMinor: 20000,
  },
];
const chartBefore = JSON.stringify(chartData);
assert.deepEqual(analytics.monthlyFlow(chartData.ops, "2026-10"), {
  month: "2026-10",
  incomeMinor: 20020,
  purchaseMinor: 15001,
  refundMinor: 101,
  expenseMinor: 14900,
  netMinor: 5120,
});
assert.equal(analytics.monthlySeries(chartData.ops, "2026-01", 12)[0].month, "2025-02");
assert.equal(analytics.monthlySeries(chartData.ops, "2026-10", 6).length, 6);
assert.equal(analytics.comparison(12000, 10000), "+20% к прошлому месяцу");
assert.equal(analytics.comparison(0, 10000), "−100% к прошлому месяцу");
assert.equal(analytics.comparison(100, 0), "Нет суммы для сравнения");
assert.equal(
  analytics.categoryComparisons(chartData, "2026-10").find((r) => r.category === "Только раньше")
    .spent,
  0,
);
const chart = analytics.analyticsMarkup(chartData, "2026-10", 12);
assert.match(chart, /<svg/);
assert.match(chart, /<table>/);
assert.match(chart, /data-category="Продукты"/);
assert.ok(!/NaN|Infinity/.test(chart));
const onlyRefund = {
  ...chartData,
  ops: [{ ...existing, type: "refund", amountMinor: 999, date: "2026-10-01" }],
};
assert.equal(analytics.monthlyFlow(onlyRefund.ops, "2026-10").expenseMinor, -999);
assert.ok(!/NaN|Infinity/.test(analytics.analyticsMarkup(onlyRefund, "2026-10")));
assert.equal(JSON.stringify(chartData), chartBefore);
app.go("Аналитика");
const rangeBefore = JSON.stringify(state.db);
clickAction({ action: "setAnalyticsRange", range: "12" });
assert.equal(state.analyticsRange, 12);
assert.match(node("#content").innerHTML, /за 12 месяцев/);
clickAction({ action: "setAnalyticsRange", range: "9" });
assert.equal(state.analyticsRange, 12);
assert.equal(JSON.stringify(state.db), rangeBefore);
console.log(
  "PASS: analytics integer flow, refunds/transfer exclusion, twelve-month year boundary, zero/negative comparisons, prior-only categories, accessible chart data and range changes without budget mutation",
);

const imports = await import("../public/import-ui.js?v=" + SHELL);
const importDbBefore = state.db;
state.db = FinanceData.normalize({ ...savedDb, ops: [] });
state.ocrFiles = [];
state.importCompleted = null;
state.draft = [
  {
    name: "Тест",
    amount: 12.34,
    type: "expense",
    date: "",
    category: "Продукты",
    account: "",
    currency: "RUB",
    selected: true,
  },
];
app.go("Импорт");
assert.match(node("#content").innerHTML, /aria-current="step"/);
assert.match(node("#content").innerHTML, /Нет даты — выбрать/);
assert.match(node("#content").innerHTML, /Укажите дату для 1 операций/);
const inline = (field, value) =>
  imports.setImportInlineField(null, { dataset: { importIndex: "0", importField: field }, value });
inline("date", "2026-02-30");
assert.equal(state.draft[0].date, "");
inline("date", "2026-10-14");
assert.match(imports.importBlockReason(state.draft), /Выберите счета/);
inline("account", savedDb.accounts[0].id);
assert.equal(imports.importBlockReason(state.draft), "");
assert.ok(!imports.importInlineFields(state.draft[0], 0));
state.draft[0].amount = 0;
inline("amount", "12,35");
assert.equal(state.draft[0].amount, 12.35);
assert.equal(
  imports.importSame(
    { name: "x", amountMinor: 1235, date: "2026-10-14", account: "a", type: "expense" },
    { name: "x", amount: 12.35, date: "2026-10-14", account: "a", type: "expense" },
  ),
  true,
);
assert.equal(
  imports.importSame(
    { name: "x", amountMinor: 1234, date: "2026-10-14", account: "a", type: "expense" },
    { name: "x", amountMinor: 1235, date: "2026-10-14", account: "a", type: "expense" },
  ),
  false,
);
await imports.importSave();
assert.equal(state.db.ops.length, 1);
assert.equal(state.db.ops[0].amountMinor, 1235);
assert.equal(state.db.hasScreenshotImport, true);
assert.equal(state.page, "Импорт");
assert.match(node("#content").innerHTML, /Операции добавлены/);
assert.equal(node("#title").textContent, "Импорт");
clickAction({ action: "restartImport" });
assert.equal(state.importCompleted, null);
assert.match(node("#content").innerHTML, /Загрузите историю банка/);
state.db = importDbBefore;
state.draft = [];
console.log(
  "PASS: three import steps, visible blocking reason, inline valid/invalid date and account, decimal comma, canonical duplicate comparison, successful completion and restart",
);

const operationForm = await import("../public/operation-form.js?v=" + SHELL);
assert.equal(
  operationForm.recentOperationAccount(
    [
      { account: "a", updatedAt: "2026-10-14T12:00:00.000Z", date: "2026-01-01" },
      { account: "b", updatedAt: "2026-10-13T12:00:00.000Z", date: "2026-10-13" },
    ],
    [{ id: "a" }, { id: "b" }],
  ),
  "a",
);
assert.equal(
  operationForm.recentOperationAccount([{ account: "deleted", date: "2026-10-14" }], [{ id: "a" }]),
  "a",
);
assert.equal(
  operationForm.operationDateChoice("yesterday", new Date("2026-01-01T12:00:00Z")),
  "2025-12-31",
);
assert.deepEqual(
  operationForm.recentOperationCategories(
    [
      { category: "Кафе", type: "expense", date: "2026-10-14" },
      { category: "Перевод", type: "transfer", date: "2026-10-15" },
    ],
    ["Продукты", "Кафе"],
  ),
  ["Кафе", "Продукты"],
);
const manualBefore = JSON.stringify(state.db);
app.edit();
clickAction({ action: "chooseOperationType", operationType: "transfer" });
assert.equal(form.type.value, "transfer");
assert.equal(node("#operation-extra").open, true);
form.elements.name.value = "Перевод";
form.amount.value = "25,01";
form.date.value = "2026-10-14";
form.account.value = savedDb.accounts[0].id;
form.to.value = form.account.value;
app.saveOperation({ target: form, preventDefault() {} });
assert.match(node("#operation-form-error").textContent, /два разных/);
assert.equal(JSON.stringify(state.db), manualBefore);
clickAction({ action: "chooseOperationType", operationType: "expense" });
clickAction({ action: "chooseOperationCategory", operationCategory: "Продукты" });
form.elements.name.value = "Ручная проверка";
form.elements.note.value = "Комментарий";
form.amount.value = "25,01";
form.date.value = "2026-10-14";
app.saveOperation({ target: form, preventDefault() {} });
const created = state.db.ops.find((o) => o.name === "Ручная проверка");
assert.equal(created.amountMinor, 2501);
assert.equal(created.note, "Комментарий");
assert.equal(created.to, undefined);
app.edit(created.id);
assert.equal(form.elements.note.value, "Комментарий");
form.amount.value = "26.02";
app.saveOperation({ target: form, preventDefault() {} });
assert.equal(state.db.ops.filter((o) => o.id === created.id).length, 1);
assert.equal(state.db.ops.find((o) => o.id === created.id).amountMinor, 2602);
console.log(
  "PASS: form recent account/categories, year-boundary date chips, automatic transfer fields, invalid self-transfer preserves budget, comma/dot sums, comment persistence and edit without duplication",
);

// 1.9.12 regression contracts; actual geometry is covered separately in Playwright.
const originalDb1912 = state.db;
const { budgetOfBytes } = await import("./budget-size-fixture.mjs");
state.db = budgetOfBytes(1519999);
app.go("Обзор");
assert.equal(node("#budget-storage-warning").hidden, true);
state.db = budgetOfBytes(1520000);
app.render();
assert.equal(node("#budget-storage-warning").hidden, false);
state.db = originalDb1912;
node(".chart-scroll").scrollWidth = 864;
app.go("Аналитика");
assert.equal(node(".chart-scroll").scrollLeft, 864);
assert.match(
  analytics.flowChart(analytics.monthlySeries(state.db.ops, "2026-10", 6)),
  /min-width:0px/,
);
assert.equal(analytics.chartMonthLabel("2026-06"), "июнь");
assert.ok(
  !analytics.flowChart(analytics.monthlySeries(state.db.ops, "2026-10", 6)).includes("<tspan"),
);
assert.match(
  analytics.flowChart(analytics.monthlySeries(state.db.ops, "2026-01", 6)),
  /<tspan[^>]*>2026<\/tspan>/,
);
state.draft = [
  {
    name: "Покупка",
    amountMinor: 100,
    type: "expense",
    date: "2026-10-01",
    account: "card",
    category: "Продукты",
    selected: true,
  },
];
state.importCompleted = null;
app.go("Импорт");
assert.equal(node("#app-header").dataset.importStep, "review");
assert.match(node("#content").innerHTML, /Автоматически по скриншоту/);
state.importCompleted = { count: 1 };
app.render();
assert.equal(node("#app-header").dataset.importStep, "done");
clickAction({ action: "backFromImport" });
assert.equal(node("#app-header").dataset.importStep, "");
assert.equal(state.page, "Обзор");
for (const file of readdirSync("public").filter(
  (name) => name.endsWith(".js") || name === "app.html",
)) {
  const source = readFileSync("public/" + file, "utf8");
  assert.ok(
    !/action_\w+_\d+|data-action-args/.test(source),
    file + ": numbered actions and positional JSON args must not return",
  );
}
console.log(
  "PASS: 80% capacity warning boundary, latest chart scroll, six-month responsive markup, month/year labels, review/done/back chrome, meaningful actions with named data attributes",
);
