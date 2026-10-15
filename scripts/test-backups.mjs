import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import vm from "./test-vm.mjs";
import { webcrypto } from "node:crypto";
const c = vm.createContext({
  Blob,
  FormData,
  TextEncoder,
  TextDecoder,
  crypto: webcrypto,
  console,
});
for (const f of [
  "data-model.js",
  "sync-core.js",
  "budget-core.js",
  "backup-zip.js",
  "backup-core.js",
])
  vm.runInContext(readFileSync("public/" + f, "utf8"), c);
const Zip = vm.runInContext("FinanceZip", c),
  Backup = vm.runInContext("FinanceBackup", c);
assert.equal(await Zip.crc32(new Blob(["123456789"])), 0xcbf43926);
const png = new Blob(
  [
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4oQAAAAASUVORK5CYII=",
      "base64",
    ),
  ],
  { type: "image/png" },
);
const budget = {
  accounts: [{ id: "card", name: "Карта", last4: "2264", opening: 10000 }],
  ops: [
    {
      id: "purchase",
      name: "Покупка",
      amount: 849,
      type: "expense",
      date: "2026-07-27",
      account: "card",
      category: "Супермаркеты",
      sourceId: "original.png:68:1",
      screenshotId: "alice-file",
      customData: { preserve: true },
    },
    {
      id: "refund",
      name: "Возврат",
      amount: 49,
      type: "refund",
      date: "2026-07-28",
      account: "card",
      category: "Супермаркеты",
      sourceId: "same-image",
    },
  ],
  goals: [{ name: "Подушка", saved: 55, target: 1000, date: "2027-01-01" }],
  limits: { Супермаркеты: 2000 },
  categories: ["Супермаркеты"],
  merchantRules: [{ key: "магазин", category: "Супермаркеты" }],
  accountAliases: { 2264: "card" },
  futureField: { unknown: "preserved" },
};
const legacyZip = await Zip.build([
  {
    name: "manifest.json",
    blob: new Blob([
      JSON.stringify({ format: "finance-full-backup", version: 1, images: [], missingImages: [] }),
    ]),
  },
  { name: "budget.json", blob: new Blob([JSON.stringify(budget)]) },
]);
const legacyRead = await Backup.read(legacyZip);
assert.equal(legacyRead.data.schemaVersion, 3);
assert.equal(legacyRead.data.ops[0].amountMinor, 84900);
assert.ok(legacyRead.data.goals[0].id);
assert.equal(legacyRead.data.ops[0].customData, undefined);
console.log(
  "PASS: schema-1 ZIP profile from v1.6 migrates without losing amounts, goals or allowed fields",
);
const largeCopy = await Backup.create(
  {
    ...budget,
    ops: Array.from({ length: 2200 }, (_, i) => ({
      ...budget.ops[0],
      id: "large-" + i,
      note: "x".repeat(1000),
    })),
  },
  [],
);
const largeZip = await Zip.build(largeCopy.entries);
await assert.rejects(() => Backup.read(largeZip), /1 900 000|предел хранения/);
console.log(
  "PASS: oversize legacy documents remain exportable; restore rejects them without replacing active data",
);
const images = [
  { blob: png, name: "Банк.png", sourceIds: ["original.png:68:1"], screenshotIds: ["alice-file"] },
  { blob: png, name: "Тот же.png", sourceIds: ["same-image"], screenshotIds: [] },
];
const copy = await Backup.create(budget, images);
assert.equal(copy.manifest.images.length, 1, "identical bytes kept once");
assert.equal(copy.manifest.missingImages.length, 0);
const zip = await Zip.build(copy.entries);
const restored = await Backup.read(zip);
assert.deepEqual(
  JSON.parse(JSON.stringify(restored.data)),
  JSON.parse(
    JSON.stringify(vm.runInContext("BudgetSchema.parse(budget)", Object.assign(c, { budget }))),
  ),
);
assert.equal(restored.images.length, 1);
assert.deepEqual(
  new Uint8Array(await restored.images[0].blob.arrayBuffer()),
  new Uint8Array(await png.arrayBuffer()),
);
restored.images[0].cloudFileId = "bob-new-file";
const remapped = Backup.remap(restored.data, restored.images);
assert.equal(remapped.ops[0].screenshotId, "bob-new-file");
assert.equal(remapped.ops[1].screenshotId, "bob-new-file");
assert.equal(remapped.ops[0].amountMinor, 84900);
assert.equal(remapped.futureField, undefined);
assert.equal(remapped.ops[0].customData, undefined);
delete restored.images[0].cloudFileId;
const guest = Backup.remap(restored.data, restored.images);
assert.equal(guest.ops[0].screenshotId, undefined);
assert.equal(guest.ops[0].localScreenshot, true);
const missing = await Backup.create(budget, []);
assert.equal(missing.manifest.missingImages.length, 2);
const unavailable = Backup.remap(budget, []);
assert.equal(unavailable.ops[0].screenshotUnavailable, true);
assert.equal(unavailable.ops[0].screenshotId, undefined);
const opened = await Zip.open(zip),
  entry = opened.entries.get(copy.manifest.images[0].path),
  bytes = new Uint8Array(await zip.arrayBuffer());
