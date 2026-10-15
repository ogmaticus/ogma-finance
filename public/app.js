import { BUDGET_MAX_BYTES } from "./budget-schema.js?v=32";
import { initializeOperationForm } from "./operation-form.js?v=32";
import { analyticsView, revealCurrentChartMonth } from "./analytics-ui.js?v=32";
import { operationsRows, renderOperations } from "./operations-ui.js?v=32";
import { navigationMarkup, moreMarkup, settingsMarkup, overviewMarkup } from "./shell-ui.js?v=32";
import { preserveLegacyBudget } from "./migration-copy.js?v=32";
import { defaultOperationDate, localDate } from "./dates.js?v=32";
import { screenshotSourceId } from "./screenshot-source.js?v=32";
import { Money } from "./money.js?v=32";
import { state } from "./state.js?v=32";
import {
  emptyPersonalBudget,
  parseBudget,
  liveRecords,
  rememberBudgetBaseline,
} from "./sync-core.js?v=32";
import {
  initializeMonthSelection,
  setFinanceMonth,
  updateMonthControl,
} from "./month-picker.js?v=32";
import { persistBudget, renderProfile } from "./sync.js?v=32";
import { $, esc, money } from "./format.js?v=32";
import { categoryKey, accountLast4, renderImport, prepareImportDraft } from "./import-ui.js?v=32";
import { FinanceData } from "./data-model.js?v=32";
import { FinanceBudget } from "./budget-core.js?v=32";
import { budgetView } from "./budget-ui.js?v=32";
import { categoriesView, editFromCategory, showCategoryHistory } from "./category-history.js?v=32";
import { askConfirm, animateDialogClose, askForm } from "./ui.js?v=32";
import { FinanceOCR } from "./ocr-parser.js?v=32";
import { refineCurrencyGlyphs } from "./ocr-refine.js?v=32";
import { openLocalScreenshot } from "./file-vault.js?v=32";
import { account } from "./accounts.js?v=32";
import { openAccountDelete, editGoal, deleteGoal } from "./record-actions.js?v=32";
import { initializeEvents } from "./events.js?v=32";
export const seed = {
  accounts: [
    { id: "cash", name: "Наличные", opening: 5000 },
    { id: "card", name: "Основная карта", opening: 25000 },
    { id: "save", name: "Накопительный счёт", opening: 35000 },
  ],
  ops: [
    {
      id: "s1",
      name: "Зарплата",
      amount: 85000,
      type: "income",
      date: localDate().slice(0, 7) + "-01",
      account: "card",
      category: "Зарплата",
    },
    {
      id: "s2",
      name: "Продукты на неделю",
      amount: 4380,
      type: "expense",
      date: localDate().slice(0, 7) + "-03",
      account: "card",
      category: "Продукты",
    },
    {
      id: "s3",
      name: "Аренда квартиры",
      amount: 28000,
      type: "expense",
      date: localDate().slice(0, 7) + "-04",
      account: "card",
      category: "Жильё",
    },
    {
      id: "s4",
      name: "Кофейня",
      amount: 480,
      type: "expense",
      date: localDate().slice(0, 7) + "-06",
      account: "card",
      category: "Кафе",
    },
    {
      id: "s5",
      name: "Проезд",
      amount: 320,
      type: "expense",
      date: localDate().slice(0, 7) + "-07",
      account: "cash",
      category: "Транспорт",
    },
  ],
  limits: {
    Продукты: 18000,
    Транспорт: 5000,
    Покупки: 10000,
    Кафе: 6000,
    Жильё: 30000,
    Здоровье: 5000,
    Развлечения: 7000,
    Другое: 5000,
  },
  goals: [
    {
      name: "Финансовая подушка",
      target: 150000,
      saved: 35000,
      date: defaultOperationDate(
        localDate(new Date(new Date().getFullYear(), new Date().getMonth() + 6, 1)).slice(0, 7),
      ),
    },
    {
      name: "Отпуск",
      target: 100000,
      saved: 12000,
      date: defaultOperationDate(
        localDate(new Date(new Date().getFullYear(), new Date().getMonth() + 9, 1)).slice(0, 7),
      ),
    },
  ],
};
try {
  const prior = localStorage.getItem("finance-prototype-v1");
  if (prior) preserveLegacyBudget(JSON.parse(prior));
  state.db = parseBudget(localStorage.getItem("finance-prototype-v1") || structuredClone(seed));
} catch {
  state.db = emptyPersonalBudget();
  state.cloudError =
    "Сохранённые данные не прошли проверку. Исходный файл остаётся на устройстве; скачайте его в разделе копий.";
}
if (!Array.isArray(state.db.merchantRules)) state.db.merchantRules = [];
if (!Array.isArray(state.db.categories)) state.db.categories = [];
for (const c of [...state.db.categories, ...liveRecords("ops").map((o) => o.category)])
  if (c && c !== "Перевод" && !state.cats.includes(c)) state.cats.push(c);
