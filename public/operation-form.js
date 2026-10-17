import { state } from "./state.js?v=33";
import { $, esc } from "./format.js?v=33";
import { localDate, operationDateOrder } from "./dates.js?v=33";
import { FinanceData } from "./data-model.js?v=33";
import { icon, categoryVisual } from "./icons.js?v=33";
export function recentOperationAccount(ops, accounts) {
  return (
    FinanceData.live(ops)
      .slice()
      .sort(
        (a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || "") || operationDateOrder(a, b),
      )
      .find((o) => accounts.some((a) => a.id === o.account))?.account ||
    accounts[0]?.id ||
    ""
  );
}
export function recentOperationCategories(ops, categories) {
  const recent = FinanceData.live(ops)
    .slice()
    .sort(
      (a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || "") || operationDateOrder(a, b),
    )
    .filter((o) => o.type !== "transfer")
    .map((o) => o.category);
  return [...new Set([...recent, ...categories])].filter((c) => c !== "Перевод");
}
export function operationDateChoice(which, now = new Date()) {
  if (which === "yesterday") {
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    return localDate(d);
  }
  return localDate(now);
}
export function updateOperationForm() {
  const f = $("#form"),
    type = f.elements.type.value;
  $("#tolabel").hidden = type !== "transfer";
  $("#operation-category-section").hidden = type === "transfer";
  if (type === "transfer") $("#operation-extra").open = true;
  for (const button of document.querySelectorAll("[data-operation-type]"))
    button.setAttribute("aria-pressed", String(button.dataset.operationType === type));
  const categories = recentOperationCategories(state.db.ops, state.cats);
  $("#operation-category-grid").innerHTML = categories
    .map((c) => {
      const v = categoryVisual(c, type);
      return `<button type="button" data-operation-category="${esc(c)}" data-action="chooseOperationCategory" data-action-event="click" aria-pressed="${f.elements.category.value === c}"><span class="category-symbol ${v.tone}">${icon(v.icon)}</span><span>${esc(c)}</span></button>`;
    })
    .join("");
  $("#operation-account-summary").textContent =
    FinanceData.live(state.db.accounts).find((a) => a.id === f.elements.account.value)?.name ||
    "Счёт не выбран";
  for (const button of document.querySelectorAll("[data-operation-date]"))
    button.setAttribute(
      "aria-pressed",
      String(f.elements.date.value === operationDateChoice(button.dataset.operationDate)),
    );
}
export function initializeOperationForm(operation) {
  const f = $("#form"),
    accounts = FinanceData.live(state.db.accounts);
  if (!operation) {
    f.elements.account.value = recentOperationAccount(state.db.ops, accounts);
    f.elements.to.value = accounts.find((a) => a.id !== f.elements.account.value)?.id || "";
    f.elements.category.value = recentOperationCategories(state.db.ops, state.cats)[0] || "Другое";
  }
  f.elements.note.value = operation?.note || "";
  $("#operation-form-error").textContent = accounts.length
    ? ""
    : "Добавьте карту или счёт в разделе «Ещё → Счета».";
  $("#operation-extra").open = operation?.type === "transfer";
  $("#operation-date-field").hidden =
    f.elements.date.value === operationDateChoice("today") ||
    f.elements.date.value === operationDateChoice("yesterday");
  updateOperationForm();
}
export function chooseOperationType(event, element) {
  const type = element.dataset.operationType;
  if (!["expense", "income", "refund", "transfer"].includes(type)) return;
  const f = $("#form");
  f.elements.type.value = type;
  if (type === "income" && state.cats.includes("Зарплата")) f.elements.category.value = "Зарплата";
  updateOperationForm();
}
export function chooseOperationCategory(event, element) {
  const category = element.dataset.operationCategory;
  if (!recentOperationCategories(state.db.ops, state.cats).includes(category)) return;
  $("#form").elements.category.value = category;
  updateOperationForm();
}
export function chooseOperationDate(event, element) {
  const which = element.dataset.operationDate;
  if (!["today", "yesterday"].includes(which)) return;
  $("#form").elements.date.value = operationDateChoice(which);
  updateOperationForm();
}
export function showOperationDate() {
  $("#operation-date-field").hidden = false;
  $("#form").elements.date.focus?.();
}