bytes[entry.start + 15] ^= 1;
await assert.rejects(Backup.read(new Blob([bytes])), /повреждён/);
await assert.rejects(Zip.build([{ name: "../secret", blob: png }]), /Некорректный/);
await assert.rejects(
  Zip.build([
    { name: "budget.json", blob: png },
    { name: "budget.json", blob: png },
  ]),
  /Некорректный/,
);
assert.throws(
  () => Backup.validateBudget({ ...budget, ops: [{ ...budget.ops[0], date: "2026-02-30" }] }),
  /Некорректн/,
);
writeFileSync(
  join(tmpdir(), "finance-backup-roundtrip-test.zip"),
  Buffer.from(await zip.arrayBuffer()),
);
console.log(
  "PASS: exact budget/image round-trip, identical-image deduplication, remapping to another account, offline links, corrupt archive rejected, missing images declared, path and duplicate-name rejection",
);
// Exercise the actual UI transaction: failures never replace the currently open budget.
const store = new Map(),
  vault = [];
let puts = 0,
  mode = "ok",
  allowed = true;
const previous = {
  accounts: [{ id: "old", name: "Прежняя карта", opening: 100 }],
  ops: [],
  goals: [],
  limits: {},
  marker: "previous",
};
const elements = new Map(),
  el = (k) => {
    if (!elements.has(k))
      elements.set(k, {
        textContent: "",
        hidden: true,
        inert: false,
        dataset: {},
        open: false,
        attributes: {},
        listeners: {},
        setAttribute(name, value) {
          this.attributes[name] = value;
        },
        addEventListener(name, callback) {
          this.listeners[name] = callback;
        },
        showModal() {
          this.open = true;
          if (this.dataset.phase === "confirm")
            queueMicrotask(() => {
              if (allowed) el("backupform").onsubmit({ preventDefault() {} });
              else this.close();
            });
        },
        close() {
          this.open = false;
          this.onclose?.();
        },
      });
    return elements.get(k);
  };
Object.assign(c, {
  db: structuredClone(previous),
  cloudSession: { user: { id: "bob" } },
  cloudScreenshotsEnabled: () => true,
  cloudIdentityVerified: true,
  cloudBusy: false,
  cloudDirty: false,
  cloudConflict: null,
  cloudRevision: 7,
  cloudTimer: null,
  cloudState: "synced",
  cloudError: "",
  vaultUploading: false,
  vaultArchiving: false,
  pendingScreenshotArchives: [],
  ocrBusy: false,
  importSaving: false,
  document: { getElementById: el, querySelector: el, createElement: () => ({ click() {} }) },
  localStorage: {
    getItem: (k) => store.get(k) || null,
    setItem: (k, v) => store.set(k, String(v)),
  },
  clearTimeout() {},
  setTimeout: () => 1,
  animateDialogClose: (dialog) => dialog.close(),
  askConfirm: async () => allowed,
  render() {},
  renderProfile() {},
  hydrateBudget: (data) => (c.db = structuredClone(data)),
  persistBudget: () => {},
  syncBudget: async () => {},
  vaultWriteBatch: async (rows) => {
    if (mode === "storage") throw Error("disk full");
    vault.push(...rows);
  },
  cloudFetch: async (path, options) => {
    if (path === "/api/files") return { id: "bob-image" };
    if (path === "/api/budget") {
      puts++;
      if (mode === "conflict") {
        const error = Error("Бюджет изменён");
        error.status = 409;
        throw error;
      }
      return { revision: 8, updatedAt: "2026-10-14T00:00:00Z" };
    }
    throw Error("unexpected");
  },
  cloudCache() {},
});
vm.runInContext(readFileSync("public/backup-ui.js", "utf8"), c);
c.archive = zip;
await vm.runInContext("restoreFullBackup(archive)", c);
assert.equal(c.db.ops[0].screenshotId, "bob-image");
assert.equal(c.db.futureField, undefined);
assert.equal(JSON.parse(store.get("finance-before-restore-bob")).marker, "previous");
assert.equal(vault[0].owner, "bob");
assert.equal(vault[0].archiveStandalone, true);
assert.equal(puts, 1);
assert.ok(vm.runInContext("backupStatus", c).startsWith("Восстановлено:"));
assert.equal(el("backupdialog").open, true);
assert.equal(el("backupdialog").dataset.phase, "result");
assert.equal(el("backuptitle").textContent, "Бюджет восстановлен");
assert.ok(el("backupmessage").textContent.includes("2 операций"));
assert.equal(el("backupcancel").disabled, false);
for (const failure of ["storage", "conflict"]) {
  mode = failure;
  c.db = structuredClone(previous);
  await vm.runInContext("restoreFullBackup(archive)", c);
  assert.equal(c.db.marker, "previous", failure + " preserves budget");
  assert.equal(el("backupdialog").dataset.phase, "result");
  assert.equal(el("backuptitle").textContent, "Не удалось восстановить");
  assert.ok(el("backupmessage").textContent.startsWith("Восстановление остановлено:"));
}
mode = "ok";
allowed = false;
c.db = structuredClone(previous);
const before = puts;
await vm.runInContext("restoreFullBackup(archive)", c);
assert.equal(puts, before);
assert.equal(c.db.marker, "previous");
allowed = true;
c.archive = new Blob([bytes]);
await vm.runInContext("restoreFullBackup(archive)", c);
assert.equal(c.db.marker, "previous");
assert.equal(puts, before);
console.log(
  "PASS: actual restore preserves previous budget and images; cancellation, CRC failure, storage failure and revision conflict cannot replace active data",
);
// Export must visit every server page and never include another local user's images.
let pageCalls = 0;
const pages = [
  Array.from({ length: 100 }, (_, i) => ({
    id: "bob-" + i,
    name: "bank.png",
    source_id: "source-" + i,
    created_at: "2026-10-14T00:00:00Z",
  })),
  Array.from({ length: 6 }, (_, i) => ({
    id: "bob-" + (100 + i),
    name: "bank.png",
    source_id: "source-" + (100 + i),
    created_at: "2026-10-13T00:00:00Z",
  })),
];
Object.assign(c, {
  AbortController,
  vaultAll: async () => [
    {
      owner: "alice",
      sourceId: "private-alice",
      blob: png,
      name: "private.png",
      cloudFileId: "alice-secret",
    },
  ],
  cloudFetch: async (path) => {
    if (path === "/api/files") {
      pageCalls++;
      return { files: pages[0], nextCursor: "second" };
    }
    if (path === "/api/files?cursor=second") {
      pageCalls++;
      return { files: pages[1], nextCursor: null };
    }
    throw Error("unexpected page");
  },
  fetch: async (url, options) => {
    assert.equal(options.headers["X-Finance-Owner"], "bob");
    assert.ok(!url.includes("alice"));
    return { ok: true, blob: async () => png };
  },
});
const collected = await vm.runInContext("collectBackupImages('bob')", c);
assert.equal(collected.length, 106);
assert.equal(pageCalls, 2);
assert.equal(
  collected.some((r) => r.screenshotIds.includes("alice-secret")),
  false,
);
console.log(
  "PASS: export includes more than 100 server originals and excludes another user’s local files",
);

