// Generated public/sw.js uses versions from release.json.
const RELEASE = "31",
  OCR_VERSION = "1";
const CACHE = "finance-shell-" + RELEASE,
  OCR_CACHE = "finance-ocr-" + OCR_VERSION;
const CORE = [
  "/finance",
  "/manifest.webmanifest",
  "/manifest-light.webmanifest",
  "/manifest-dark.webmanifest",
  "/brand.svg",
  "/icons/icon-180.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/maskable-512.png",
  "/base.css?v=31",
  "/design-tokens.css?v=31",
  "/theme.css?v=31",
  "/appearance.css?v=31",
  "/shell.css?v=31",
  "/accounts.js?v=31",
  "/analytics-ui.js?v=31",
  "/app.js?v=31",
  "/appearance-init.js?v=31",
  "/appearance.js?v=31",
  "/backup-core.js?v=31",
  "/backup-ui.js?v=31",
  "/backup-zip.js?v=31",
  "/budget-core.js?v=31",
  "/budget-schema.js?v=31",
  "/budget-ui.js?v=31",
  "/category-history.js?v=31",
  "/data-model.js?v=31",
  "/dates.js?v=31",
  "/events.js?v=31",
  "/file-vault.js?v=31",
  "/format.js?v=31",
  "/icons.js?v=31",
  "/import-ui.js?v=31",
  "/legacy-money.js?v=31",
  "/migration-copy.js?v=31",
  "/money.js?v=31",
  "/month-picker.js?v=31",
  "/ocr-parser.js?v=31",
  "/ocr-refine.js?v=31",
  "/operation-form.js?v=31",
  "/operations-ui.js?v=31",
  "/privacy-ui.js?v=31",
  "/pwa.js?v=31",
  "/record-actions.js?v=31",
  "/release-info.js?v=31",
  "/screenshot-source.js?v=31",
  "/shell-ui.js?v=31",
  "/state.js?v=31",
  "/sync-core.js?v=31",
  "/sync.js?v=31",
  "/ui.js?v=31",
];
const OCR = [
  "tesseract.min.js",
  "worker.min.js",
  "tesseract-core-lstm.wasm.js",
  "tesseract-core-lstm.wasm",
  "rus.traineddata.gz",
  "eng.traineddata.gz",
].map((name) => "/ocr/" + name);
const PUBLIC_PATHS = new Set(CORE.map((path) => new URL(path, self.location.origin).pathname));
async function ocrResource(request) {
  const cache = await caches.open(OCR_CACHE);
  let response = await cache.match(request);
  if (response) return response;
  response = (await caches.match(request)) || (await fetch(request));
  if (response.ok) await cache.put(request, response.clone());
  return response;
}
self.addEventListener("install", (event) =>
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(CORE))),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      const names = (await caches.keys())
        .filter((name) => name.startsWith("finance-shell-") && name !== CACHE)
        .sort((a, b) => Number(b.split("-").at(-1)) - Number(a.split("-").at(-1)));
      await Promise.all(names.slice(1).map((name) => caches.delete(name)));
      await self.clients.claim();
    })(),
  ),
);
self.addEventListener("message", (event) => {
  if (event.data?.type === "APPLY_UPDATE") {
    self.skipWaiting();
    return;
  }
  if (!["PREPARE_OCR", "OCR_STATUS"].includes(event.data?.type)) return;
  event.waitUntil(
    (async () => {
      try {
        if (event.data.type === "PREPARE_OCR")
          for (const path of OCR)
            await ocrResource(new Request(new URL(path, self.location.origin)));
        const cache = await caches.open(OCR_CACHE);
        const ready = (await Promise.all(OCR.map((path) => cache.match(path)))).every(Boolean);
        event.ports?.[0]?.postMessage({ ready });
      } catch {
        event.ports?.[0]?.postMessage({
          ready: false,
          error: "Не удалось подготовить распознавание. Проверьте соединение и повторите.",
        });
      }
    })(),
  );
});
self.addEventListener("fetch", (event) => {
  const request = event.request,
    url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (OCR.includes(url.pathname)) {
    event.respondWith(ocrResource(request));
    return;
  }
  if (
    request.mode === "navigate" &&
    ["/", "/finance", "/app", "/app.html"].includes(url.pathname)
  ) {
    event.respondWith(
      caches
        .open(CACHE)
        .then((cache) => cache.match("/finance"))
        .then((response) => response || fetch(request)),
    );
    return;
  }
  if (!PUBLIC_PATHS.has(url.pathname)) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      return (await cache.match(request)) || (await caches.match(request)) || fetch(request);
    })(),
  );
});
