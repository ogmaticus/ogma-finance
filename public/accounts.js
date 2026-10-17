import { Money } from "./money.js?v=33";
import { state } from "./state.js?v=33";
import { liveRecords } from "./sync-core.js?v=33";
import { $, esc } from "./format.js?v=33";
import { accountLast4, prepareImportDraft } from "./import-ui.js?v=33";
import { save, render } from "./app.js?v=33";
import { animateDialogClose } from "./ui.js?v=33";
export function account(id) {
  state.accountEditing = id || null;
  const a = liveRecords("accounts").find((x) => x.id === id),
    f = $("#accountform");
  f.innerHTML = `<h2>${a ? "Изменить счёт" : "Новая карта / счёт"}</h2><label>Название<input name="name" required maxlength="80" value="${esc(a?.name || "")}" placeholder="Например, карта для покупок"></label><label>Тип<select name="type"><option value="card" ${a?.type === "card" ? "selected" : ""}>Карта</option><option value="account" ${a?.type === "account" ? "selected" : ""}>Банковский счёт</option><option value="cash" ${a?.type === "cash" ? "selected" : ""}>Наличные</option></select></label><label>Номер или последние 4 цифры<input name="number" inputmode="numeric" maxlength="42" autocomplete="off" value="${accountLast4(a || {})}" placeholder="2264"><small>Для распознавания сохраняются только последние 4 цифры.</small></label><label>Начальный остаток, ₽<input name="opening" type="number" step="0.01" required value="${Money.input(a?.openingMinor || 0)}"></label><p id="accounterror" role="status"></p><div class="actions"><button class="primary">Сохранить</button><button type="button" data-action="closeAccountEditor" data-action-event="click">Отмена</button></div>`;
  $("#accounteditor").showModal();
}
export function saveAccountForm(event) {
  event.preventDefault();
  const f = event.target,
    name = f.elements.name.value.trim(),
    digits = f.elements.number.value.replace(/\D/g, ""),
    type = f.elements.type.value,
    openingMinor = Money.toMinor(f.elements.opening.value);
  if (!name || !Number.isSafeInteger(openingMinor) || (digits && digits.length < 4)) {
    $("#accounterror").textContent = "Укажите название, остаток и минимум 4 цифры номера.";
    return;
  }
  const last4 = type === "cash" ? "" : digits.slice(-4);
  let existing = liveRecords("accounts").find((a) => a.id === state.accountEditing);
  if (!existing && last4) {
    const generated = liveRecords("accounts").filter(
      (a) => accountLast4(a) === last4 && (a.autoCreated ?? a.id.startsWith("screenshot-account-")),
    );
    if (generated.length === 1) existing = generated[0];
  }
  const a = {
    ...(existing || {}),
    id: existing?.id || crypto.randomUUID(),
    name,
    type,
    last4,
    openingMinor,
    autoCreated: false,
  };
  delete a.number;
  if (existing) state.db.accounts = state.db.accounts.map((x) => (x.id === existing.id ? a : x));
  else state.db.accounts.push(a);
  if (state.db.accountAliases) {
    for (const [hint, id] of Object.entries(state.db.accountAliases))
      if (id === a.id && hint !== last4) delete state.db.accountAliases[hint];
    if (last4) state.db.accountAliases[last4] = a.id;
  }
  save();
  animateDialogClose($("#accounteditor"));
  if (state.page === "Импорт") state.draft = prepareImportDraft(state.draft);
  render();
}
export function closeAccountEditor(event, element) {
  return animateDialogClose(document.getElementById("accounteditor"));
}
