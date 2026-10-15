import assert from "node:assert/strict";
import vm from "./test-vm.mjs";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
const elements = new Map(),
  el = (selector) => {
    if (!elements.has(selector))
      elements.set(selector, {
        value: "",
        innerHTML: "",
        textContent: "",
        hidden: false,
        classList: { toggle() {}, contains: () => false },
        append() {},
      });
    return elements.get(selector);
  };
const store = new Map();
const context = vm.createContext({
  console,
  URL,
  Intl,
  structuredClone,
  crypto: webcrypto,
  setTimeout: () => 1,
  clearTimeout() {},
  window: {},
  document: { querySelector: el, querySelectorAll: () => [], getElementById: (s) => el("#" + s) },
  localStorage: {
    getItem: (k) => store.get(k) || null,
    setItem: (k, v) => store.set(k, v),
    removeItem: (k) => store.delete(k),
  },
  navigator: { onLine: true },
  fetch: async () => {
    throw Error("unused");
  },
});
vm.runInContext(readFileSync("public/ocr-parser.js", "utf8"), context);
context.FinanceOCR = context.window.FinanceOCR;
vm.runInContext(readFileSync("public/ocr-refine.js", "utf8"), context);
for (const file of [
  "data-model.js",
  "sync-core.js",
  "budget-core.js",
  "month-picker.js",
  "budget-ui.js",
  "sync.js",
  "file-vault.js",
  "pwa.js",
  "ui.js",
  "category-history.js",
  "accounts.js",
  "import-ui.js",
  "app.js",
])
  vm.runInContext(readFileSync("public/" + file, "utf8"), context);
const parser = context.FinanceOCR;
context.originalArchive = vm.runInContext("archiveImportedScreenshots", context);
const dated = parser.parse(
  {
    text: "4 октября, вс | 7 321,16 ₽\nOZON | 1 604 ₽\nОплата товаров и услуг\nКредитная СберКарта: 1 108,10 ₽\nДеливери | + 1 437 ₽\nВозврат, отмена операций\nКредитная СберКарта: 2 712,10 ₽\nСовместный счёт **1144 | 1 500 ₽\n→ Кредитная СберКарта **1787\nМежду своими\nКредитная СберКарта: 3 381,18 ₽",
    confidence: 95,
  },
  "2026",
);
assert.equal(dated.length, 3);
assert.ok(dated.every((o) => o.date === "2026-10-04"));
assert.deepEqual(
  Array.from(dated, (o) => o.type),
  ["expense", "refund", "transfer"],
);
assert.equal(dated[2].fromHint, "1144");
assert.equal(dated[2].toHint, "1787");
const mergedNumber = parser.parse({
  text: "Совместный счёт +> 1144 2 000 ₽\n→ Карта **1787\nМежду своими",
  confidence: 95,
});
assert.equal(mergedNumber[0].amount, 2000, "masked account digits must not become money");
assert.equal(mergedNumber[0].fromHint, "1144");
const card = parser.parse(
  { text: "27 июля, понедельник\nМагнит | -849 ₽\nСупермаркеты\nКарта **2264", confidence: 95 },
  "2026",
);
assert.equal(card[0].accountHint, "2264", "card label maps a masked card");
const incoming = parser.parse(
  { text: "27 июля\nПополнение | 61,97 ₽\nЗачисление\nСчёт **2264", confidence: 95 },
  "2026",
);
assert.equal(incoming[0].type, "income", "incoming bank label without plus");
const refund = parser.parse(
  { text: "27 июля\nМагазин | 200 ₽\nВозврат покупки\nКарта **2264", confidence: 95 },
  "2026",
);
assert.equal(refund[0].type, "refund", "refund label without plus");
const negative = parser.parse(
  { text: "27 июля\nМагазин | -200 ₽\nОтмена операций\nКарта **2264", confidence: 95 },
  "2026",
);
assert.equal(negative[0].type, "expense");
assert.equal(
  parser.parse({ text: "27 июл., пн | 849 ₽\nМагнит | 849 ₽", confidence: 95 }, "2026")[0].date,
  "2026-07-27",
  "abbreviated month",
);
const inline = parser.parse(
  { text: "27.07.2026 Магнит | -849 ₽\nСупермаркеты\nКарта **2264", confidence: 95 },
  "2026",
);
assert.equal(inline.length, 1, "inline transaction date must not suppress the operation");
assert.equal(inline[0].date, "2026-07-27");
assert.equal(inline[0].name, "Магнит");
assert.equal(
  parser.parse({ text: "Магнит | 1\u202f234,56 ₽", confidence: 95 })[0].amount,
  1234.56,
  "narrow spaces in money",
);
context.rows = card;
vm.runInContext(
  "db=emptyPersonalBudget();db.accounts=[{id:'my-card',name:'Моя карта',last4:'2264',type:'card',opening:10000}];db.accountAliases={2264:'stale'};draft=prepareImportDraft(rows);",
  context,
);
assert.equal(vm.runInContext("draft[0].account", context), "my-card");
assert.equal(vm.runInContext("draft[0].category", context), "Супермаркеты");
assert.equal(vm.runInContext("db.categories.includes('Супермаркеты')", context), false);
let archiveResolve;
context.delayedArchive = () => new Promise((resolve) => (archiveResolve = resolve));
vm.runInContext(
  "archiveImportedScreenshots=delayedArchive;askConfirm=async()=>true;ocrFiles=[]",
  context,
);
const first = vm.runInContext("importSave()", context),
  second = vm.runInContext("importSave()", context);