initializeMonthSelection();
rememberBudgetBaseline(state.db);
export const save = (options) => persistBudget(state.db, options),
  selected = () => liveRecords("ops").filter((o) => o.date.startsWith($("#month").value)),
  total = (t, ops = selected()) =>
    ops
      .filter((o) => o.type === t || (t === "expense" && o.type === "refund"))
      .reduce(
        (s, o) => s + (t === "expense" && o.type === "refund" ? -o.amountMinor : o.amountMinor),
        0,
      ),
  balance = (a) =>
    a.openingMinor +
    liveRecords("ops").reduce(
      (s, o) =>
        s +
        (o.account === a.id
          ? ["income", "refund"].includes(o.type)
            ? o.amountMinor
            : -o.amountMinor
          : 0) +
        (o.type === "transfer" && o.to === a.id ? o.amountMinor : 0),
      0,
    ),
  catSpend = (c) =>
    selected()
      .filter((o) => ["expense", "refund"].includes(o.type) && o.category === c)
      .reduce((s, o) => s + (o.type === "refund" ? -o.amountMinor : o.amountMinor), 0);
$("#nav").innerHTML = navigationMarkup(state.page);
$("#month").onchange = () => setFinanceMonth($("#month").value);
export function merchantKey(name) {
  return name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^а-яa-z0-9]/g, "");
}
export function rememberCategory(o) {
  if (!["expense", "refund"].includes(o.type) || !state.cats.includes(o.category)) return;
  const key = merchantKey(o.name);
  if (!key) return;
  const existingRule = liveRecords("merchantRules").find((r) => r.key === key);
  const rule = {
    ...(existingRule || {}),
    id: existingRule?.id || crypto.randomUUID(),
    key,
    name: o.name,
    category: o.category,
    origin:
      o.bankCategory &&
      !o.rememberCategory &&
      categoryKey(o.category) === categoryKey(o.bankCategory)
        ? "bank"
        : "manual",
  };
  const i = state.db.merchantRules.findIndex((r) => !r.deletedAt && r.key === key);
  if (i < 0) state.db.merchantRules.push(rule);
  else state.db.merchantRules[i] = rule;
}
export function applyMerchantCategory(o) {
  if (!["expense", "refund"].includes(o.type)) return o;
  const key = merchantKey(o.name),
    rule = liveRecords("merchantRules").find((r) => r.key === key),
    prior = [...liveRecords("ops")]
      .reverse()
      .find((x) => x.type === "expense" && merchantKey(x.name) === key);
  if (rule?.origin === "bank" && o.bankCategory) return o;
  const category = rule?.category || (o.type === "refund" ? prior?.category : undefined);
  if (!category) return o;
  return {
    ...o,
    category,
    categorySource: rule ? "rule" : "prior",
    note: (o.note || "") + " · Категория из ваших записей: " + category,
  };
}
export function merchantRulesCard() {
  return `<div class="card"><h2>Категории магазинов</h2><p class="muted">Используются при следующем распознавании. Можно удалить правило и снова выбирать категорию вручную.</p>${
    liveRecords("merchantRules").length
      ? liveRecords("merchantRules")
          .map(
            (r, i) =>
              `<div class="row"><div><b>${esc(r.name)}</b><br><small>${esc(r.category)}</small></div><button data-action="removeCategoryRule" data-action-event="click" data-record-id="${esc(r.id)}">Удалить правило</button></div>`,
          )
          .join("")
      : '<p class="muted">Пока нет правил. Измените категорию операции при импорте и сохраните её.</p>'
  }</div>`;
}
export function removeMerchantRule(id) {
  state.db = FinanceData.remove(state.db, "merchantRules", id);
  save();
  render();
}
export function go(p) {
  if (p === "Импорт") state.importCompleted = null;
  state.page = p;
  render();
}
export function opRows(ops) {
  return operationsRows(ops, liveRecords("accounts"));
}
export function render() {
  updateMonthControl();
  const budgetWarning = $("#budget-storage-warning");
  if (budgetWarning)
    budgetWarning.hidden =
      new TextEncoder().encode(JSON.stringify(state.db)).length < BUDGET_MAX_BYTES * 0.8;
  $("#title").textContent = state.page;
  $("#nav").innerHTML = navigationMarkup(state.page);
  const header = $("#app-header");
  header.dataset.page = state.page;
  header.dataset.importStep = "";
  const c = $("#content"),
    all = liveRecords("accounts").reduce((s, a) => s + balance(a), 0),
    budgetReport = FinanceBudget.report(state.db, $("#month").value, state.cats);
  if (state.page === "Обзор")
    c.innerHTML = overviewMarkup({
      all,
      income: total("income"),
      expense: total("expense"),
      report: budgetReport,
      ops: selected(),
      accounts: liveRecords("accounts"),
      month: $("#month").value,
      hasImported: state.db.hasScreenshotImport,
    });
  if (state.page === "Ещё") c.innerHTML = moreMarkup();
  if (state.page === "Настройки") c.innerHTML = settingsMarkup();
  if (state.page === "Счета")
    c.innerHTML = `<div class="grid">${liveRecords("accounts")
      .map(
        (a, i) =>
          `<div class="card"><small>${a.type === "cash" ? "Наличные" : a.type === "card" ? "Карта" : "Счёт"}${accountLast4(a) && !a.name.includes(accountLast4(a)) ? " · •" + accountLast4(a) : ""}</small><h2 style="margin-top:var(--gap-8)">${esc(a.name)}</h2><div class="money">${money(balance(a))}</div><p class="muted">Начальный остаток: ${money(a.openingMinor)}</p><div class="actions"><button data-action="editAccountById" data-action-event="click" data-record-id="${esc(a.id)}">Изменить</button><button class="negative" data-action="deleteAccountById" data-action-event="click" data-record-id="${esc(a.id)}">Удалить</button></div></div>`,
      )
      .join(
        "",
      )}</div><button class="primary" data-action="createAccount" data-action-event="click">+ Добавить карту / счёт</button>`;
  if (state.page === "Операции") renderOperations();
  if (state.page === "Бюджет") c.innerHTML = budgetView();
  if (state.page === "Аналитика") {
    c.innerHTML = analyticsView();
    revealCurrentChartMonth();
  }
  if (state.page === "Категории") c.innerHTML = categoriesView() + merchantRulesCard();
  if (state.page === "Цели")
    c.innerHTML = `<div class="notice">Суммы целей показывают распределённые накопления. Пополнение цели само по себе не создаёт расход или перевод.</div><div class="grid">${liveRecords(
      "goals",
    )
      .map(
        (g, i) =>
          `<div class="card"><span class="badge">До ${esc(g.date)}</span><h2 style="margin-top:var(--gap-16)">${esc(g.name)}</h2><div class="money">${money(g.savedMinor)}</div><p class="muted">из ${money(g.targetMinor)}</p><div class="bar"><i style="width:${Math.min(100, (g.savedMinor / g.targetMinor) * 100)}%"></i></div><p>${Math.round((g.savedMinor / g.targetMinor) * 100)}% цели · Осталось ${money(Math.max(0, g.targetMinor - g.savedMinor))}</p><div class="actions"><button data-action="fundGoalById" data-action-event="click" data-record-id="${esc(g.id)}">+ Пополнить</button><button data-action="editGoalById" data-action-event="click" data-record-id="${esc(g.id)}">Изменить</button><button class="negative" data-action="deleteGoalById" data-action-event="click" data-record-id="${esc(g.id)}">Удалить</button></div></div>`,
      )
      .join(
        "",
      )}</div><button class="primary" data-action="createGoal" data-action-event="click">+ Новая цель</button>`;
  if (state.page === "Импорт") renderImport();
  if (state.page === "Личный кабинет") renderProfile();
}
export function edit(id) {
  state.editId = id || null;
  const o = liveRecords("ops").find((o) => o.id === id);
  $("#formtitle").textContent = o ? "Редактирование" : "Новая операция";
  const f = $("#form");
  f.reset();
  f.account.innerHTML = liveRecords("accounts")
    .map((a) => `<option value="${a.id}">${esc(a.name)}</option>`)
    .join("");
  f.to.innerHTML = f.account.innerHTML;
  f.category.innerHTML = state.cats.map((c) => `<option>${esc(c)}</option>`).join("");
  for (const k of ["name", "amount", "type", "date", "time", "account", "category", "to"])
    if (o && o[k] != null) f.elements[k].value = o[k];
  if (o) f.amount.value = Money.input(o.amountMinor);
  if (!o) f.date.value = defaultOperationDate($("#month").value);
  initializeOperationForm(o);
  $("#delete").hidden = !o;
  $("#delete").onclick = async () => {
    if (await askConfirm("Удалить операцию?", "Удалить")) {
      state.db = FinanceData.remove(state.db, "ops", id);
      save();
      animateDialogClose($("#modal"));
      render();
    }
  };
  $("#modal").showModal();
  f.amount.focus?.({ preventScroll: true });
}
export function saveOperation(e) {
  e.preventDefault();
  const f = e.target;
  try {
    const prior = liveRecords("ops").find((x) => x.id === state.editId),
      o = {
        ...prior,
        id: state.editId || crypto.randomUUID(),
        name: f.elements.name.value.trim(),
        amountMinor: Money.toMinor(f.elements.amount.value),
        type: f.elements.type.value,
        date: f.elements.date.value,
        time: f.elements.time.value,
        account: f.elements.account.value,
        category: f.elements.category.value,
        note: f.elements.note.value.trim(),
      };
    if (!o.name || o.amountMinor <= 0) throw Error("Укажите название и сумму больше нуля.");
    if (
      !/^\d{4}-\d\d-\d\d$/.test(o.date) ||
      !Number.isFinite(Date.parse(o.date + "T12:00:00Z")) ||
      new Date(o.date + "T12:00:00Z").toISOString().slice(0, 10) !== o.date
    )
      throw Error("Выберите корректную дату.");
    if (!liveRecords("accounts").some((a) => a.id === o.account)) throw Error("Выберите счёт.");
    if (o.type === "transfer") {
      o.to = f.elements.to.value;
      o.category = "Перевод";
      if (o.account === o.to || !liveRecords("accounts").some((a) => a.id === o.to))
        throw Error("Выберите два разных счёта.");
    } else {
      delete o.to;
      if (!o.category) throw Error("Выберите категорию.");
    }
    if (state.editId) state.db.ops = state.db.ops.map((x) => (x.id === state.editId ? o : x));
    else state.db.ops.push(o);
    rememberCategory({ ...o, rememberCategory: true });
    save();
    $("#operation-form-error").textContent = "";
    animateDialogClose($("#modal"));
    setFinanceMonth(o.date.slice(0, 7));
    render();
  } catch (error) {
    $("#operation-form-error").textContent = error.message;
  }
}
$("#form").onsubmit = saveOperation;
export async function fund(id) {
  const record = liveRecords("goals").find((g) => g.id === id);
  if (!record) return;
  const values = await askForm({
    title: record.name,
    fields: [
      {
        name: "amount",
        label: "Добавить к накоплениям, ₽",
        type: "number",
        min: 0.01,
        step: "0.01",
        required: true,
      },
    ],
  });
  if (values && Number.isFinite(+values.amount) && +values.amount > 0) {
    record.savedMinor = Money.add(record.savedMinor, Money.toMinor(values.amount));
    save();
    render();
  }
}
export async function goal() {
  const values = await askForm({
    title: "Новая цель",
    fields: [
      { name: "name", label: "Название", required: true },
      {
        name: "amount",
        label: "Сумма, ₽",
        type: "number",
        min: 0.01,
        step: "0.01",
        required: true,
      },
      { name: "date", label: "Срок", type: "date", required: true },
    ],
  });
  if (
    values &&
    values.name.trim() &&
    Number.isFinite(+values.amount) &&
    +values.amount > 0 &&
    FinanceOCR.dateIn(values.date)
  ) {
    state.db.goals.push({
      id: crypto.randomUUID(),
      name: values.name.trim(),
      targetMinor: Money.toMinor(values.amount),
      savedMinor: 0,
      date: values.date,
    });
    save();
    render();
  }
}
export function demo() {
  state.draft = [
    ["Стрелка", 55, "expense", "Транспорт"],
    ["Яндекс.Маркет", 293, "expense", "Покупки"],
    ["Перевод со своего счёта", 1000, "transfer", "Перевод"],
    ["Пятёрочка", 1977.01, "expense", "Продукты"],
    ["Перевод со своего счёта", 2000, "transfer", "Перевод"],
    ["Татьяна Константиновна Б.", 3000, "review", "Другое"],
  ].map(([name, amount, type, category], i) => ({
    name,
    amount,
    type,
    category,
    date: "",
    selected: true,
    account: i === 5 ? "cash" : "card",
    to: "card",
    from: "cash",
  }));
  state.draft = prepareImportDraft(state.draft);
  renderImport();
}
export function ocrStatus(message) {
  state.ocrMessage = message;
  const node = $("#ocrstatus");
  if (node) node.textContent = message;
}
export async function loadOCR() {
  if (window.Tesseract) return;
  await new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "/ocr/tesseract.min.js";
    script.onload = resolve;
    script.onerror = () => {
      script.remove();
      reject(
        new Error("Не удалось загрузить модуль распознавания. Проверьте соединение и повторите."),
      );
    };
    document.head.append(script);
  });
}
export async function prepareOCRImage(file) {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(2, 2200 / bitmap.width, 4200 / bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.originalWidth = bitmap.width;
    canvas.originalHeight = bitmap.height;
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let brightness = 0,
      count = 0;
    for (let i = 0; i < data.data.length; i += 400) {
      brightness += (data.data[i] + data.data[i + 1] + data.data[i + 2]) / 3;
      count++;
    }
    const invert = brightness / count < 110;
    for (let i = 0; i < data.data.length; i += 4) {
      let gray = 0.299 * data.data[i] + 0.587 * data.data[i + 1] + 0.114 * data.data[i + 2];
      if (invert) gray = 255 - gray;
      data.data[i] = data.data[i + 1] = data.data[i + 2] = gray;
      data.data[i + 3] = 255;
    }
    ctx.putImageData(data, 0, 0);
    return canvas;
  } finally {
    bitmap.close();
  }
}
export async function recognizeScreenshots() {
  if (state.ocrBusy || !state.ocrFiles.length) return;
  if (
    state.draft.length &&
    !(await askConfirm("Заменить текущий список результатом нового распознавания?", "Заменить"))
  )
    return;
  state.ocrProgress = 0;
  state.importCompleted = null;
  state.ocrBusy = true;
  state.ocrCancelled = false;
  state.ocrMessage = "Загрузка распознавания…";
  renderImport();
  let found = [],
    texts = [],
    failures = [];
  try {
    await loadOCR();
    if (state.ocrCancelled) return;
    let index = 0;
    state.ocrWorker = await window.Tesseract.createWorker("rus+eng", 1, {
      workerPath: "/ocr/worker.min.js",
      corePath: "/ocr/tesseract-core-lstm.wasm.js",
      langPath: "/ocr",
      gzip: true,
      logger: (m) => {
        if (!state.ocrCancelled) {
          state.ocrProgress = Math.round((m.progress || 0) * 100);
          const progress = $("#ocrprogress");
          if (progress) progress.value = state.ocrProgress;
          ocrStatus(
            `Скриншот ${index + 1}/${state.ocrFiles.length} · ${m.status === "recognizing text" ? "Распознавание текста" : "Подготовка"} ${Math.round((m.progress || 0) * 100)}%`,
          );
        }
      },
    });
    await state.ocrWorker.setParameters({ tessedit_pageseg_mode: "11" });
    for (index = 0; index < state.ocrFiles.length; index++) {
      if (state.ocrCancelled) break;
      try {
        const canvas = await prepareOCRImage(state.ocrFiles[index]);
        if (state.ocrCancelled) break;
        const width = canvas.originalWidth,
          height = canvas.originalHeight;
        const { data } = await state.ocrWorker.recognize(
          canvas,
          {},
          { text: true, blocks: true, hocr: false, tsv: false },
        );
        canvas.width = canvas.height = 0;
        if (state.ocrCancelled) break;
        const sourceId = await screenshotSourceId(state.ocrFiles[index]);
        const { data: original } = await state.ocrWorker.recognize(
          state.ocrFiles[index],
          {},
          { text: true, blocks: true, hocr: false, tsv: false },
        );
        await refineCurrencyGlyphs(
          state.ocrWorker,
          state.ocrFiles[index],
          original,
          width,
          height,
          () => state.ocrCancelled,
        );
        if (state.ocrCancelled) break;
        texts.push(
          state.ocrFiles[index].name + "\n" + data.text + "\n— Второй проход —\n" + original.text,
        );
        found.push(
          ...FinanceOCR.mergePasses(FinanceOCR.parse(data), FinanceOCR.parse(original)).map(
            (o) => ({
              ...applyMerchantCategory(o),
              account: "",
              from: "",
              to: "",
              sourceId: sourceId,
              note: state.ocrFiles[index].name + " · " + o.note,
            }),
          ),
        );
      } catch (error) {
        if (!state.ocrCancelled) failures.push(state.ocrFiles[index].name);
      }
    }
    if (!state.ocrCancelled) {
      state.draft = prepareImportDraft(found);
      state.ocrRaw = texts.join("\n\n");
      state.ocrMessage = found.length
        ? `Найдено операций: ${found.length}. Проверьте каждую перед сохранением.`
        : "Операции не удалось выделить. Посмотрите распознанный текст; попробуйте более чёткий скриншот или добавьте операцию вручную.";
      if (failures.length) state.ocrMessage += " Не удалось обработать: " + failures.join(", ");
    }
  } catch (error) {
    if (!state.ocrCancelled)
      state.ocrMessage = "Распознавание не выполнено. " + (error.message || "Попробуйте ещё раз.");
  } finally {
    if (state.ocrWorker) {
      await state.ocrWorker.terminate().catch(() => {});
      state.ocrWorker = null;
    }
    state.ocrBusy = false;
    if (state.ocrCancelled)
      state.ocrMessage = "Распознавание отменено. Предыдущие записи сохранены.";
    if (state.page === "Импорт") renderImport();
  }
}
export async function cancelOCR() {
  state.ocrCancelled = true;
  ocrStatus("Отмена…");
  if (state.ocrWorker) await state.ocrWorker.terminate().catch(() => {});
}
render();
export function openOperationFromRow(id, element) {
  if (element.closest("#categoryhistory")) editFromCategory(id);
  else edit(id);
}
export function removeCategoryRule(event, element) {
  return removeMerchantRule(element.dataset.recordId);
}
export function viewLocalScreenshot(event, element) {
  return openLocalScreenshot(element.dataset.source);
}
export function editOperationFromList(event, element) {
  return openOperationFromRow(element.dataset.recordId, element);
}
export function showOperations(event, element) {
  return go("Операции");
}
export function openScreenshotImport(event, element) {
  return go("Импорт");
}
export function showBudget(event, element) {
  return go("Бюджет");
}
export function editAccountById(event, element) {
  return account(element.dataset.recordId);
}
export function deleteAccountById(event, element) {
  return openAccountDelete(element.dataset.recordId);
}
export function createAccount(event, element) {
  return account();
}
export function showIndexedCategoryHistory(event, element) {
  return showCategoryHistory(state.cats[Number(element.dataset.index)]);
}
export function fundGoalById(event, element) {
  return fund(element.dataset.recordId);
}
export function editGoalById(event, element) {
  return editGoal(element.dataset.recordId);
}
export function deleteGoalById(event, element) {
  return deleteGoal(element.dataset.recordId);
}
export function createGoal(event, element) {
  return goal();
}
initializeEvents();
