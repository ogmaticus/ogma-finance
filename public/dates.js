export function localDate(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
export function defaultOperationDate(month, now = new Date()) {
  if (month === localDate(now).slice(0, 7)) return localDate(now);
  const [year, number] = month.split("-").map(Number);
  const date = new Date(0);
  date.setFullYear(year, number, 0);
  return localDate(date);
}
export function operationDateOrder(a, b) {
  return ((b.date || "") + "T" + (b.time || "00:00")).localeCompare(
    (a.date || "") + "T" + (a.time || "00:00"),
  );
}
