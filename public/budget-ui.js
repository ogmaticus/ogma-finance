import { Money } from "./money.js?v=34";
import { state } from "./state.js?v=34";
import { $, money, esc } from "./format.js?v=34";
import { icon, categoryVisual } from "./icons.js?v=34";
import { FinanceBudget } from "./budget-core.js?v=34";
import { save, render } from "./app.js?v=34";
import { renderCategoryHistory, showCategoryHistory } from "./category-history.js?v=34";
import { animateDialogClose, showNotice, askConfirm } from "./ui.js?v=34";
export function budgetMonth() {
  return $("#month").value;
}
export function budgetMonthLabel(month) {
  return new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(month + "-01T00:00:00Z"))
    .replace(/\s*г\.$/, "");
}
export function budgetOwner() {
  return state.cloudSession?.user?.id || "guest";
}
export function budgetRowHTML(row, month) {
  const visual = categoryVisual(row.category, "expense");
  const label =
    row.status === "over"
      ? "Превышение на " + money(-row.remaining)
      : row.status === "near"
        ? row.remaining === 0
          ? "Лимит исчерпан"
          : "Осталось " + money(row.remaining)
        : row.hasLimit
          ? "Осталось " + money(row.remaining)
          : "Без лимита";
  return `<button type="button" class="compact-budget-row ${row.status}" data-category="${esc(row.category)}" data-month="${month}" data-action="editBudgetCategoryLimit" data-action-event="click" aria-label="${row.hasLimit ? "Изменить лимит" : "Задать лимит"}: ${esc(row.category)}"><span class="category-symbol ${visual.tone}">${icon(visual.icon)}</span><span class="compact-budget-copy"><b>${esc(row.category)}</b><small>${money(row.spent)}${row.hasLimit ? " из " + money(row.limit) : " · без лимита"}</small></span>${icon("chevron")}<span class="compact-budget-progress" role="meter" aria-label="Использовано лимита ${esc(row.category)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.min(100, Math.round(row.percent))}"><i style="width:${Math.min(100, row.percent)}%"></i></span><span class="compact-budget-state">${label}</span></button>`;
}
export function budgetRows(count = 999) {
  const month = budgetMonth(),
    report = FinanceBudget.report(state.db, month, state.cats),
    rank = { over: 0, near: 1, ok: 2, unplanned: 3 };
  const sorted = report.rows
      .slice()
      .sort((a, b) => rank[a.status] - rank[b.status] || b.spent - a.spent)
      .slice(0, count),
    visible = sorted.filter((r) => r.hasLimit || r.spent !== 0),
    hidden = sorted.filter((r) => !r.hasLimit && r.spent === 0);
  return (
    visible.map((r) => budgetRowHTML(r, month)).join("") +
    (hidden.length
      ? `<details class="unused-categories"><summary>Ещё ${hidden.length} категорий</summary>${hidden.map((r) => budgetRowHTML(r, month)).join("")}</details>`
      : "")
  );
}
export function budgetAlerts(report, month) {
  const rows = [...report.over, ...report.near];
  if (!rows.length) return "";
  return `<div class="budget-alerts" role="status">${rows.map((row) => `<button class="budget-alert ${row.status}" data-category="${esc(row.category)}" data-month="${month}" data-action="showAnalyticsCategoryHistory" data-action-event="click"><b>${esc(row.category)}</b><span>${row.status === "over" ? "Превышение на " + money(-row.remaining) : row.remaining === 0 ? "Лимит исчерпан" : "Использовано " + Math.floor(row.percent) + "% · осталось " + money(row.remaining)}</span><span aria-hidden="true">→</span></button>`).join("")}</div>`;
}
export function budgetView() {
  const month = budgetMonth(),
    report = FinanceBudget.report(state.db, month, state.cats),
    hasPlan = report.rows.some((row) => row.hasLimit);
  return `<div class="budget-heading"><div><small class="import-kicker">ПЛАН НА МЕСЯЦ</small><h2>${esc(budgetMonthLabel(month))}</h2><p class="muted">${report.explicit ? "Лимиты сохранены для этого месяца." : Object.keys(state.db.limits).length ? "Использован прежний план. Изменения сохранятся только для этого месяца." : "Задайте лимиты нужным категориям."}</p></div><button data-action="copyPriorMonthBudget" data-action-event="click">Взять план прошлого месяца</button></div><div class="grid budget-summary"><div class="card"><small>План расходов</small><div class="money">${hasPlan ? money(report.totalLimit) : "Не задан"}</div><p class="muted">${report.rows.filter((row) => row.hasLimit).length} категорий с лимитами</p></div><div class="card"><small>Потрачено по плану</small><div class="money">${money(report.plannedSpent)}</div><p class="muted">Расходы за вычетом возвратов</p></div><div class="card ${report.remaining < 0 ? "budget-exceeded" : "budget-remaining"}"><small>${report.remaining < 0 ? "Превышение плана" : "Осталось по плану"}</small><div class="money">${hasPlan ? money(Math.abs(report.remaining)) : "—"}</div><p class="muted">По категориям с лимитами</p></div></div>${budgetAlerts(report, month)}${report.unplanned.length ? `<div class="budget-unplanned"><div><b>Без лимитов: ${money(report.unplannedSpent)}</b><small>${report.unplanned.length} категорий · эти расходы не вычитаются из остатка по плану</small></div><span>Всего за месяц ${money(report.totalSpent)}</span></div>` : ""}<div class="card budget-plan compact-budget"><div class="budget-list-heading"><h2>Категории расходов</h2><small>Нажмите строку, чтобы задать или изменить лимит</small></div>${budgetRows()}</div>`;
}
export function overviewBudgetStatus(report) {
  if (!report.rows.some((row) => row.hasLimit)) return "Лимиты на месяц не заданы";
  return (
    (report.remaining < 0
      ? "Превышение плана: " + money(-report.remaining)
      : "Осталось по плану: " + money(report.remaining)) +
    (report.unplanned.length ? " · без лимитов " + money(report.unplannedSpent) : "")
  );
}
export function limit(category, month = budgetMonth()) {
  if (!FinanceBudget.validMonth(month)) return;
  const limits = FinanceBudget.plan(state.db, month),
    exists = Object.prototype.hasOwnProperty.call(limits, category);
  state.budgetEditContext = { category, month, owner: budgetOwner() };
  $("#budgetlimittitle").textContent = category;
  $("#budgetlimitmonth").textContent = "Лимит на " + budgetMonthLabel(month);
  $("#budgetlimitamount").value = exists ? Money.input(limits[category]) : "";
  $("#budgetlimiterror").textContent = "";
  $("#budgetlimitremove").hidden = !exists;
  $("#budgetlimitdialog").showModal();
}
export function saveMonthlyLimit(event, remove = false) {
  event?.preventDefault();
  const context = state.budgetEditContext;
  if (!context || context.owner !== budgetOwner()) {
    $("#budgetlimiterror").textContent = "Аккаунт изменился. Откройте лимит заново.";
    return;
  }
  const raw = $("#budgetlimitamount").value.trim(),
    value = remove || raw === "" ? null : Money.toMinor(raw);
  try {
    state.db = FinanceBudget.setLimit(state.db, context.month, context.category, value);
    save();
    render();
    if ($("#categoryhistory").open) renderCategoryHistory();
    state.budgetEditContext = null;
    animateDialogClose($("#budgetlimitdialog"));
  } catch (error) {
    $("#budgetlimiterror").textContent = error.message;
  }
}
export async function copyPreviousBudget() {
  const month = budgetMonth(),
    owner = budgetOwner(),
    previous = FinanceBudget.previousMonth(month),
    limits = FinanceBudget.plan(state.db, previous);
  if (!Object.keys(limits).length) {
    await showNotice("В прошлом месяце лимиты не заданы.");
    return;
  }
  if (
    !(await askConfirm(
      `Взять лимиты за ${budgetMonthLabel(previous)} для ${budgetMonthLabel(month)}? Текущий план выбранного месяца будет заменён, операции останутся.`,
      "Взять план",
    ))
  )
    return;
  if (owner !== budgetOwner()) {
    await showNotice("Аккаунт изменился. Повторите действие.");
    return;
  }
  state.db = FinanceBudget.copyPlan(state.db, previous, month);
  save();
  render();
}
export function showBudgetCategoryHistory(event, element) {
  return showCategoryHistory(element.dataset.category, element.dataset.month);
}
export function editBudgetCategoryLimit(event, element) {
  return limit(element.dataset.category, element.dataset.month);
}
export function showAnalyticsCategoryHistory(event, element) {
  return showCategoryHistory(element.dataset.category, element.dataset.month);
}
export function copyPriorMonthBudget(event, element) {
  return copyPreviousBudget();
}
