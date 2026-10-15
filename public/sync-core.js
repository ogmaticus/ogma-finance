import { BudgetSchema } from "./budget-schema.js?v=31";
import { state } from "./state.js?v=31";
import { FinanceData } from "./data-model.js?v=31";
export const budgetStorageKey = "finance-prototype-v1";
export function liveRecords(type) {
  return FinanceData.live(state.db[type]);
}
export function rememberBudgetBaseline(data) {
  state.budgetBaseline = JSON.parse(JSON.stringify(data));
}
export function emptyPersonalBudget() {
  return FinanceData.normalize({
    accounts: [],
    ops: [],
    goals: [],
    limits: {},
    categories: [],
    merchantRules: [],
    accountAliases: {},
  });
}
export function isBudget(value) {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    Array.isArray(value.accounts) &&
    Array.isArray(value.ops) &&
    Array.isArray(value.goals) &&
    value.limits &&
    typeof value.limits === "object"
  );
}
export function parseBudget(value) {
  const data = typeof value === "string" ? JSON.parse(value) : value;
  if (!isBudget(data)) throw Error("Некорректный файл бюджета");
  // Existing local budgets remain readable and exportable after a storage-limit update.
  return BudgetSchema.parse(data, { allowOversizeRead: true });
}
export function mergeBudgets(remote, local) {
  return FinanceData.merge(remote, local);
}
export function cacheBudgetKey(userId) {
  return "finance-user-" + encodeURIComponent(userId);
}
