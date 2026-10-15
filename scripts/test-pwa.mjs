import assert from "node:assert/strict";
import vm from "./test-vm.mjs";
import { readFileSync, existsSync } from "node:fs";
const manifest = JSON.parse(readFileSync("public/manifest.webmanifest", "utf8"));
assert.equal(manifest.display, "standalone");
assert.ok(manifest.icons.some((i) => i.sizes === "192x192"));
assert.ok(manifest.icons.some((i) => i.sizes === "512x512"));
for (const icon of manifest.icons) assert.ok(existsSync("public" + icon.src));
const origin = "https://finance.example",
  cacheStore = new Map(),
  listeners = {};
let online = true,
  skips = 0,
  claimed = 0;
const key = (request) => new URL(typeof request === "string" ? request : request.url, origin).href;
const network = async (request) => {
  if (!online) throw Error("offline");
  const route = new URL(key(request)).pathname;
  const path = route === "/finance" ? "/app.html" : route;
  assert.ok(existsSync("public" + path), "precache file " + path);
  return new Response(readFileSync("public" + path));
};
const caches = {
  open: async (name) => {
    if (!cacheStore.has(name)) cacheStore.set(name, new Map());
    const entries = cacheStore.get(name);
    return {
      put: async (r, response) => entries.set(key(r), response),
      addAll: async (paths) => {
        for (const p of paths) entries.set(key(p), await network(p));
      },
      match: async (r) => entries.get(key(r))?.clone(),
    };
  },
  keys: async () => [...cacheStore.keys()],
  delete: async (name) => cacheStore.delete(name),
  match: async (request) => {
    for (const entries of cacheStore.values()) {
      const response = entries.get(key(request));
      if (response) return response.clone();
    }
  },
};
const self = {
  location: { origin },
  clients: {
    claim: async () => {
      claimed++;
    },
  },
  skipWaiting: () => {
    skips++;
  },
  addEventListener: (name, cb) => (listeners[name] = cb),
};
const context = vm.createContext({ self, caches, fetch: network, URL, Set, Promise, Request });
vm.runInContext(readFileSync("public/sw.js", "utf8"), context);
let work;
listeners.install({ waitUntil: (p) => (work = p) });
await work;
assert.equal(skips, 0, "new release must wait for approval");
const current = cacheStore.get("finance-shell-31");
assert.ok(current);
assert.equal(
  [...current.keys()].some((k) => k.includes("/api/")),
  false,
);
const html = readFileSync("public/app.html", "utf8");
for (const path of [...html.matchAll(/(?:src|href)="((?:[^"/]+\.(?:js|css))(?:\?v=\d+)?)"/g)].map(
  (m) => m[1],
))
  assert.ok(current.has(key("/" + path)), path + " is precached");
online = false;
function respond(url, mode = "cors", method = "GET") {
  let response;
  listeners.fetch({
    request: { url: new URL(url, origin).href, mode, method },
    respondWith: (p) => (response = p),
  });
  return response;
}
assert.ok(
  (await (await respond("/app.html?source=installed", "navigate")).text()).includes("app.js?v=31"),
);
assert.ok((await (await respond("/sync.js?v=31")).text()).includes("reconnectCloud"));
assert.equal(
  [...current.keys()].some((k) => k.includes("/ocr/")),
  false,
  "install never downloads heavy OCR",
);
await assert.rejects(respond("/ocr/rus.traineddata.gz"), /offline/);
online = true;
let ocrResult;
listeners.message({
  data: { type: "PREPARE_OCR" },
  ports: [{ postMessage: (value) => (ocrResult = value) }],
  waitUntil: (p) => (work = p),
});
await work;
assert.equal(ocrResult.ready, true);
online = false;
assert.equal((await respond("/ocr/rus.traineddata.gz")).status, 200);
assert.ok(cacheStore.get("finance-ocr-1").size >= 6);
for (const path of [
  "/api/session",
  "/api/budget",
  "/api/files",
  "/api/files/private-id",
  "/signin-with-chatgpt",
  "/signout-with-chatgpt",
  "/callback",
  "/secret",
])
  assert.equal(respond(path), undefined, path + " must stay network-only");
assert.equal(respond("/app.html", "cors", "POST"), undefined);
assert.equal(respond("https://outside.example/app.html"), undefined);
for (const name of [
  "finance-shell-10",
  "finance-shell-11",
  "finance-shell-12",
  "finance-shell-13",
  "finance-shell-14",
  "finance-shell-15",
  "finance-shell-16",
  "finance-shell-17",
  "finance-shell-18",
  "finance-shell-29",
  "other-app",
])
  await caches.open(name);
listeners.activate({ waitUntil: (p) => (work = p) });
await work;
assert.equal(claimed, 1);
assert.ok(cacheStore.has("finance-shell-29"));
assert.equal(cacheStore.has("finance-shell-11"), false);
assert.ok(cacheStore.has("other-app"));
listeners.message({ data: { type: "APPLY_UPDATE" } });
assert.equal(skips, 1);
console.log(
  "PASS: offline shell and OCR assets, private routes never cached, updates wait, previous app shell retained, manifest assets exist",
);
const pwaContext = vm.createContext({
  window: {},
  localStorage: { getItem: () => null, setItem: () => {} },
  document: { querySelector: () => null, getElementById: () => ({ textContent: "" }) },
  budgetStorageKey: "finance-prototype-v1",
  cloudSession: null,
  ocrBusy: true,
  draft: [],
  ocrFiles: [],
  cloudBusy: false,
  vaultUploading: false,
});
vm.runInContext(readFileSync("public/pwa.js", "utf8"), pwaContext);
let applied = 0;
pwaContext.postMessage = () => {
  applied++;
};
vm.runInContext("pwaRegistration={waiting:{postMessage}}", pwaContext);
await vm.runInContext("applyFinanceUpdate()", pwaContext);
assert.equal(applied, 0, "never interrupt OCR");
pwaContext.ocrBusy = false;
pwaContext.draft = [{ name: "unsaved" }];
await vm.runInContext("applyFinanceUpdate()", pwaContext);
assert.equal(applied, 0, "never lose draft");
pwaContext.draft = [];
await vm.runInContext("applyFinanceUpdate()", pwaContext);
assert.equal(applied, 1);
console.log("PASS: updating cannot interrupt recognition or discard an import draft");

pwaContext.pendingScreenshotArchives = [{ files: ["unsaved"] }];
await vm.runInContext("applyFinanceUpdate()", pwaContext);
assert.equal(applied, 1, "update must not discard unarchived originals");

pwaContext.pendingScreenshotArchives = [];
pwaContext.backupBusy = true;
await vm.runInContext("applyFinanceUpdate()", pwaContext);
assert.equal(applied, 1, "update cannot interrupt a backup");
