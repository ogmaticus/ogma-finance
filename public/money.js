// Money is stored and calculated as safe integer kopecks. Rubles are an input/output format.
export const Money = {
  toMinor(value) {
    if (typeof value === "number" && !Number.isFinite(value)) throw Error("Некорректная сумма");
    let text = String(value).trim().replace(/\s/g, "").replace(",", ".");
    if (/e/i.test(text) && typeof value === "number") text = value.toFixed(10);
    const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
    if (!match) throw Error("Введите сумму числом");
    const fraction = (match[3] || "").padEnd(3, "0");
    let minor = BigInt(match[2]) * 100n + BigInt(fraction.slice(0, 2));
    if (+fraction[2] >= 5) minor++;
    if (match[1]) minor = -minor;
    const result = Number(minor);
    if (!Number.isSafeInteger(result)) throw Error("Сумма превышает точный диапазон");
    return result;
  },
  add(...values) {
    const result = values.reduce((sum, value) => sum + value, 0);
    if (!Number.isSafeInteger(result)) throw Error("Итог превышает точный диапазон");
    return result;
  },
  input(value) {
    const minor = BigInt(value),
      absolute = minor < 0n ? -minor : minor;
    return `${minor < 0n ? "-" : ""}${absolute / 100n}.${String(absolute % 100n).padStart(2, "0")}`;
  },
  format(value) {
    const text = Money.input(value),
      [whole, fraction] = text.split(".");
    return (
      (value < 0 && BigInt(whole) === 0n ? "-" : "") +
      new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(BigInt(whole)) +
      "," +
      fraction +
      "\u00a0₽"
    );
  },
  migrate(input) {
    const data = JSON.parse(JSON.stringify(input));
    const old = (data.schemaVersion || 1) < 3;
    for (const [collection, fields] of [
      ["ops", ["amount", "originalAmount"]],
      ["accounts", ["opening"]],
      ["goals", ["target", "saved"]],
    ])
      for (const record of data[collection] || [])
        for (const field of fields) {
          if (record[field] !== undefined) {
            record[field + "Minor"] = Money.toMinor(record[field]);
            delete record[field];
          }
        }
    if (old) {
      for (const map of [data.limits || {}, ...Object.values(data.budgetsByMonth || {})])
        for (const key of Object.keys(map)) map[key] = Money.toMinor(map[key]);
    }
    data.schemaVersion = 3;
    return data;
  },
};
