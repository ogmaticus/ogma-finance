import { state } from "./state.js?v=33";
import { FinanceBudget } from "./budget-core.js?v=33";
import { $ } from "./format.js?v=33";
import { render } from "./app.js?v=33";
import { renderCategoryHistory } from "./category-history.js?v=33";
import { animateDialogClose } from "./ui.js?v=33";
export const financeMonthNames = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
];
export function financeMonthShift(month, step) {
  if (!FinanceBudget.validMonth(month) || !Number.isInteger(step)) return null;
  const [year, number] = month.split("-").map(Number),
    index = year * 12 + number - 1 + step;
  if (index < 12 || index > 9999 * 12 + 11) return null;
  return (
    String(Math.floor(index / 12)).padStart(4, "0") +
    "-" +
    String((index % 12) + 1).padStart(2, "0")
  );
}
export function financeMonthTitle(month) {
  const [year, number] = month.split("-").map(Number);
  return financeMonthNames[number - 1] + " " + String(year).padStart(4, "0");
}
export function initializeMonthSelection() {
  const today = new Date();
  let month = today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, "0");
  try {
    const stored = localStorage.getItem("finance-view-month");
    if (FinanceBudget.validMonth(stored) && Number(stored.slice(0, 4)) >= 1) month = stored;
  } catch {}
  $("#month").value = month;
  updateMonthControl();
}
export function updateMonthControl() {
  const month = $("#month").value;
  $("#monthlabel").textContent = financeMonthTitle(month);
  $("#monthprevious").disabled = !financeMonthShift(month, -1);
  $("#monthnext").disabled = !financeMonthShift(month, 1);
}
export function setFinanceMonth(month) {
  if (!FinanceBudget.validMonth(month) || Number(month.slice(0, 4)) < 1) return false;
  $("#month").value = month;
  try {
    localStorage.setItem("finance-view-month", month);
  } catch {}
  render();
  return true;
}
export function shiftFinanceMonth(step) {
  const month = financeMonthShift($("#month").value, step);
  if (month) setFinanceMonth(month);
}
export function openMonthPicker(target = "main") {
  state.monthPickerTarget = target === "history" ? "history" : "main";
  const month =
    state.monthPickerTarget === "history"
      ? state.historyMonth || $("#month").value
      : $("#month").value;
  $("#pickermonth").innerHTML = financeMonthNames
    .map((name, index) => `<option value="${String(index + 1).padStart(2, "0")}">${name}</option>`)
    .join("");
  $("#pickermonth").value = month.slice(5);
  $("#pickeryear").value = month.slice(0, 4);
  $("#monthpickererror").textContent = "";
  $("#monthpickerdialog").showModal();
}
export function applyMonthPicker(event) {
  event.preventDefault();
  const year = Number($("#pickeryear").value),
    number = $("#pickermonth").value;
  if (!Number.isInteger(year) || year < 1 || year > 9999 || !/^(0[1-9]|1[0-2])$/.test(number)) {
    $("#monthpickererror").textContent = "Выберите месяц и введите год от 1 до 9999.";
    return;
  }
  const month = String(year).padStart(4, "0") + "-" + number;
  if (state.monthPickerTarget === "history") {
    state.historyMonth = month;
    renderCategoryHistory();
  } else setFinanceMonth(month);
  animateDialogClose($("#monthpickerdialog"));
}
export function shiftHistoryMonth(step) {
  const month = financeMonthShift(state.historyMonth || $("#month").value, step);
  if (month) {
    state.historyMonth = month;
    renderCategoryHistory();
  }
}
