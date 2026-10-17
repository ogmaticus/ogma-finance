import { state } from "./state.js?v=33";
import { $, esc } from "./format.js?v=33";
export function animateDialogClose(dialog, value = "") {
  if (dialog?.id === "logoutdialog" && true && state.cloudLogoutBusy) return Promise.resolve();
  if (!dialog || !dialog.open) return Promise.resolve();
  if (dialog.classList.contains("closing")) return Promise.resolve();
  dialog.classList.add("closing");
  return new Promise((resolve) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      dialog.classList.remove("closing");
      dialog.removeEventListener("animationend", finish);
      dialog.close(value);
      resolve();
    };
    dialog.addEventListener("animationend", finish, { once: true });
    setTimeout(finish, 190);
  });
}
export function askForm({
  title,
  message = "",
  fields = [],
  confirmLabel = "Сохранить",
  cancelLabel = "Отмена",
}) {
  return new Promise((resolve) => {
    const dialog = $("#questiondialog"),
      form = $("#questionform");
    let result = null;
    form.innerHTML = `<h2>${esc(title)}</h2>${message ? `<p>${esc(message)}</p>` : ""}${fields.map((f) => `<label>${esc(f.label)}<input name="${esc(f.name)}" type="${esc(f.type || "text")}" value="${esc(f.value ?? "")}" ${f.required ? "required" : ""} ${f.min !== undefined ? `min="${f.min}"` : ""} ${f.step ? `step="${f.step}"` : ""} maxlength="120"></label>`).join("")}<div class="actions"><button class="primary">${esc(confirmLabel)}</button><button type="button" id="questioncancel">${esc(cancelLabel)}</button></div>`;
    form.onsubmit = (e) => {
      e.preventDefault();
      result = Object.fromEntries(fields.map((f) => [f.name, form.elements[f.name].value]));
      animateDialogClose(dialog);
    };
    $("#questioncancel").onclick = () => animateDialogClose(dialog);
    dialog.onclose = () => {
      dialog.onclose = null;
      resolve(result);
    };
    dialog.showModal();
  });
}
export async function askConfirm(message, confirmLabel = "Продолжить") {
  return Boolean(await askForm({ title: "Подтверждение", message, confirmLabel }));
}
export async function showNotice(message) {
  await askForm({
    title: "Проверьте данные",
    message,
    confirmLabel: "Понятно",
    cancelLabel: "Закрыть",
  });
}
for (const dialog of document.querySelectorAll("dialog"))
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    animateDialogClose(dialog);
  });
