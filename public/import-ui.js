import { icon, categoryVisual } from "./icons.js?v=31";
import { Money } from "./money.js?v=31";
import { state } from "./state.js?v=31";
import { liveRecords } from "./sync-core.js?v=31";
import { $, esc } from "./format.js?v=31";
import { FinanceOCR } from "./ocr-parser.js?v=31";
import {
  merchantKey,
  recognizeScreenshots,
  rememberCategory,
  save,
  render,
  cancelOCR,
  demo,
} from "./app.js?v=31";
import { animateDialogClose, askConfirm } from "./ui.js?v=31";
import { archiveImportedScreenshots } from "./file-vault.js?v=31";
export function importAccounts() {
  return [...liveRecords("accounts"), ...state.importPendingAccounts];
}
export function accountLast4(a) {
  return String(a.last4 || a.number || "")
    .replace(/\D/g, "")
    .slice(-4);
}
export function accountForHint(hint, label) {
  if (!/^\d{4}$/.test(hint || "")) return "";
  const matches = importAccounts().filter((a) => accountLast4(a) === hint);
  const alias = state.importPendingAliases[hint] || state.db.accountAliases?.[hint];
  if (matches.length === 1) return matches[0].id;
  if (matches.length > 1) {
    const explicit = matches.filter(
      (a) => !(a.autoCreated ?? a.id.startsWith("screenshot-account-")),
    );
    if (explicit.length === 1) return explicit[0].id;
    if (matches.some((a) => a.id === alias)) return alias;
    if (matches.some((a) => a.id === state.bulkSettings.account)) return state.bulkSettings.account;
    return "";
  }
  if (alias && importAccounts().some((a) => a.id === alias)) return alias;
  const id = "screenshot-account-" + hint;
  if (!importAccounts().some((a) => a.id === id))
    state.importPendingAccounts.push({
      id,
      name: label || "Счёт •" + hint,
      last4: hint,
      autoCreated: true,
      type: /карта/i.test(label || "") ? "card" : "account",
      opening: 0,
    });
  state.importPendingAliases[hint] = id;
  return id;
}
export function categoryKey(value) {
  return value.normalize("NFKC").toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
}
export function cleanCategory(value) {
  const text = String(value || "")
    .replace(/[<>\r\n]/g, "")
    .trim()
    .slice(0, 60);
  return ["__proto__", "constructor", "prototype"].includes(text.toLowerCase()) ? "" : text;
}
export function importCategories() {
  return [...new Set([...state.cats, ...state.draft.map((o) => o.category).filter(Boolean)])];
}
export function applyImportCategories(rows) {
  for (const o of rows) {
    if (o.type === "transfer" || o.categoryManual) continue;
    if (!o.fallbackCategory) o.fallbackCategory = o.category;
    if (o.categorySource === "rule" || o.categorySource === "prior") continue;
    const candidate =
      state.useBankCategories && o.bankCategory
        ? cleanCategory(o.bankCategory)
        : o.fallbackCategory;
    o.category = state.cats.find((c) => categoryKey(c) === categoryKey(candidate)) || candidate;
  }
  return rows;
}
export function toggleBankCategories(value) {
  state.useBankCategories = value;
  applyImportCategories(state.draft);
  renderImport();
}
export function registerCategory(value) {
  const category = cleanCategory(value);
  if (!category) return "Другое";
  const existing = state.cats.find((c) => categoryKey(c) === categoryKey(category));
  if (existing) return existing;
  state.cats.push(category);
  state.db.categories.push(category);
  return category;
}
export function commitImportCategories(rows) {
  for (const o of rows) if (o.type !== "transfer") o.category = registerCategory(o.category);
}
export function prepareImportDraft(rows) {
  applyImportCategories(rows);
  state.importPendingAccounts = [];
  state.importPendingAliases = {};
  if (!state.bulkSettings.year) state.bulkSettings.year = $("#month").value.slice(0, 4);
  const creditTarget = rows.find(
    (o) =>
      o.type === "transfer" &&
      o.toHint &&
      o.accountRefs?.some((r) => r.hint === o.toHint && /кредитн/i.test(r.label)),
  );
  for (const o of rows) {
    if (o.partialDate && !o.date)
      o.date = FinanceOCR.resolvePartial(o.partialDate, state.bulkSettings.year);
    if (o.type === "review") o.type = "income";
    o.needsType = false;
    if (o.type === "transfer") {
      o.from =
        accountForHint(o.fromHint, o.accountRefs?.find((r) => r.hint === o.fromHint)?.label) ||
        o.from ||
        "";
      o.to =
        accountForHint(o.toHint, o.accountRefs?.find((r) => r.hint === o.toHint)?.label) ||
        o.to ||
        "";
    } else {
      let hint = o.accountHint;
      if (!hint && creditTarget && /кредитн|сберк/i.test(o.raw || "")) hint = creditTarget.toHint;
      o.account = hint
        ? accountForHint(hint, o.accountRefs?.find((r) => r.hint === hint)?.label)
        : state.bulkSettings.account || o.account || "";
      if (hint) state.importPendingAliases[hint] = o.account;
    }
  }
  const common = rows
    .filter((o) => o.type !== "transfer")
    .map((o) => o.account)
    .filter(Boolean);
  if (common.length && new Set(common).size === 1) state.bulkSettings.account = common[0];
  return rows;
}
export function commitImportAccounts(rows) {
  const used = new Set(rows.flatMap((o) => (o.type === "transfer" ? [o.from, o.to] : [o.account])));
  for (const a of state.importPendingAccounts)
    if (used.has(a.id) && !liveRecords("accounts").some((x) => x.id === a.id))
      state.db.accounts.push(a);
  if (!state.db.accountAliases) state.db.accountAliases = {};
  for (const [hint, id] of Object.entries(state.importPendingAliases))
    if (used.has(id)) state.db.accountAliases[hint] = id;
  state.importPendingAccounts = [];
  state.importPendingAliases = {};
}
export const importTypes = {
  expense: "Расход",
  income: "Доход",
  refund: "Возврат",
  transfer: "Между своими",
  review: "Поступление",
};
export function importRubAmount(o) {
  return (o.currency || "RUB") === "RUB" ? o.amount : Number(o.rubAmount) || 0;
}
export function importIssues(o) {
  const issues = [];
  if (!o.date) issues.push(o.partialDate ? "Год" : "Дата");
  if (o.type === "review" || o.needsType) issues.push("Тип");
  if (o.type === "transfer") {
    if (!o.from || !o.to || o.from === o.to) issues.push("Счета");
  } else if (!o.account) issues.push("Счёт");
  if ((o.currency || "RUB") === "OTHER") issues.push("Валюта");
  if ((o.currency || "RUB") !== "RUB" && !Number(o.rubAmount)) issues.push("Сумма в ₽");
  if (!Number.isFinite(o.amount) || o.amount <= 0 || !o.name.trim()) issues.push("Данные");
  return issues;
}
export function importAmountLabel(o) {
  const amount = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(o.amount),
    currency = o.currency || "RUB";
  return (
    amount +
    " " +
    ({ RUB: "₽", TRY: "₺", USD: "$", EUR: "€", GBP: "£", OTHER: "· валюта?" }[currency] || currency)
  );
}
export function importDateLabel(o) {
  if (o.date) {
    const [y, m, d] = o.date.split("-");
    return `${d}.${m}.${y}`;
  }
  if (o.partialDate)
    return `${o.partialDate.day}.${String(o.partialDate.month).padStart(2, "0")} · год?`;
  return "Без даты";
}
export function importSame(a, b) {
  return (
    merchantKey(a.name) === merchantKey(b.name) &&
    (a.amountMinor ?? Money.toMinor(a.amount)) === (b.amountMinor ?? Money.toMinor(b.amount)) &&
    a.date === b.date &&
    a.account === b.account &&
    a.type === b.type &&
    a.to === b.to &&
    (!a.time || !b.time || a.time === b.time)
  );
}
export function importSteps(step) {
  return `<ol class="import-steps" aria-label="Шаги импорта">${["Загрузить", "Проверить", "Готово"].map((label, i) => `<li ${step === i + 1 ? 'aria-current="step"' : ""} class="${step > i + 1 ? "complete" : ""}"><span>${i + 1}</span>${label}</li>`).join("")}</ol>`;
}
export function importBlockReason(rows) {
  const selected = rows.filter((o) => o.selected),
    missing = selected.filter((o) => !o.date);
  if (!selected.length) return "Выберите хотя бы одну операцию.";
  if (missing.length) return `Укажите дату для ${missing.length} операций.`;
  if (selected.some((o) => importIssues(o).includes("Счёт") || importIssues(o).includes("Счета")))
    return "Выберите счета для отмеченных операций.";
  if (selected.some((o) => importIssues(o).length)) return "Исправьте подсвеченные поля в списке.";
  return "";
}
export function renderImport() {
  $("#app-header").dataset.importStep = state.importCompleted
    ? "done"
    : state.draft.length
      ? "review"
      : "upload";
  const c = $("#content");
  if (state.importCompleted) {
    c.innerHTML =
      importSteps(3) +
      `<section class="card import-complete"><span class="category-symbol mint">${icon("cloud-check")}</span><h2>Операции добавлены</h2><p>${state.importCompleted.count} записей сохранено в бюджете.</p><button type="button" class="primary" data-action="showOperations" data-action-event="click">Открыть операции</button><button type="button" data-action="restartImport" data-action-event="click">Загрузить ещё</button></section>`;
    return;
  }
  const selectedRows = state.draft.filter((o) => o.selected),
    pending = selectedRows.filter((o) => importIssues(o).length),
    missing = selectedRows.filter((o) => !o.date),
    reason = importBlockReason(state.draft),
    step = state.draft.length ? 2 : 1;
  c.innerHTML =
    importSteps(step) +
    `<section class="import-upload card"><div><h2>${state.ocrBusy ? "Распознаём скриншоты" : step === 1 ? "Загрузите историю банка" : "Скриншоты"}</h2><span class="muted">${state.ocrFiles.length ? state.ocrFiles.length + " изображение(й)" : "PNG, JPG или WebP · до 10 МБ"}</span></div><button type="button" class="${step === 1 ? "primary" : ""}" data-action="pickScreenshotFiles" data-action-event="click" ${state.ocrBusy ? "disabled" : ""}>${step === 1 ? "Выбрать скриншот" : "Выбрать ещё"}</button><input id="files" type="file" accept="image/png,image/jpeg,image/webp" multiple hidden><div class="import-thumbs" id="previews"></div><div id="ocrstatus" role="status" aria-live="polite">${esc(state.ocrBusy ? state.ocrMessage : !state.draft.length ? state.ocrMessage : "")}</div>${state.ocrBusy ? `<progress id="ocrprogress" max="100" value="${state.ocrProgress}" aria-label="Прогресс распознавания"></progress><button type="button" data-action="cancelScreenshotRecognition" data-action-event="click">Отменить распознавание</button>` : !state.draft.length && state.ocrFiles.length ? '<button type="button" data-action="retryScreenshotRecognition" data-action-event="click">Повторить распознавание</button>' : ""}</section>` +
    (step === 2
      ? `<section class="card import-review"><div class="import-list-heading"><h2>Найдено ${state.draft.length} операций · ${pending.length} требуют внимания</h2>${pending.length ? `<button type="button" class="import-filter ${state.importOnlyIssues ? "active" : ""}" data-action="toggleImportIssues" data-action-event="click" aria-pressed="${state.importOnlyIssues}">${state.importOnlyIssues ? "Показать все" : "Только с вопросами"}</button>` : ""}</div><div class="import-toolbar"><label>Счёт для всех<select id="bulkaccount" data-action="changeImportAccount" data-action-event="change"><option value="">Автоматически по скриншоту</option>${importAccounts()
          .map(
            (a) =>
              `<option value="${esc(a.id)}" ${a.id === state.bulkSettings.account ? "selected" : ""}>${esc(a.name)}</option>`,
          )
          .join(
            "",
          )}</select></label>${state.draft.some((o) => o.partialDate) ? `<label>Год<input id="importyear" type="number" min="1900" max="2100" value="${esc(state.bulkSettings.year)}" data-action="changeImportYear" data-action-event="change"></label>` : ""}</div><details class="import-settings"><summary>Применить ко всем</summary><div class="import-toolbar"><label>Одна дата для всех<input id="bulkdate" type="date" value="${esc(state.bulkSettings.date)}" data-action="changeAllImportDates" data-action-event="change"></label>${
          state.draft.some((o) => o.type === "transfer")
            ? `<label>Счёт в переводах<select data-action="changeTransferAccountSide" data-action-event="change">${importOptions(
                [
                  ["skip", "Сохранить найденные"],
                  ["from", "Счёт отправителя"],
                  ["to", "Счёт получателя"],
                ],
                state.bulkSettings.side,
              )}</select></label>`
            : ""
        }<button type="button" data-action="selectAllImportRows" data-action-event="click">Выбрать все</button><button type="button" data-action="deselectAllImportRows" data-action-event="click">Снять выделение</button><button type="button" data-action="createImportRow" data-action-event="click">Пропущенная операция</button></div></details>${state.draft.some((o) => o.bankCategory) ? `<label class="bank-category-choice"><input type="checkbox" ${state.useBankCategories ? "checked" : ""} data-action="changeBankCategoryPreference" data-action-event="change"><span>Использовать категории банка <small>Новые создадутся при добавлении</small></span></label>` : ""}<div id="importlist">${importListRows()}</div></section><div class="import-save"><div class="import-save-help" role="status">${state.importSaving ? "Сохраняем операции…" : state.ocrBusy ? "Дождитесь завершения распознавания." : esc(reason)}${missing.length ? '<button type="button" class="category-link" data-action="showImportBulkDate" data-action-event="click">Указать одну дату для всех</button><label id="import-bulk-date-choice" hidden>Дата для записей без даты<input id="missingdate" type="date" data-action="changeMissingImportDate" data-action-event="change"></label>' : ""}</div><button type="button" class="primary" data-action="saveScreenshotOperations" data-action-event="click" ${reason || state.ocrBusy || state.importSaving ? "disabled" : ""}>Добавить ${selectedRows.length} операций</button></div>`
      : "") +
    `<p id="importmessage" role="status">${esc(state.importToast)}</p><details class="import-debug"><summary>Дополнительно</summary><p class="muted">Распознавание на устройстве. До 10 изображений по 10 МБ.</p><button type="button" data-action="loadImportExample" data-action-event="click" ${state.ocrBusy ? "disabled" : ""}>Пример</button>${state.ocrRaw ? `<details><summary>Распознанный текст</summary><pre>${esc(state.ocrRaw)}</pre></details>` : ""}</details>`;
  for (const f of state.ocrFiles) {
    const img = document.createElement("img");
    img.alt = f.name;
    img.src = URL.createObjectURL(f);
    img.onload = () => URL.revokeObjectURL(img.src);
    $("#previews").append(img);
  }
  $("#files").onchange = (e) => {
    const files = [...e.target.files];
    if (
      files.length > 10 ||
      files.some(
        (f) =>
          f.size > 10 * 1024 * 1024 || !["image/png", "image/jpeg", "image/webp"].includes(f.type),
      )
    ) {
      state.importToast = "До 10 изображений PNG, JPG или WebP, не больше 10 МБ каждое.";
      renderImport();
      return;
    }
    if (!files.length) return;
    state.ocrFiles = files;
    state.importToast = "";
    state.ocrMessage = "Распознавание…";
    recognizeScreenshots();
  };
}
export function restartImport() {
  state.importCompleted = null;
  renderImport();
}
export function showImportBulkDate() {
  $("#import-bulk-date-choice").hidden = false;
  $("#missingdate").focus?.();
}
export function importInlineFields(o, index) {
  const attrs = (field) =>
      `data-import-index="${index}" data-import-field="${field}" data-action="setImportInlineField" data-action-event="change"`,
    accountSelect = (field) =>
      `<select ${attrs(field)}>${importOptions([["", "Выберите счёт"], ...importAccounts().map((a) => [a.id, a.name])], o[field] || "")}</select>`;
  let html = "";
  if (!o.date) html += `<label>Нет даты — выбрать<input type="date" ${attrs("date")}></label>`;
  if (o.type === "review" || o.needsType)
    html += `<label>Выберите тип<select ${attrs("type")}>${importOptions(
      [
        ["review", "Выберите"],
        ["expense", "Расход"],
        ["income", "Доход"],
        ["refund", "Возврат"],
        ["transfer", "Между своими"],
      ],
      o.type,
    )}</select></label>`;
  if (o.type === "transfer" && (!o.from || !o.to || o.from === o.to))
    html += `<label>Со счёта${accountSelect("from")}</label><label>На счёт${accountSelect("to")}</label>`;
  else if (o.type !== "transfer" && !o.account)
    html += `<label>Выберите счёт${accountSelect("account")}</label>`;
  if ((o.currency || "RUB") === "OTHER")
    html += `<label>Валюта<select ${attrs("currency")}>${importOptions(
      [
        ["OTHER", "Выберите"],
        ["RUB", "₽"],
        ["TRY", "₺"],
        ["USD", "$"],
        ["EUR", "€"],
        ["GBP", "£"],
      ],
      o.currency,
    )}</select></label>`;
  if ((o.currency || "RUB") !== "RUB" && !Number(o.rubAmount))
    html += `<label>Сумма в ₽<input type="text" inputmode="decimal" ${attrs("rubAmount")}></label>`;
  if (!o.name.trim()) html += `<label>Название<input maxlength="120" ${attrs("name")}></label>`;
  if (!Number.isFinite(o.amount) || o.amount <= 0)
    html += `<label>Сумма<input type="text" inputmode="decimal" ${attrs("amount")}></label>`;
  return html ? `<div class="import-inline-fields">${html}</div>` : "";
}
export function setImportInlineField(event, element) {
  const o = state.draft[Number(element.dataset.importIndex)],
    field = element.dataset.importField,
    value = element.value;
  if (
    !o ||
    !["date", "type", "from", "to", "account", "currency", "rubAmount", "amount", "name"].includes(
      field,
    )
  )
    return;
  if (["amount", "rubAmount"].includes(field)) {
    try {
      o[field] = Money.toMinor(value) / 100;
    } catch {
      state.importToast = "Введите сумму числом.";
      renderImport();
      return;
    }
  } else if (field === "date") {
    if (
      !/^\d{4}-\d\d-\d\d$/.test(value) ||
      !Number.isFinite(Date.parse(value + "T12:00:00Z")) ||
      new Date(value + "T12:00:00Z").toISOString().slice(0, 10) !== value
    )
      return;
    o.date = value;
  } else if (["from", "to", "account"].includes(field)) {
    if (!importAccounts().some((a) => a.id === value)) return;
    o[field] = value;
  } else if (field === "type") {
    if (!["expense", "income", "refund", "transfer"].includes(value)) return;
    o.type = value;
    o.needsType = false;
    if (value === "transfer") o.category = "Перевод";
  } else if (field === "currency") {
    if (!["RUB", "TRY", "USD", "EUR", "GBP"].includes(value)) return;
    o.currency = value;
  } else o.name = value.trim().slice(0, 120);
  state.importToast = "";
  renderImport();
}

