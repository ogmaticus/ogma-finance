import { icon } from "./icons.js?v=32";
import { state } from "./state.js?v=32";
import { liveRecords } from "./sync-core.js?v=32";
import { budgetMonth, limit } from "./budget-ui.js?v=32";
import { FinanceBudget } from "./budget-core.js?v=32";
import { importVisual } from "./import-ui.js?v=32";
import { esc, money, $ } from "./format.js?v=32";
import { financeMonthTitle, shiftHistoryMonth, openMonthPicker } from "./month-picker.js?v=32";
import { opRows, edit } from "./app.js?v=32";
import { animateDialogClose } from "./ui.js?v=32";
export function historyCategories() {
  return [...new Set([...state.cats, ...liveRecords("ops").map((o) => o.category)])];
}
export function categoryHistoryRows(category, month = "") {
  return liveRecords("ops")
    .filter((o) => o.category === category && (!month || o.date.startsWith(month)))
    .slice()
    .sort((a, b) => (b.date + (b.time || "")).localeCompare(a.date + (a.time || "")));
}
export function categoriesView() {
  const names = historyCategories(),
    month = budgetMonth(),
    plans = new Map(
      FinanceBudget.report(state.db, month, state.cats).rows.map((row) => [row.category, row]),
    );
  return `<div class="category-grid">${names
    .map((category, i) => {
      const rows = categoryHistoryRows(category),
        expense = rows.filter((o) => o.type === "expense").reduce((s, o) => s + o.amountMinor, 0),
        refund = rows.filter((o) => o.type === "refund").reduce((s, o) => s + o.amountMinor, 0),
        income = rows.filter((o) => o.type === "income").reduce((s, o) => s + o.amountMinor, 0),
        visual = importVisual({ type: category === "Перевод" ? "transfer" : "expense", category }),
        plan = category === "Перевод" ? null : plans.get(category);
      return `<div class="category-tile"><button type="button" class="category-tile-main" data-action="showHistoryCategory" data-action-event="click" data-index="${esc(i)}"><span class="import-visual ${visual.tone}">${visual.icon}</span><b>${esc(category)}</b><small>${rows.length} операций · вся история</small><span class="category-tile-total">${expense || refund ? money(expense - refund) : income ? "+" + money(income) : category === "Перевод" ? money(rows.reduce((s, o) => s + o.amountMinor, 0)) : "—"}</span></button>${plan ? `<div class="category-tile-plan"><small>${esc(financeMonthTitle(month))} · ${plan.hasLimit ? "лимит " + money(plan.limit) : "без лимита"}</small><button type="button" class="category-limit-button" data-category="${esc(category)}" data-month="${month}" data-action="editCategoryTileLimit" data-action-event="click">${plan.hasLimit ? "Изменить лимит" : "Задать лимит"}</button></div>` : ""}</div>`;
    })
    .join("")}</div>`;
}
export function categoryLimitHTML(category, month) {
  const row =
    category === "Перевод"
      ? null
      : FinanceBudget.report(state.db, month, state.cats).rows.find(
          (row) => row.category === category,
        );
  if (!row) return "";
  return `<div class="category-budget-control ${row.status}"><div><small>ЛИМИТ · ${esc(financeMonthTitle(month))}</small><b>${row.hasLimit ? money(row.limit) : "Лимит не задан"}</b><span>Расходы ${money(row.spent)}${row.hasLimit ? " · " + (row.remaining < 0 ? "превышение " + money(-row.remaining) : "осталось " + money(row.remaining)) : ""}</span></div><button type="button" class="primary" data-category="${esc(category)}" data-month="${month}" data-action="editHistoryCategoryLimit" data-action-event="click">${row.hasLimit ? "Изменить лимит" : "Задать лимит"}</button></div>`;
}
export function showCategoryHistory(category, month = "") {
  state.historyCategory = category;
  state.historyMonth = month;
  renderCategoryHistory();
  $("#categoryhistory").showModal();
}
export function renderCategoryHistory() {
  const rows = categoryHistoryRows(state.historyCategory, state.historyMonth),
    expense = rows.filter((o) => o.type === "expense").reduce((s, o) => s + o.amountMinor, 0),
    refund = rows.filter((o) => o.type === "refund").reduce((s, o) => s + o.amountMinor, 0),
    income = rows.filter((o) => o.type === "income").reduce((s, o) => s + o.amountMinor, 0),
    transfers = rows.filter((o) => o.type === "transfer").reduce((s, o) => s + o.amountMinor, 0);
  $("#categoryhistorycontent").innerHTML =
    `<div class="category-history-head"><div><small>ИСТОРИЯ КАТЕГОРИИ</small><h2>${esc(state.historyCategory)}</h2></div><button aria-label="Закрыть" data-action="closeCategoryHistory" data-action-event="click">${icon("close")}</button></div><div class="actions"><div class="month-control history-month-control" role="group" aria-label="Месяц истории"><button type="button" aria-label="Предыдущий месяц истории" data-action="previousHistoryMonth" data-action-event="click">${icon("chevron-left")}</button><button type="button" class="month-label" aria-haspopup="dialog" data-action="chooseHistoryMonth" data-action-event="click">${state.historyMonth ? esc(financeMonthTitle(state.historyMonth)) : "Все месяцы"}</button><button type="button" aria-label="Следующий месяц истории" data-action="nextHistoryMonth" data-action-event="click">${icon("chevron")}</button></div><button data-action="clearHistoryMonth" data-action-event="click">Все даты</button></div>${categoryLimitHTML(state.historyCategory, state.historyMonth || budgetMonth())}<div class="category-history-stats"><span>Расходы <b>${money(expense - refund)}</b></span><span>Поступления <b class="positive">${money(income)}</b></span>${refund ? `<span>Возвраты <b>${money(refund)}</b></span>` : ""}${transfers ? `<span>Между своими <b>${money(transfers)}</b></span>` : ""}</div><div>${rows.length ? opRows(rows) : '<p class="muted">Операций за этот период нет.</p>'}</div>`;
}
export async function editFromCategory(id) {
  await animateDialogClose($("#categoryhistory"));
  edit(id);
}
export function showHistoryCategory(event, element) {
  return showCategoryHistory(historyCategories()[Number(element.dataset.index)]);
}
export function editCategoryTileLimit(event, element) {
  return limit(element.dataset.category, element.dataset.month);
}
export function editHistoryCategoryLimit(event, element) {
  return limit(element.dataset.category, element.dataset.month);
}
export function closeCategoryHistory(event, element) {
  return animateDialogClose(document.getElementById("categoryhistory"));
}
export function previousHistoryMonth(event, element) {
  return shiftHistoryMonth(-1);
}
export function chooseHistoryMonth(event, element) {
  return openMonthPicker("history");
}
export function nextHistoryMonth(event, element) {
  return shiftHistoryMonth(1);
}
export function clearHistoryMonth(event, element) {
  state.historyMonth = "";
  renderCategoryHistory();
}
