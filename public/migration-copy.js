import { state } from "./state.js?v=34";
export function preserveLegacyBudget(data) {
  if (!data || data.schemaVersion >= 3) return;
  const owner = state.cloudSession?.user?.id || "guest";
  if (owner === "guest" && !localStorage.getItem("finance-prototype-v1")) return;
  const key = "finance-before-schema-" + owner;
  if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(data));
}
export function downloadMigrationCopy() {
  const owner = state.cloudSession?.user?.id || "guest",
    raw = localStorage.getItem("finance-before-schema-" + owner);
  if (!raw) return;
  const url = URL.createObjectURL(new Blob([raw], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "finance-before-migration.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
