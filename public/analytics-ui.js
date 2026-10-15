import { FinanceData } from "./data-model.js?v=32";
import { Money } from "./money.js?v=32";
import { FinanceBudget } from "./budget-core.js?v=32";
import { $, esc, money } from "./format.js?v=32";
import { state } from "./state.js?v=32";
import { render } from "./app.js?v=32";
import { icon, categoryVisual } from "./icons.js?v=32";

export function monthlyFlow(ops, month) {
  let incomeMinor = 0,
    purchaseMinor = 0,
    refundMinor = 0;
  for (const o of FinanceData.live(ops).filter((o) => o.date.startsWith(month))) {
    if (o.type === "income") incomeMinor = Money.add(incomeMinor, o.amountMinor);
    if (o.type === "expense") purchaseMinor = Money.add(purchaseMinor, o.amountMinor);
    if (o.type === "refund") refundMinor = Money.add(refundMinor, o.amountMinor);
  }
  const expenseMinor = Money.add(purchaseMinor, -refundMinor);
  return {
    month,
    incomeMinor,
    purchaseMinor,
    refundMinor,
    expenseMinor,
    netMinor: Money.add(incomeMinor, -expenseMinor),
  };
}
export function monthlySeries(ops, month, count = 6) {
  const months = [month];
  for (let i = 1; i < count; i++) months.unshift(FinanceBudget.previousMonth(months[0]));
  return months.map((m) => monthlyFlow(ops, m));
}
export function comparison(current, previous) {
  if (current === previous) return "Без изменений";
  if (previous <= 0)
    return previous === 0 ? "Нет суммы для сравнения" : "В прошлом месяце возвраты выше расходов";
  const percent = ((current - previous) / previous) * 100;
  return `${percent > 0 ? "+" : "−"}${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(Math.abs(percent))}% к прошлому месяцу`;
}
export function categoryComparisons(data, month) {
  const prior = FinanceBudget.previousMonth(month),
    current = FinanceBudget.report(
      data,
      month,
      FinanceData.live(data.ops).map((o) => o.category),
    ),
    previous = FinanceBudget.report(data, prior),
    p = new Map(previous.rows.map((r) => [r.category, r.spent]));
  return current.rows
    .filter((r) => r.spent !== 0 || p.get(r.category))
    .map((r) => ({
      ...r,
      previousMinor: p.get(r.category) || 0,
      comparison: comparison(r.spent, p.get(r.category) || 0),
    }))
    .sort((a, b) => b.spent - a.spent || a.category.localeCompare(b.category, "ru"));
}
function monthLabel(m) {
  return new Intl.DateTimeFormat("ru-RU", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(m + "-01T12:00:00Z"));
}
export function chartMonthLabel(month) {
  return [
    "янв.",
    "февр.",
    "март",
    "апр.",
    "май",
    "июнь",
    "июль",
    "авг.",
    "сент.",
    "окт.",
    "нояб.",
    "дек.",
  ][Number(month.slice(5)) - 1];
}
export function revealCurrentChartMonth() {
  const container = document.querySelector(".chart-scroll");
  if (container) container.scrollLeft = container.scrollWidth;
}
export function flowChart(series) {
  const width = series.length === 6 ? 300 : series.length * 72,
    top = 20,
    bottom = 200,
    lo = Math.min(0, ...series.map((m) => m.expenseMinor)),
    hi = Math.max(1, ...series.flatMap((m) => [m.incomeMinor, m.expenseMinor])),
    span = hi - lo,
    y = (n) => bottom - ((n - lo) / span) * (bottom - top),
    zero = y(0),
    step = (width - 20) / series.length;
  return `<div class="chart-scroll" tabindex="0" aria-label="График по месяцам, можно прокрутить"><svg class="flow-chart" data-months="${series.length}" viewBox="0 0 ${width} 250" style="min-width:${series.length === 6 ? 0 : width}px" role="img" aria-label="Доходы и расходы за ${series.length} месяцев"><title>Расходы с учётом возвратов и доходы</title><line class="chart-zero" x1="10" y1="${zero}" x2="${width - 10}" y2="${zero}"/>${series
    .map((m, i) => {
      const x = 10 + i * step + step / 2;
      return `<g data-month="${m.month}"><title>${esc(monthLabel(m.month))}: доходы ${money(m.incomeMinor)}, расходы ${money(m.expenseMinor)}</title><rect class="chart-income" x="${x - 12}" y="${Math.min(zero, y(m.incomeMinor))}" width="10" height="${Math.abs(y(m.incomeMinor) - zero)}" rx="4"/><rect class="chart-expense" x="${x + 2}" y="${Math.min(zero, y(m.expenseMinor))}" width="10" height="${Math.abs(y(m.expenseMinor) - zero)}" rx="4"/><text x="${x}" y="225" text-anchor="middle">${esc(chartMonthLabel(m.month))}${m.month.endsWith("-01") ? `<tspan x="${x}" dy="18">${m.month.slice(0, 4)}</tspan>` : ""}</text></g>`;
    })
    .join(
      "",
    )}</svg></div><details class="chart-values"><summary>Суммы по месяцам</summary><table><caption>Доходы и расходы после возвратов, ₽</caption><thead><tr><th>Месяц</th><th>Доходы</th><th>Расходы</th></tr></thead><tbody>${series.map((m) => `<tr><th>${esc(monthLabel(m.month))}</th><td>${money(m.incomeMinor)}</td><td>${money(m.expenseMinor)}</td></tr>`).join("")}</tbody></table></details>`;
}
export function analyticsMarkup(data, month, count = 6) {
  const current = monthlyFlow(data.ops, month),
    prev = monthlyFlow(data.ops, FinanceBudget.previousMonth(month)),
    groups = categoryComparisons(data, month),
    positive = groups.reduce((s, r) => Money.add(s, Math.max(0, r.spent)), 0),
    max = Math.max(1, ...groups.map((r) => r.spent));
  return `<div class="analytics-summary"><section class="card"><small>Расходы после возвратов</small><b>${money(current.expenseMinor)}</b><span>${esc(comparison(current.expenseMinor, prev.expenseMinor))}</span></section><section class="card"><small>Доходы за месяц</small><b class="positive">${money(current.incomeMinor)}</b><span>${esc(comparison(current.incomeMinor, prev.incomeMinor))}</span></section><section class="card"><small>Разница доходов и расходов</small><b>${money(current.netMinor)}</b><span>Возвраты: ${money(current.refundMinor)}</span></section></div><section class="card analytics-chart"><div class="analytics-heading"><h2>По месяцам</h2><div class="range-buttons" role="group" aria-label="Период графика">${[6, 12].map((n) => `<button type="button" data-action="setAnalyticsRange" data-action-event="click" data-range="${n}" aria-pressed="${n === count}">${n} мес.</button>`).join("")}</div></div><div class="chart-legend"><span><i class="income"></i>Доходы</span><span><i class="expense"></i>Расходы после возвратов</span></div>${flowChart(monthlySeries(data.ops, month, count))}</section><section class="card analytics-categories"><h2>Расходы по категориям</h2><p class="muted">По убыванию суммы. Возвраты уменьшают расходы своей категории.</p>${
    groups
      .map((r) => {
        const visual = categoryVisual(r.category, "expense");
        return `<button type="button" class="analytics-category" data-category="${esc(r.category)}" data-month="${month}" data-action="showAnalyticsCategoryHistory" data-action-event="click"><span class="category-symbol ${visual.tone}">${icon(visual.icon)}</span><span><b>${esc(r.category)}</b><small>${esc(r.comparison)}</small></span><strong>${money(r.spent)}<small>${r.spent > 0 && positive ? new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format((r.spent / positive) * 100) + "%" : r.spent < 0 ? "Возвраты выше покупок" : "0%"}</small></strong><span class="analytics-category-bar"><i style="width:${(Math.max(0, r.spent) / max) * 100}%"></i></span></button>`;
      })
      .join("") || '<p class="muted">За этот месяц расходов нет.</p>'
  }</section>`;
}
export function setAnalyticsRange(event, element) {
  const range = Number(element.dataset.range);
  if (![6, 12].includes(range)) return;
  state.analyticsRange = range;
  render();
}
export function analyticsView() {
  return analyticsMarkup(state.db, $("#month").value, state.analyticsRange);
}
