// Older installed shells can keep reading while the user applies the new release.
export function legacyMoneyView(input) {
  const data = JSON.parse(JSON.stringify(input));
  if (data.schemaVersion !== 3) return data;
  for (const [collection, fields] of [
    ["ops", ["amount", "originalAmount"]],
    ["accounts", ["opening"]],
    ["goals", ["target", "saved"]],
  ])
    for (const record of data[collection])
      for (const field of fields)
        if (record[field + "Minor"] !== undefined) {
          record[field] = record[field + "Minor"] / 100;
          delete record[field + "Minor"];
        }
  for (const plan of [data.limits, ...Object.values(data.budgetsByMonth)])
    for (const key of Object.keys(plan)) plan[key] /= 100;
  data.schemaVersion = 2;
  return data;
}
