import { $, esc, money } from "./format.js?v=32";
import { localDate, operationDateOrder } from "./dates.js?v=32";
import { icon, categoryVisual } from "./icons.js?v=32";
import { go, edit, openOperationFromRow } from "./app.js?v=32";
import { animateDialogClose } from "./ui.js?v=32";
import { themeControls } from "./appearance.js?v=32";

const SECONDARY = [
  ["Аналитика", "analytics", "Расходы и доходы"],
  ["Счета", "accounts", "Карты, счета и остатки"],
  ["Цели", "goals", "Накопления и планы"],
  ["Категории", "categories", "Категории и правила магазинов"],
  ["Личный кабинет", "profile", "Аккаунт, копии и скриншоты"],
  ["Настройки", "settings", "Тема и оформление"],
];
export function navigationMarkup(page) {
  const active = ["Обзор", "Операции", "Бюджет"].includes(page) ? page : "Ещё";
  return [
    ["Обзор", "overview"],
    ["Операции", "operations"],
    ["+", "plus"],
    ["Бюджет", "budget"],
    ["Ещё", "more"],
  ]
    .map(([label, name]) =>
      label === "+"
        ? `<button type="button" class="shell-add" data-action="openAddChooser" data-action-event="click" aria-label="Добавить операцию">${icon(name)}<span>Добавить</span></button>`
        : `<button type="button" data-page="${label}" data-action="navigatePage" data-action-event="click" class="${active === label ? "active" : ""}" ${active === label ? 'aria-current="page"' : ""}>${icon(name)}<span>${label}</span></button>`,
    )
    .join("");
}
export function moreMarkup() {
  return `<div class="more-grid">${SECONDARY.map(([page, name, caption]) => `<button type="button" class="more-link" data-page="${page}" data-action="navigatePage" data-action-event="click">${icon(name)}<span><b>${page === "Категории" ? "Категории и правила" : page}</b><small>${caption}</small></span>${icon("chevron")}</button>`).join("")}</div><button type="button" class="more-theme" data-action="toggleTheme" data-action-event="click">Сменить светлую / тёмную тему</button>`;
}
export function settingsMarkup() {
  return themeControls();
}
export function navigatePage(event, element) {
  if (
    !["Обзор", "Операции", "Бюджет", "Ещё", ...SECONDARY.map(([page]) => page)].includes(
      element.dataset.page,
    )
  )
    return;
  go(element.dataset.page);
  $("#title").focus?.({ preventScroll: true });
  window.scrollTo?.({ top: 0, behavior: "instant" });
}
export function openAddChooser() {
  $("#adddialog").showModal();
}
export function closeAddChooser() {
  return animateDialogClose($("#adddialog"));
}
export async function chooseAdd(event, element) {
  await animateDialogClose($("#adddialog"));
  if (element.dataset.addMode === "screenshot") go("Импорт");
  else if (element.dataset.addMode === "manual") edit();
}
export function openOverviewOperation(event, element) {
  if (element.closest) return openOperationFromRow(element.dataset.opId, element);
  edit(element.dataset.opId);
}
export function operationDayLabel(date, today = localDate()) {
  if (date === today) return "Сегодня";
  const yesterday = new Date(today + "T12:00:00Z");
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  if (date === yesterday.toISOString().slice(0, 10)) return "Вчера";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(date + "T12:00:00Z"));
}
export function monthProgress(month, today = localDate()) {
  const [year, number] = month.split("-").map(Number);
  const end = new Date(0);
  end.setUTCHours(12, 0, 0, 0);
  end.setUTCFullYear(year, number, 0);
  const days = end.getUTCDate();
  const elapsed =
    month < today.slice(0, 7) ? days : month > today.slice(0, 7) ? 0 : Number(today.slice(8));
  return { days, elapsed, percent: (elapsed / days) * 100 };
}
export function overviewMarkup({
  all,
  income,
  expense,
  report,
  ops,
  accounts,
  month,
  hasImported,
}) {
  const progress = monthProgress(month);
  const hasPlan = report.rows.some((row) => row.hasLimit);
  const latest = ops.slice().sort(operationDateOrder).slice(0, 5);
  const alerts = [...report.over, ...report.near].sort((a, b) => b.percent - a.percent);
  const rows = latest
    .map((o) => {
      const v = categoryVisual(o.category, o.type);
      const a = accounts.find((account) => account.id === o.account),
        to = accounts.find((account) => account.id === o.to);
      const accountLabel = (account) =>
        account
          ? account.name +
            (account.last4 && !account.name.includes(account.last4) ? " •" + account.last4 : "")
          : "Счёт не найден";
      const meta =
        o.type === "transfer"
          ? `${accountLabel(a)} → ${accountLabel(to)}`
          : `${o.category} · ${accountLabel(a)}`;
      const amount =
        (["income", "refund"].includes(o.type) ? "+" : o.type === "transfer" ? "" : "−") +
        money(o.amountMinor);
      return `<button type="button" class="overview-operation ${o.type}" data-op-id="${esc(o.id)}" data-action="openOverviewOperation" data-action-event="click" aria-label="${esc(o.name + ", " + amount + ", " + meta)}"><span class="category-symbol ${v.tone}">${icon(v.icon)}</span><span class="overview-operation-main"><b>${esc(o.name)}</b><small>${esc(operationDayLabel(o.date))} · ${esc(meta)}${o.type === "refund" ? " · Возврат" : ""}</small></span><strong>${amount}</strong></button>`;
    })
    .join("");
  return `<div class="overview-layout"><section class="overview-balance"><div class="balance-label"><span>Всего на счетах</span>${icon("transfer")}</div><div class="balance-amount">${money(all)}</div><div class="balance-month"><div><small>Доходы за месяц</small><b>${money(income)}</b></div><div><small>Расходы за месяц</small><b>${money(expense)}</b></div></div></section><section class="overview-plan"><div><small>${report.remaining < 0 ? "Превышение плана" : "Осталось по плану"}</small><b>${hasPlan ? money(Math.abs(report.remaining)) : "План не задан"}</b></div><button type="button" data-page="Бюджет" data-action="navigatePage" data-action-event="click" aria-label="Открыть бюджет">${icon("budget")}</button><div class="month-progress"><small>${progress.elapsed} из ${progress.days} дней</small><span class="progress-track" role="progressbar" aria-label="Прошло дней месяца" aria-valuemin="0" aria-valuemax="${progress.days}" aria-valuenow="${progress.elapsed}"><i style="width:${progress.percent}%"></i></span></div>${report.unplanned.length ? `<p class="muted plan-unplanned">Без лимитов: ${money(report.unplannedSpent)}</p>` : ""}</section>${alerts.length ? `<section class="overview-attention"><h2>${icon("alert")}Внимание</h2>${alerts.map((row) => `<button type="button" class="overview-alert ${row.status}" data-category="${esc(row.category)}" data-month="${month}" data-action="showAnalyticsCategoryHistory" data-action-event="click"><span><b>${esc(row.category)}</b><small>${row.status === "over" ? "Превышение на " + money(-row.remaining) : "Использовано " + Math.floor(row.percent) + "% лимита"}</small></span>${icon("chevron")}</button>`).join("")}</section>` : ""}<section class="overview-recent"><div class="overview-section-title"><h2>Последние операции</h2><button type="button" data-page="Операции" data-action="navigatePage" data-action-event="click">Все</button></div>${rows || '<p class="muted">За этот месяц операций нет. Добавьте первую через «+».</p>'}</section>${!hasImported ? `<section class="overview-import"><span class="category-symbol purple">${icon("screenshot")}</span><div><h2>Добавьте со скриншота</h2><p class="muted">Загрузите историю банка и проверьте готовые операции.</p></div><button type="button" data-action="openScreenshotImport" data-action-event="click">Загрузить скриншот${icon("chevron")}</button></section>` : ""}</div>`;
}