await second;
assert.equal(vm.runInContext("liveRecords('ops').length", context), 1, "double click imports once");
archiveResolve(true);
await first;
assert.equal(vm.runInContext("db.categories.includes('Супермаркеты')", context), true);
assert.equal(vm.runInContext("categoryHistoryRows('Супермаркеты').length", context), 1);
vm.runInContext(
  "db.ops.push({...db.ops[0],id:'refund-example',amountMinor:4900,type:'refund'});go('Категории')",
  context,
);
assert.ok(
  el("#content").innerHTML.includes(vm.runInContext("money(80000)", context)),
  "category tile deducts refunds",
);
const raw = JSON.parse(store.get("finance-prototype-v1"));
assert.equal(raw.accounts[0].last4, "2264");
assert.equal(raw.ops[0].category, "Супермаркеты");
console.log(
  "PASS: dates and day totals, internal transfer, masked card routing, unsigned income/refund, abbreviated and inline dates, double-click import, bank category creation/history and refund totals",
);

vm.runInContext(
  'archiveImportedScreenshots=originalArchive;vaultWrite=async()=>{throw Error("storage full")}',
  context,
);
context.exampleFiles = [
  {
    name: "example.png",
    size: 123,
    lastModified: 1,
    arrayBuffer: async () => new Uint8Array([1]).buffer,
  },
];
assert.equal(
  await vm.runInContext(
    'archiveImportedScreenshots(exampleFiles,[{sourceId:"example.png:123:1"}])',
    context,
  ),
  false,
);
assert.equal(vm.runInContext("pendingScreenshotArchives.length", context), 1);
context.savedFiles = [];
vm.runInContext("vaultWrite=async record=>{savedFiles.push(record)}", context);
assert.equal(await vm.runInContext("retryScreenshotArchives()", context), true);
assert.equal(vm.runInContext("pendingScreenshotArchives.length", context), 0);
assert.equal(context.savedFiles[0].owner, "guest");
assert.equal(
  vm.runInContext("liveRecords('ops').length", context),
  2,
  "retrying originals must not re-import transactions",
);
console.log(
  "PASS: failed screenshot storage retains originals for retry without adding duplicate operations",
);

const candidate = {
  text: "14372",
  confidence: 95,
  bbox: { x0: 561, y0: 1323, x1: 664, y1: 1346 },
  words: [
    {
      symbols: [
        ["1", 561, 575],
        ["4", 585, 602],
        ["3", 604, 619],
        ["7", 622, 638],
        ["2", 648, 664],
      ].map(([text, x0, x1]) => ({ text, bbox: { x0, x1, y0: 1323, y1: 1346 } })),
    },
  ],
};
assert.equal(parser.currencyGlyphCandidates({ lines: [candidate] }, 709, 1536).length, 1);
const realDigit = structuredClone(candidate);
realDigit.words[0].symbols.at(-1).bbox.x0 = 640;
assert.equal(
  parser.currencyGlyphCandidates({ lines: [realDigit] }, 709, 1536).length,
  0,
  "ordinary final digits are never trimmed",
);
context.glyphData = { lines: [candidate] };
context.mockWorker = {
  setParameters: async () => {},
  recognize: async () => ({ data: { text: "p", confidence: 73 } }),
};
await vm.runInContext("refineCurrencyGlyphs(mockWorker,null,glyphData,709,1536)", context);
assert.equal(candidate.text, "1437 p");
console.log(
  "PASS: only a separated currency glyph is re-read from pixels; a normal final digit is not removed",
);
