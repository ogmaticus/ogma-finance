import { state } from "./state.js?v=34";
import { $, esc, money } from "./format.js?v=34";
import { FinanceData } from "./data-model.js?v=34";
import { operationDateOrder, localDate } from "./dates.js?v=34";
import { icon, categoryVisual } from "./icons.js?v=34";

export function filterOperations(ops, filters = {}) {
  const query = (filters.query || "").normalize("NFKC").toLocaleLowerCase("ru-RU").trim();
  return FinanceData.live(ops).filter(
    (o) =>
      (!filters.type || o.type === filters.type) &&
      (!filters.account || o.account === filters.account || o.to === filters.account) &&
      (!query ||
        [o.name, o.category, o.note || ""]
          .join(" ")
          .normalize("NFKC")
          .toLocaleLowerCase("ru-RU")
          .includes(query)),
  );
}
export function operationGroups(ops) {
  const groups = new Map();
  for (const o of FinanceData.live(ops).slice().sort(operationDateOrder)) {
    if (!groups.has(o.date)) groups.set(o.date, { date: o.date, expenseMinor: 0, rows: [] });
    const g = groups.get(o.date);
    g.rows.push(o);
    if (o.type === "expense") g.expenseMinor += o.amountMinor;
    if (o.type === "refund") g.expenseMinor -= o.amountMinor;
  }
  return [...groups.values()];
}
export function operationDateTitle(date, today = localDate()) {
  if (date === today) return "Сегодня";
  const d = new Date(today + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  if (date === d.toISOString().slice(0, 10)) return "Вчера";
  return (
    new Intl.DateTimeFormat("ru-RU", {
      day: "numeric",
      month: "long",
      timeZone: "UTC",
    }).format(new Date(date + "T12:00:00Z")) +
    ", " +
    new Intl.DateTimeFormat("ru-RU", { weekday: "long", timeZone: "UTC" }).format(
      new Date(date + "T12:00:00Z"),
    )
  );
}
export function operationsRows(ops, accounts, filtered = false) {
  const accountLabel = (id) => {
    const a = accounts.find((x) => x.id === id);
    return a
      ? a.name + (a.last4 && !a.name.includes(a.last4) ? " •" + a.last4 : "")
      : "Счёт не найден";
  };
  return (
    operationGroups(ops)
      .map(
        (g) =>
          `<section class="operation-day"><div class="operation-day-heading"><h2>${esc(operationDateTitle(g.date))}</h2><span>${filtered ? "По фильтру" : "Расходы"}: ${money(g.expenseMinor)}</span></div>${g.rows
            .map((o) => {
              const visual = categoryVisual(o.category, o.type),
                route =
                  o.type === "transfer"
                    ? `${accountLabel(o.account)} → ${accountLabel(o.to)}`
                    : `${o.category} · ${accountLabel(o.account)}`,
                signed =
                  (["income", "refund"].includes(o.type) ? "+" : o.type === "expense" ? "−" : "") +
                  money(o.amountMinor),
                original = o.originalCurrency
                  ? ` · ${money(o.originalAmountMinor).replace(/\s*₽$/, "")} ${o.originalCurrency}`
                  : "",
                meta =
                  route +
                  (o.type === "refund" ? " · Возврат" : "") +
                  (o.time ? " · " + o.time : "") +
                  original +
                  (o.screenshotUnavailable ? " · исходник не найден" : ""),
                source = o.localScreenshot
                  ? `<button type="button" class="operation-source" data-source="${esc(o.sourceId)}" data-action="viewLocalScreenshot" data-action-event="click" aria-label="Скриншот: ${esc(o.name)}">${icon("screenshot")}</button>`
                  : o.screenshotId
                    ? `<a class="operation-source" href="/api/files/${encodeURIComponent(o.screenshotId)}" target="_blank" rel="noopener" aria-label="Скриншот: ${esc(o.name)}">${icon("screenshot")}</a>`
                    : "";
              return `<div class="operation-entry ${source ? "with-source" : ""}"><button type="button" class="operation-row ${o.type}" data-op-id="${esc(o.id)}" data-action="openOverviewOperation" data-action-event="click" aria-label="${esc(o.name + ", " + signed + ", " + meta)}"><span class="category-symbol ${visual.tone}">${icon(visual.icon)}</span><span class="operation-copy"><b>${esc(o.name)}</b><small title="${esc(meta)}">${esc(meta)}</small></span><strong>${signed}</strong></button>${source}</div>`;
            })
            .join("")}</section>`,
      )
      .join("") || '<div class="empty">Операций за этот период не найдено.</div>'
  );
}
export function renderOperations() {
  const f = state.operationFilters,
    accounts = FinanceData.live(state.db.accounts);
  $("#content").innerHTML =
    `<div class="operations-toolbar"><span id="operations-count" role="status"></span><button type="button" id="operations-filter-toggle" class="icon-button" data-action="toggleOperationFilters" data-action-event="click" aria-label="Поиск и фильтры" aria-expanded="${f.expanded}" aria-controls="operation-filters">${icon("search")}${icon("settings")}</button></div><div id="operation-filters" class="operation-filters" ${f.expanded ? "" : "hidden"}><label>Поиск<input id="search" value="${esc(f.query)}" placeholder="Название, категория, комментарий" data-action="updateOperationFilters" data-action-event="input"></label><label>Тип<select id="filter" data-action="updateOperationFilters" data-action-event="change">${[
      ["", "Все типы"],
      ["expense", "Расходы"],
      ["income", "Доходы"],
      ["refund", "Возвраты"],
      ["transfer", "Переводы"],
    ]
      .map(([v, l]) => `<option value="${v}" ${v === f.type ? "selected" : ""}>${l}</option>`)
      .join(
        "",
      )}</select></label><label>Счёт<select id="afilter" data-action="updateOperationFilters" data-action-event="change"><option value="">Все счета</option>${accounts.map((a) => `<option value="${esc(a.id)}" ${a.id === f.account ? "selected" : ""}>${esc(a.name)}</option>`).join("")}</select></label><button type="button" data-action="resetOperationFilters" data-action-event="click">Сбросить</button></div><p id="operation-filter-status" class="muted"></p><div id="list"></div>`;
  // Values are assigned as well as rendered for predictable DOM and test behavior.
  $("#search").value = f.query;
  $("#filter").value = f.type;
  $("#afilter").value = f.account;
  updateOperationFilters();
}
export function updateOperationFilters() {
  const f = state.operationFilters;
  f.query = $("#search").value;
  f.type = $("#filter").value;
  f.account = $("#afilter").value;
  const active = Boolean(f.query.trim() || f.type || f.account),
    ops = filterOperations(
      state.db.ops.filter((o) => o.date.startsWith($("#month").value)),
      f,
    );
  $("#list").innerHTML = operationsRows(ops, FinanceData.live(state.db.accounts), active);
  $("#operations-count").textContent = `Операций: ${ops.length}`;
  $("#operation-filter-status").textContent = active
    ? "Показаны операции по выбранным фильтрам. Дневные итоги рассчитаны по ним."
    : "";
  $("#operation-filter-status").hidden = !active;
  $("#operations-filter-toggle").classList.toggle("has-filters", active);
}
export function toggleOperationFilters() {
  const f = state.operationFilters;
  f.expanded = !f.expanded;
  $("#operation-filters").hidden = !f.expanded;
  $("#operations-filter-toggle").setAttribute("aria-expanded", String(f.expanded));
  if (f.expanded) $("#search").focus?.();
}
export function resetOperationFilters() {
  $("#search").value = "";
  $("#filter").value = "";
  $("#afilter").value = "";
  updateOperationFilters();
}
