import assert from "node:assert/strict";
import { state } from "../public/state.js?v=31";
import {
  operationGroups,
  operationDateTitle,
  operationsRows,
  filterOperations,
  renderOperations,
  toggleOperationFilters,
  updateOperationFilters,
  resetOperationFilters,
} from "../public/operations-ui.js?v=31";
const accounts = [
  { id: "a", name: "Основная", last4: "1144", openingMinor: 0 },
  { id: "b", name: "Накопления", openingMinor: 0 },
];
const rows = [
  {
    id: "a1",
    name: "<Покупка>",
    type: "expense",
    category: "Продукты",
    account: "a",
    date: "2026-10-13",
    time: "09:00",
    amountMinor: 10001,
    localScreenshot: true,
    sourceId: "x",
  },
  {
    id: "a2",
    name: "Возврат",
    type: "refund",
    category: "Продукты",
    account: "a",
    date: "2026-10-13",
    time: "10:00",
    amountMinor: 1,
  },
  {
    id: "a3",
    name: "Поступление",
    type: "income",
    category: "Зарплата",
    account: "a",
    date: "2026-10-13",
    time: "11:00",
    amountMinor: 50000,
  },
  {
    id: "a4",
    name: "Между своими",
    type: "transfer",
    category: "Перевод",
    account: "a",
    to: "b",
    date: "2026-10-14",
    amountMinor: 20000,
  },
  {
    id: "a5",
    name: "Удалённая",
    type: "expense",
    category: "Продукты",
    account: "a",
    date: "2026-10-14",
    amountMinor: 99999,
    deletedAt: "2026-10-14T12:00:00.000Z",
  },
];
const before = JSON.stringify(rows),
  groups = operationGroups(rows);
assert.deepEqual(
  groups.map((g) => [g.date, g.expenseMinor]),
  [
    ["2026-10-14", 0],
    ["2026-10-13", 10000],
  ],
);
assert.deepEqual(
  groups[1].rows.map((o) => o.id),
  ["a3", "a2", "a1"],
);
assert.equal(operationDateTitle("2026-10-14", "2026-10-14"), "Сегодня");
assert.equal(operationDateTitle("2026-09-30", "2026-10-01"), "Вчера");
assert.match(operationDateTitle("2026-10-07", "2026-10-14"), /7 октября/);
assert.equal(filterOperations(rows, { account: "b" })[0].id, "a4");
assert.deepEqual(
  filterOperations(rows, { query: " ПРОДУКТЫ ", type: "refund" }).map((o) => o.id),
  ["a2"],
);
const html = operationsRows(rows, accounts);
assert.match(html, /&lt;Покупка&gt;/);
assert.ok(!html.includes("<Покупка>"));
assert.ok(!html.includes("Удалённая"));
assert.match(html, /operation-source/);
assert.match(html, /1144/);
assert.equal(JSON.stringify(rows), before);
const elements = new Map();
const node = (id) => {
  if (!elements.has(id))
    elements.set(id, {
      value: "",
      hidden: false,
      dataset: {},
      setAttribute(k, v) {
        this[k] = v;
      },
      classList: { toggle() {} },
      focus() {
        this.focused = true;
      },
    });
  return elements.get(id);
};
globalThis.document = { querySelector: node };
state.db = { schemaVersion: 3, ops: rows, accounts, goals: [], merchantRules: [], limits: {} };
state.operationFilters = { query: "", type: "", account: "", expanded: false };
node("#month").value = "2026-10";
const budgetBefore = JSON.stringify(state.db);
renderOperations();
assert.equal(node("#operations-count").textContent, "Операций: 4");
toggleOperationFilters();
assert.equal(node("#operation-filters").hidden, false);
assert.equal(node("#operations-filter-toggle")["aria-expanded"], "true");
node("#filter").value = "refund";
updateOperationFilters();
assert.equal(node("#operations-count").textContent, "Операций: 1");
assert.match(node("#list").innerHTML, /По фильтру/);
toggleOperationFilters();
assert.equal(node("#operation-filters").hidden, true);
assert.equal(state.operationFilters.type, "refund");
renderOperations();
assert.equal(node("#filter").value, "refund");
resetOperationFilters();
assert.equal(node("#operations-count").textContent, "Операций: 4");
node("#month").value = "2026-11";
renderOperations();
assert.equal(node("#operations-count").textContent, "Операций: 0");
assert.equal(JSON.stringify(state.db), budgetBefore);
console.log(
  "PASS: daily integer totals exclude transfers/income and include refunds; deleted rows hidden, chronological order, escaped labels, screenshot access, filters and both transfer accounts, navigation/re-render and budget preservation",
);