export function importVisual(o) {
  const v = categoryVisual(o.category, o.type);
  return { icon: icon(o.type === "refund" ? "refresh" : v.icon), tone: v.tone };
}
export function importListRows() {
  let prev = "",
    html = "";
  state.draft.forEach((o, i) => {
    const issues = importIssues(o);
    if (state.importOnlyIssues && (!o.selected || !issues.length)) return;
    const date = importDateLabel(o);
    if (date !== prev) {
      html += `<div class="import-date">${esc(date)}</div>`;
      prev = date;
    }
    const account = importAccounts().find((a) => a.id === o.account)?.name;
    const route =
      o.type === "transfer"
        ? [o.from, o.to]
            .map((id) => importAccounts().find((a) => a.id === id)?.name || "Счёт")
            .join(" → ")
        : account;
    const visual = importVisual(o);
    html += `<div class="import-item ${o.selected ? "" : "excluded"} ${issues.length ? "needs-attention" : ""}"><label class="import-check"><input type="checkbox" aria-label="Добавить ${esc(o.name)}" ${o.selected ? "checked" : ""} data-action="toggleImportRow" data-action-event="change" data-index="${esc(i)}"></label><span class="import-visual ${visual.tone}">${visual.icon}</span><button class="import-item-main" data-action="editImportRow" data-action-event="click" data-index="${esc(i)}"><span class="import-name">${esc(o.name)}</span><span class="import-price ${["income", "refund", "review"].includes(o.type) ? "positive" : ""}">${["income", "refund", "review"].includes(o.type) ? "+" : o.type === "transfer" ? "" : "−"}${esc(importAmountLabel(o))}</span><small>${esc(o.category)} · ${esc(o.operationLabel || importTypes[o.type] || o.type)}${route ? " · " + esc(route) : ""}</small></button>${o.selected ? importInlineFields(o, i) : ""}</div>`;
  });
  return html || '<p class="muted">Все выбранные операции готовы.</p>';
}
export function setImportAccount(id) {
  if (!importAccounts().some((a) => a.id === id)) return;
  state.bulkSettings.account = id;
  for (const o of state.draft) {
    if (o.type === "transfer") {
      if (state.bulkSettings.side !== "skip") o[state.bulkSettings.side] = id;
    } else {
      o.account = id;
      if (o.accountHint) state.importPendingAliases[o.accountHint] = id;
    }
  }
  state.importToast = "";
  renderImport();
}
export function setImportYear(year) {
  const previousYear = state.bulkSettings.year;
  state.bulkSettings.year = year;
  if (!/^\d{4}$/.test(year) || +year < 1900 || +year > 2100) {
    state.importToast = "Укажите год от 1900 до 2100.";
    renderImport();
    return;
  }
  for (const o of state.draft)
    if (
      o.partialDate &&
      (!o.date || o.date === FinanceOCR.resolvePartial(o.partialDate, previousYear))
    ) {
      o.date = FinanceOCR.resolvePartial(o.partialDate, year);
    }
  state.importToast = "";
  renderImport();
}
export function setMissingDate(date) {
  if (date) {
    state.draft.forEach((o) => {
      if (o.selected && !o.date) o.date = date;
    });
    renderImport();
  }
}
export function setAllImportDates(date) {
  if (date) {
    state.bulkSettings.date = date;
    state.draft.forEach((o) => (o.date = date));
    renderImport();
  }
}
export function selectImportRows(value) {
  state.draft.forEach((o) => (o.selected = value));
  renderImport();
}
export function importOptions(options, value) {
  return options
    .map(
      ([v, n]) => `<option value="${esc(v)}" ${v === value ? "selected" : ""}>${esc(n)}</option>`,
    )
    .join("");
}
export function openImportEditor(index) {
  state.importEditing = index;
  const o =
    index < 0
      ? {
          name: "",
          amount: "",
          currency: "RUB",
          type: "expense",
          date: state.bulkSettings.date || "",
          account: state.bulkSettings.account,
          category: "Другое",
          selected: true,
        }
      : state.draft[index];
  const f = $("#importeditform"),
    accounts = [["", "Выберите счёт"], ...importAccounts().map((a) => [a.id, a.name])];
  f.innerHTML = `<h2>${index < 0 ? "Добавить операцию" : "Изменить операцию"}</h2><label>Название<input name="name" required maxlength="120" value="${esc(o.name)}"></label><div class="import-editor-grid"><label>Сумма<input name="amount" type="number" min="0.01" step="0.01" required value="${o.amount}"></label><label>Валюта<select name="currency" data-action="changeImportEditType" data-action-event="change">${importOptions(
    [
      ["RUB", "Рубли · ₽"],
      ["TRY", "Лиры · ₺"],
      ["USD", "Доллары · $"],
      ["EUR", "Евро · €"],
      ["GBP", "Фунты · £"],
      ["OTHER", "Уточнить валюту"],
    ],
    o.currency || "RUB",
  )}</select></label></div><label id="rubamountlabel">Списано / зачислено в рублях<input name="rubAmount" type="number" min="0.01" step="0.01" value="${o.rubAmount || ""}"><small>Укажите рублёвую сумму из банка. Автоконвертации нет.</small></label><div class="import-editor-grid"><label>Дата<input name="date" type="date" required value="${o.date || ""}"></label><label>Тип<select name="type" data-action="changeImportEditAccount" data-action-event="change">${importOptions(
    [
      ["review", "Выберите тип"],
      ["expense", "Расход"],
      ["income", "Доход"],
      ["refund", "Возврат покупки"],
      ["transfer", "Между своими счетами"],
    ],
    o.type,
  )}</select></label></div><label>Категория<input name="category" list="importcategorylist" required maxlength="60" value="${esc(o.category)}"><datalist id="importcategorylist">${importCategories()
    .map((c) => `<option value="${esc(c)}"></option>`)
    .join(
      "",
    )}</datalist></label><label id="importaccountlabel">Счёт<select name="account">${importOptions(accounts, o.account || "")}</select></label><div id="importtransferfields" class="import-editor-grid"><label>Со счёта<select name="from">${importOptions(accounts, o.from || "")}</select></label><label>На счёт<select name="to">${importOptions(accounts, o.to || "")}</select></label></div><details><summary>Время и источник</summary><label>Время<input name="time" type="time" value="${o.time || ""}"></label>${o.raw ? `<p class="muted">${esc(o.raw)}</p>` : ""}</details><p id="importediterror" role="status"></p><div class="actions"><button class="primary">Готово</button><button type="button" data-action="closeImportEditor" data-action-event="click">Отмена</button></div>`;
  updateImportEditorFields();
  $("#importeditor").showModal();
}
export function updateImportEditorFields() {
  const f = $("#importeditform"),
    foreign = f.elements.currency.value !== "RUB",
    transfer = f.elements.type.value === "transfer";
  $("#rubamountlabel").hidden = !foreign;
  f.elements.rubAmount.required = foreign;
  $("#importtransferfields").hidden = !transfer;
  $("#importaccountlabel").hidden = transfer;
}
export function saveImportEdit(event) {
  event.preventDefault();
  const f = event.target,
    old = state.importEditing < 0 ? {} : state.draft[state.importEditing],
    currency = f.elements.currency.value,
    type = f.elements.type.value,
    o = {
      ...old,
      name: f.elements.name.value.trim(),
      amount: Number(f.elements.amount.value),
      currency,
      rubAmount: currency === "RUB" ? undefined : Number(f.elements.rubAmount.value),
      type,
      date: f.elements.date.value,
      time: f.elements.time.value,
      category:
        type === "transfer" ? "Перевод" : cleanCategory(f.elements.category.value) || "Другое",
      account: f.elements.account.value,
      from: f.elements.from.value,
      to: f.elements.to.value,
      selected: old.autoExcluded ? true : old.selected !== false,
      autoExcluded: false,
      needsType: false,
    };
  o.operationLabel = importTypes[type] || type;
  const issues = importIssues(o);
  if (issues.length) {
    $("#importediterror").textContent = "Уточните: " + issues.join(", ");
    return;
  }
  if (o.accountHint && o.account) state.importPendingAliases[o.accountHint] = o.account;
  if (o.type === "transfer") {
    if (o.fromHint) state.importPendingAliases[o.fromHint] = o.from;
    if (o.toHint) state.importPendingAliases[o.toHint] = o.to;
  }
  if (old.category !== o.category) {
    o.rememberCategory = true;
    o.categoryManual = true;
  }
  if (state.importEditing < 0) state.draft.push(o);
  else state.draft[state.importEditing] = o;
  animateDialogClose($("#importeditor"));
  state.importToast = "";
  renderImport();
}
export async function importSave() {
  if (state.importSaving) return;
  state.importSaving = true;
  const container = $("#content"),
    previousInert = container.inert;
  container.inert = true;
  try {
    const rows = state.draft.filter((o) => o.selected);
    if (!rows.length) return;
    if (
      rows.some(
        (o) =>
          importIssues(o).length ||
          FinanceOCR.partialDateIn(o.name) ||
          FinanceOCR.uncertainDateHeader(o.name),
      )
    ) {
      state.importToast = "Уточните отмеченные операции.";
      renderImport();
      return;
    }
    const mapped = rows.map((o) => ({
      id: crypto.randomUUID(),
      name: o.name.trim(),
      amountMinor: Money.toMinor(importRubAmount(o)),
      type: o.type,
      date: o.date,
      time: o.time || "",
      category: o.type === "transfer" ? "Перевод" : o.category,
      account: o.type === "transfer" ? o.from : o.account,
      ...(o.type === "transfer" ? { to: o.to } : {}),
      ...((o.currency || "RUB") !== "RUB"
        ? { originalAmountMinor: Money.toMinor(o.amount), originalCurrency: o.currency }
        : {}),
      sourceId: o.sourceId || "",
      operationLabel: o.operationLabel || "",
    }));
    const dup = mapped.filter(
      (o, i) =>
        liveRecords("ops").some((x) => importSame(x, o)) ||
        mapped
          .slice(0, i)
          .some((x) => x.sourceId && o.sourceId && x.sourceId !== o.sourceId && importSame(x, o)),
    );
    if (
      dup.length &&
      !(await askConfirm(
        `Похожих записей уже в бюджете или на другом скриншоте: ${dup.length}. Сохранить их тоже?`,
      ))
    )
      return;
    commitImportCategories(rows);
    mapped.forEach((o, i) => (o.category = rows[i].category));
    commitImportAccounts(rows);
    state.db.ops.push(...mapped);
    for (const o of rows)
      if (o.rememberCategory || (state.useBankCategories && o.bankCategory)) rememberCategory(o);
    state.db.hasScreenshotImport = true;
    save({ snapshot: true });
    await archiveImportedScreenshots(state.ocrFiles.slice(), rows);
    state.draft = [];
    state.ocrFiles = [];
    state.ocrRaw = "";
    state.importToast = "";
    $("#month").value = mapped[0].date.slice(0, 7);
    state.importCompleted = { count: mapped.length };
    state.page = "Импорт";
    render();
  } finally {
    state.importSaving = false;
    container.inert = Boolean(previousInert);
  }
}
export function pickScreenshotFiles(event, element) {
  return document.getElementById("files").click();
}
export function cancelScreenshotRecognition(event, element) {
  return cancelOCR();
}
export function retryScreenshotRecognition(event, element) {
  return recognizeScreenshots();
}
export function changeImportAccount(event, element) {
  return setImportAccount(element.value);
}
export function changeImportYear(event, element) {
  return setImportYear(element.value);
}
export function changeMissingImportDate(event, element) {
  return setMissingDate(element.value);
}
export function changeAllImportDates(event, element) {
  return setAllImportDates(element.value);
}
export function changeTransferAccountSide(event, element) {
  state.bulkSettings.side = element.value;
  if (state.bulkSettings.account) setImportAccount(state.bulkSettings.account);
}
export function selectAllImportRows(event, element) {
  return selectImportRows(true);
}
export function deselectAllImportRows(event, element) {
  return selectImportRows(false);
}
export function createImportRow(event, element) {
  return openImportEditor(-1);
}
export function changeBankCategoryPreference(event, element) {
  return toggleBankCategories(element.checked);
}
export function toggleImportIssues(event, element) {
  state.importOnlyIssues = !state.importOnlyIssues;
  renderImport();
}
export function saveScreenshotOperations(event, element) {
  return importSave();
}
export function loadImportExample(event, element) {
  return demo();
}
export function toggleImportRow(event, element) {
  state.draft[Number(element.dataset.index)].selected = element.checked;
  state.importToast = "";
  renderImport();
}
export function editImportRow(event, element) {
  return openImportEditor(Number(element.dataset.index));
}
export function changeImportEditType(event, element) {
  return updateImportEditorFields();
}
export function changeImportEditAccount(event, element) {
  return updateImportEditorFields();
}
export function closeImportEditor(event, element) {
  return animateDialogClose(document.getElementById("importeditor"));
}
