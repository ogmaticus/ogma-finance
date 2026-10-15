import { BudgetSchema } from "../public/budget-schema.js";
export function budgetOfBytes(target) {
  const data = BudgetSchema.parse({
    accounts: [{ id: "card", name: "Карта", opening: 0 }],
    ops: Array.from({ length: 1800 }, (_, i) => ({
      id: `sized-${i}`,
      name: "Покупка",
      amount: 1,
      type: "expense",
      date: "2026-10-01",
      account: "card",
      category: "Продукты",
      note: "",
    })),
    goals: [],
    limits: {},
    categories: ["Продукты"],
    merchantRules: [],
    accountAliases: {},
    budgetsByMonth: {},
  });
  let remaining = target - new TextEncoder().encode(JSON.stringify(data)).length;
  for (const op of data.ops) {
    const length = Math.min(1000, remaining);
    op.note = "x".repeat(length);
    remaining -= length;
    if (!remaining) break;
  }
  if (remaining) throw Error("fixture cannot reach requested size");
  return data;
}
