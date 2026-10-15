import { FinanceData } from "./data-model.js?v=31";
export const BUDGET_MAX_BYTES = 1900000;
export const BUDGET_SIZE_MESSAGE =
  "Бюджет превышает предел хранения 1 900 000 байт. Скачайте копию и уменьшите бюджет перед сохранением.";
const forbidden = (key) => ["__proto__", "constructor", "prototype"].includes(key);
const object = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const id = (value) =>
  typeof value === "string" && !forbidden(value) && /^[a-zA-Z0-9_-]{1,160}$/.test(value);
const stamp = (value) =>
  typeof value === "string" &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value;
const minor = (value) => Number.isSafeInteger(value);
const text = (max) => (value) =>
  typeof value === "string" &&
  value.length <= max &&
  !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
const date = (value) =>
  typeof value === "string" &&
  /^\d{4}-\d\d-\d\d$/.test(value) &&
  Number.isFinite(Date.parse(value + "T00:00:00Z")) &&
  new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value;
const bool = (value) => typeof value === "boolean";
const common = { id, updatedAt: stamp, deletedAt: stamp, name: text(200) };
const fields = {
  accounts: {
    ...common,
    name: text(160),
    openingMinor: minor,
    last4: (value) => typeof value === "string" && (/^\d{4}$/.test(value) || value === ""),
    type: (value) => ["cash", "card", "account"].includes(value),
    autoCreated: bool,
  },
  ops: {
    ...common,
    amountMinor: minor,
    type: (value) => ["expense", "income", "refund", "transfer"].includes(value),
    date,
    time: (value) => value === "" || /^([01]\d|2[0-3]):[0-5]\d$/.test(value),
    account: id,
    to: id,
    category: text(100),
    note: text(1000),
    sourceId: text(400),
    screenshotId: id,
    bankCategory: text(100),
    rawCategory: text(100),
    operationLabel: text(200),
    originalAmountMinor: minor,
    originalCurrency: (value) => /^[A-Z]{3}$/.test(value),
    localScreenshot: bool,
    screenshotUnavailable: bool,
    originalScreenshotId: id,
    needsAccountReview: bool,
  },
  goals: { ...common, targetMinor: minor, savedMinor: minor, date },
  merchantRules: {
    id,
    updatedAt: stamp,
    deletedAt: stamp,
    key: text(400),
    name: text(200),
    category: text(100),
    origin: (value) => ["bank", "manual"].includes(value),
  },
};
function limits(map) {
  if (!object(map) || Object.keys(map).length > 2000) throw Error("Некорректные лимиты");
  const result = {};
  for (const [key, value] of Object.entries(map)) {
    if (forbidden(key) || !text(100)(key) || !minor(value) || value < 0)
      throw Error("Некорректный лимит");
    result[key] = value;
  }
  return result;
}
function metadata(map, keyCheck) {
  if (!object(map) || Object.keys(map).length > 50000) throw Error("Некорректные метки");
  const result = {};
  for (const [key, value] of Object.entries(map)) {
    if (
      !keyCheck(key) ||
      !object(value) ||
      !stamp(value.updatedAt) ||
      (value.deletedAt !== undefined && !stamp(value.deletedAt))
    )
      throw Error("Некорректное время изменения");
    result[key] = {
      updatedAt: value.updatedAt,
      ...(value.deletedAt ? { deletedAt: value.deletedAt } : {}),
    };
  }
  return result;
}
export const BudgetSchema = {
  parse(input, { allowOversizeRead = false } = {}) {
    if (
      !object(input) ||
      !Array.isArray(input.accounts) ||
      !Array.isArray(input.ops) ||
      !Array.isArray(input.goals) ||
      !object(input.limits)
    )
      throw Error("Некорректная структура бюджета");
    if (input.schemaVersion !== undefined && ![1, 2, 3].includes(input.schemaVersion))
      throw Error("Неподдерживаемая версия бюджета");
    if (input.hasScreenshotImport !== undefined && !bool(input.hasScreenshotImport))
      throw Error("Некорректная отметка импорта");
    const data = FinanceData.normalize(input);
    FinanceData.validateMetadata(data);
    const result = { schemaVersion: 3, hasScreenshotImport: data.hasScreenshotImport };
    for (const collection of FinanceData.collections) {
      if (
        !Array.isArray(data[collection]) ||
        data[collection].length >
          { accounts: 10000, ops: 40000, goals: 5000, merchantRules: 10000 }[collection]
      )
        throw Error("Слишком много записей");
      result[collection] = data[collection].map((record) => {
        const cleaned = {};
        for (const [key, check] of Object.entries(fields[collection]))
          if (record[key] !== undefined) {
            if (!check(record[key])) throw Error("Некорректное поле: " + key);
            cleaned[key] = record[key];
          }
        return cleaned;
      });
    }
    const accounts = new Set(FinanceData.live(result.accounts).map((a) => a.id));
    for (const account of result.accounts)
      if (!minor(account.openingMinor) || !account.name) throw Error("Некорректный счёт");
    for (const operation of result.ops) {
      if (
        !operation.name ||
        !minor(operation.amountMinor) ||
        operation.amountMinor <= 0 ||
        !fields.ops.type(operation.type) ||
        !date(operation.date) ||
        !text(100)(operation.category) ||
        !id(operation.account)
      )
        throw Error("Некорректная операция");
      if (
        !operation.deletedAt &&
        !accounts.has(operation.account) &&
        !(operation.needsAccountReview && data.deletionMarkers.accounts[operation.account])
      )
        throw Error("Счёт операции не найден");
      if (
        operation.type === "transfer" &&
        (!id(operation.to) ||
          operation.to === operation.account ||
          (!operation.deletedAt &&
            !accounts.has(operation.to) &&
            !(operation.needsAccountReview && data.deletionMarkers.accounts[operation.to])))
      )
        throw Error("Некорректный перевод");
    }
    for (const goal of result.goals)
      if (
        !goal.name ||
        !minor(goal.targetMinor) ||
        goal.targetMinor <= 0 ||
        !minor(goal.savedMinor) ||
        goal.savedMinor < 0 ||
        (goal.date !== undefined && !date(goal.date))
      )
        throw Error("Некорректная цель");
    for (const rule of result.merchantRules)
      if (!rule.key || !text(100)(rule.category)) throw Error("Некорректное правило");
    result.limits = limits(data.limits);
    result.budgetsByMonth = {};
    if (!object(data.budgetsByMonth) || Object.keys(data.budgetsByMonth).length > 1200)
      throw Error("Некорректные планы");
    const month = (key) => /^\d{4}-(0[1-9]|1[0-2])$/.test(key);
    for (const [key, value] of Object.entries(data.budgetsByMonth)) {
      if (!month(key)) throw Error("Некорректный месяц");
      result.budgetsByMonth[key] = limits(value);
    }
    if (
      !Array.isArray(data.categories) ||
      data.categories.length > 2000 ||
      !data.categories.every(text(100))
    )
      throw Error("Некорректные категории");
    result.categories = [...new Set(data.categories)];
    result.accountAliases = {};
    for (const [key, value] of Object.entries(data.accountAliases)) {
      if (!/^\d{4}$/.test(key) || !id(value)) throw Error("Некорректная привязка счёта");
      result.accountAliases[key] = value;
    }
    result.deletionMarkers = {};
    for (const collection of FinanceData.collections) {
      result.deletionMarkers[collection] = {};
      for (const [key, value] of Object.entries(data.deletionMarkers[collection])) {
        if (!id(key) || !stamp(value)) throw Error("Некорректное удаление");
        result.deletionMarkers[collection][key] = value;
      }
    }
    const category = (key) => !forbidden(key) && text(100)(key);
    result.limitsMeta = metadata(data.limitsMeta, category);
    result.accountAliasesMeta = metadata(data.accountAliasesMeta, (key) => /^\d{4}$/.test(key));
    result.budgetsByMonthMeta = metadata(data.budgetsByMonthMeta, month);
    result.budgetLimitsMeta = {};
    for (const [key, value] of Object.entries(data.budgetLimitsMeta)) {
      if (!month(key)) throw Error("Некорректный месяц метки");
      result.budgetLimitsMeta[key] = metadata(value, category);
    }
    result.removedScreenshotIds = {};
    for (const [key, value] of Object.entries(data.removedScreenshotIds || {})) {
      if (!id(key) || !stamp(value)) throw Error("Некорректное удаление скриншота");
      result.removedScreenshotIds[key] = value;
    }
    let gross = 0n;
    for (const account of FinanceData.live(result.accounts)) {
      const amount = BigInt(account.openingMinor);
      gross += amount < 0n ? -amount : amount;
    }
    for (const operation of FinanceData.live(result.ops)) gross += BigInt(operation.amountMinor);
    if (gross > BigInt(Number.MAX_SAFE_INTEGER)) throw Error("Итог превышает точный диапазон");
    if (
      !allowOversizeRead &&
      new TextEncoder().encode(JSON.stringify(result)).length > BUDGET_MAX_BYTES
    ) {
      const error = new Error(BUDGET_SIZE_MESSAGE);
      error.code = "budget_too_large";
      throw error;
    }
    return result;
  },
};
