import { FinanceData } from "./data-model.js?v=33";
export const FinanceBudget = (() => {
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const forbidden = (key) => ["__proto__", "constructor", "prototype"].includes(key);
  const validMonth = (month) => typeof month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
  const amount = (value) =>
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= Number.MAX_SAFE_INTEGER;
  const cents = (value) => value;
  function validatePlans(plans) {
    if (plans === undefined) return;
    if (
      !plans ||
      typeof plans !== "object" ||
      Array.isArray(plans) ||
      Object.keys(plans).length > 1200
    )
      throw Error("Некорректные планы по месяцам");
    for (const [month, limits] of Object.entries(plans)) {
      if (!validMonth(month) || !limits || typeof limits !== "object" || Array.isArray(limits))
        throw Error("Некорректный месяц бюджета");
      for (const [category, value] of Object.entries(limits))
        if (forbidden(category) || !amount(value)) throw Error("Некорректный месячный лимит");
    }
  }
  function plan(data, month) {
    data = FinanceData.normalize(data);
    if (!validMonth(month)) throw Error("Выберите месяц бюджета");
    return own(data.budgetsByMonth || {}, month) ? data.budgetsByMonth[month] : data.limits || {};
  }
  function setLimit(data, month, category, value) {
    data = FinanceData.normalize(data);
    if (!category || forbidden(category) || (value !== null && !amount(value)))
      throw Error("Некорректный лимит");
    const limits = { ...plan(data, month) };
    if (value === null) delete limits[category];
    else limits[category] = value;
    return { ...data, budgetsByMonth: { ...data.budgetsByMonth, [month]: limits } };
  }
  function previousMonth(month) {
    if (!validMonth(month)) throw Error("Выберите месяц бюджета");
    const [year, number] = month.split("-").map(Number);
    if (number === 1 && year === 0) throw Error("Предыдущий месяц недоступен");
    return `${String(number === 1 ? year - 1 : year).padStart(4, "0")}-${String(number === 1 ? 12 : number - 1).padStart(2, "0")}`;
  }
  function copyPlan(data, from, to) {
    data = FinanceData.normalize(data);
    return { ...data, budgetsByMonth: { ...data.budgetsByMonth, [to]: { ...plan(data, from) } } };
  }
  function report(data, month, categories = []) {
    data = FinanceData.normalize(data);
    const limits = plan(data, month),
      spending = new Map();
    for (const operation of FinanceData.live(data.ops)) {
      if (!operation.date.startsWith(month) || !["expense", "refund"].includes(operation.type))
        continue;
      const value = operation.amountMinor * (operation.type === "refund" ? -1 : 1);
      spending.set(operation.category, (spending.get(operation.category) || 0) + value);
    }
    const names = [
      ...new Set([
        ...categories.filter((c) => !["Зарплата", "Перевод"].includes(c)),
        ...Object.keys(limits),
        ...spending.keys(),
      ]),
    ];
    const rows = names.map((category) => {
      const hasLimit = own(limits, category),
        limit = hasLimit ? limits[category] : null,
        spent = spending.get(category) || 0;
      const remaining = hasLimit ? limit - spent : null;
      const percent = hasLimit
        ? limit === 0
          ? spent > 0
            ? 100
            : 0
          : Math.max(0, (spent / limit) * 100)
        : 0;
      const status = !hasLimit
        ? "unplanned"
        : remaining < 0
          ? "over"
          : percent >= 80 && spent > 0
            ? "near"
            : "ok";
      return { category, hasLimit, limit, spent, remaining, percent, status };
    });
    const sum = (items, field) => items.reduce((total, row) => total + cents(row[field]), 0);
    const planned = rows.filter((row) => row.hasLimit),
      unplanned = rows.filter((row) => !row.hasLimit && row.spent !== 0);
    const totalLimit = sum(planned, "limit"),
      plannedSpent = sum(planned, "spent");
    return {
      rows,
      totalLimit,
      plannedSpent,
      remaining: totalLimit - plannedSpent,
      totalSpent: sum(rows, "spent"),
      unplannedSpent: sum(unplanned, "spent"),
      unplanned,
      over: rows.filter((row) => row.status === "over"),
      near: rows.filter((row) => row.status === "near"),
      explicit: own(data.budgetsByMonth || {}, month),
    };
  }
  return { validMonth, validatePlans, plan, setLimit, previousMonth, copyPlan, report };
})();