// With cloud copies switched off (the default) an account restore keeps images on the device only.
{
  let uploads = 0;
  c.cloudScreenshotsEnabled = () => false;
  c.cloudFetch = async (path) => {
    if (path === "/api/files") uploads++;
    return { revision: 9, updatedAt: "2026-10-14T00:00:00Z" };
  };
  c.archive = zip;
  c.db = structuredClone(previous);
  await vm.runInContext("restoreFullBackup(archive)", c);
  assert.equal(uploads, 0);
  assert.equal(c.db.ops[0].screenshotId, undefined);
  assert.ok(c.db.ops[0].sourceId.startsWith("backup-"));
  c.cloudScreenshotsEnabled = () => true;
  console.log("PASS: account restore keeps screenshots local unless cloud copies are enabled");
}

// A server-confirmed restore remains a success even when the optional device cache is full.
c.cloudFetch = async (path) =>
  path === "/api/files" ? { id: "bob-image" } : { revision: 9, updatedAt: "2026-10-14T00:00:00Z" };
c.archive = zip;
c.cloudCache = () => {
  throw Error("cache quota");
};
c.forgetOfflineAccess = () => {};
c.db = structuredClone(previous);
await vm.runInContext("restoreFullBackup(archive)", c);
assert.equal(c.db.ops.length, 2);
assert.ok(vm.runInContext("backupStatus", c).startsWith("Восстановлено:"));
assert.ok(c.cloudError.includes("копия устройства"));

// The confirmation stays open while working; cancellation cannot hide a running restore.
allowed = true;
const dialog = el("backupdialog");
const confirming = vm.runInContext("confirmBackupRestore('Тест восстановления')", c);
await confirming;
assert.equal(dialog.open, true);
assert.equal(dialog.dataset.phase, "working");
assert.equal(el("backupcancel").disabled, true);
let prevented = false,
  stopped = false;
dialog.listeners.cancel({
  preventDefault() {
    prevented = true;
  },
  stopImmediatePropagation() {
    stopped = true;
  },
});
assert.equal(prevented, true);
assert.equal(stopped, true);
vm.runInContext("setBackupStatus('Восстанавливаем скриншоты: 1 из 2')", c);
assert.equal(el("backupmessage").textContent, "Восстанавливаем скриншоты: 1 из 2");
vm.runInContext("finishBackupRestore(true,'Готово')", c);
el("backupcancel").onclick();
assert.equal(dialog.open, false);
console.log(
  "PASS: one restore dialog shows confirmation, live progress, visible success/errors and blocks dismissing an unfinished restore",
);
// A backup with no images must not require IndexedDB at all.
const emptyVault = vm.createContext({
  document: { getElementById: () => null },
  indexedDB: {
    open() {
      throw Error("unavailable");
    },
  },
});
vm.runInContext(readFileSync("public/file-vault.js", "utf8"), emptyVault);
await vm.runInContext("vaultWriteBatch([])", emptyVault);
console.log("PASS: image-free backups do not need image storage");
