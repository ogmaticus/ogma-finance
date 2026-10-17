import { Money } from "./money.js?v=34";
import { state } from "./state.js?v=34";
import { FinanceData } from "./data-model.js?v=34";
import { liveRecords } from "./sync-core.js?v=34";
import { budgetOwner } from "./budget-ui.js?v=34";
import { $, money, esc } from "./format.js?v=34";
import { showNotice, askConfirm, animateDialogClose, askForm } from "./ui.js?v=34";
import { save, render } from "./app.js?v=34";
import { FinanceOCR } from "./ocr-parser.js?v=34";
export function accountDeletionData(input, id, mode, target, now = new Date().toISOString()) {
  let data = FinanceData.normalize(input, now);
  if (!FinanceData.live(data.accounts).some((record) => record.id === id))
    throw Error("Счёт не найден");
  if (
    mode === "move" &&
    (!target ||
      target === id ||
      !FinanceData.live(data.accounts).some((record) => record.id === target))
  )
    throw Error("Выберите другой счёт");
  for (const operation of FinanceData.live(data.ops))
    if (operation.account === id || (operation.type === "transfer" && operation.to === id)) {
      operation.updatedAt = new Date(
        Math.max(Date.parse(now), FinanceData.clock(operation) + 1),
      ).toISOString();
      if (mode === "delete") operation.deletedAt = operation.updatedAt;
      else {
        if (operation.account === id) operation.account = target;
        if (operation.to === id) operation.to = target;
        if (operation.type === "transfer" && operation.account === operation.to)
          operation.deletedAt = operation.updatedAt;
      }
    }
  for (const [hint, account] of Object.entries(data.accountAliases))
    if (account === id) delete data.accountAliases[hint];
  data = FinanceData.remove(data, "accounts", id, now);
  return FinanceData.stamp(data, input, now);
}
export function openAccountDelete(id) {
  const account = liveRecords("accounts").find((record) => record.id === id);
  if (!account) return;
  state.deleteAccountContext = { id, owner: budgetOwner() };
  const others = liveRecords("accounts").filter((record) => record.id !== id),
    rows = liveRecords("ops").filter(
      (record) => record.account === id || (record.type === "transfer" && record.to === id),
    );
  $("#deleteaccounttitle").textContent = "Удалить " + account.name + "?";
  $("#deleteaccountmessage").textContent = rows.length
    ? `Со счётом связано ${rows.length} операций. Начальный остаток ${money(account.openingMinor)} не переносится.`
    : "Операций на этом счёте нет.";
  $("#deleteaccountmode").innerHTML =
    (others.length ? '<option value="move">Перенести операции на другой счёт</option>' : "") +
    '<option value="delete">Удалить счёт вместе с операциями</option>';
  $("#deleteaccounttarget").innerHTML = others
    .map((record) => `<option value="${record.id}">${esc(record.name)}</option>`)
    .join("");
  updateAccountDeleteMode();
  $("#deleteaccountdialog").showModal();
}
export function updateAccountDeleteMode() {
  $("#deleteaccounttargetlabel").hidden = $("#deleteaccountmode").value !== "move";
}
export async function confirmAccountDelete(event) {
  event.preventDefault();
  const context = state.deleteAccountContext;
  if (!context || context.owner !== budgetOwner())
    return showNotice("Аккаунт изменился. Откройте счёт заново.");
  const mode = $("#deleteaccountmode").value,
    target = $("#deleteaccounttarget").value;
  if (
    !(await askConfirm(
      mode === "move"
        ? "Перенести операции и удалить счёт? Переводы между удаляемым и выбранным счетами будут удалены как внутренние."
        : "Удалить счёт и все связанные операции?",
      "Удалить",
    ))
  )
    return;
  if (context.owner !== budgetOwner()) return;
  try {
    state.db = accountDeletionData(state.db, context.id, mode, target);
    save({ snapshot: true });
    await animateDialogClose($("#deleteaccountdialog"));
    render();
  } catch (error) {
    await showNotice(error.message);
  }
}
export async function editGoal(id) {
  const goal = liveRecords("goals").find((record) => record.id === id),
    owner = budgetOwner();
  if (!goal) return;
  const values = await askForm({
    title: "Изменить цель",
    fields: [
      { name: "name", label: "Название", value: goal.name, required: true },
      {
        name: "target",
        label: "Целевая сумма, ₽",
        type: "number",
        min: 0.01,
        step: "0.01",
        value: Money.input(goal.targetMinor),
        required: true,
      },
      {
        name: "saved",
        label: "Накоплено, ₽",
        type: "number",
        min: 0,
        step: "0.01",
        value: Money.input(goal.savedMinor),
        required: true,
      },
      { name: "date", label: "Срок", type: "date", value: goal.date || "", required: true },
    ],
  });
  if (!values || owner !== budgetOwner()) return;
  if (
    !values.name.trim() ||
    !Number.isFinite(+values.target) ||
    +values.target <= 0 ||
    !Number.isFinite(+values.saved) ||
    +values.saved < 0 ||
    !FinanceOCR.dateIn(values.date)
  )
    return showNotice("Проверьте название, суммы и срок цели.");
  Object.assign(goal, {
    name: values.name.trim(),
    targetMinor: Money.toMinor(values.target),
    savedMinor: Money.toMinor(values.saved),
    date: values.date,
  });
  save();
  render();
}
export async function deleteGoal(id) {
  const goal = liveRecords("goals").find((record) => record.id === id),
    owner = budgetOwner();
  if (
    !goal ||
    !(await askConfirm(`Удалить цель «${goal.name}»? Остатки на счетах не изменятся.`, "Удалить"))
  )
    return;
  if (owner !== budgetOwner()) return;
  state.db = FinanceData.remove(state.db, "goals", id);
  save({ snapshot: true });
  render();
}
