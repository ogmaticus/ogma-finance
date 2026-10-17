// Generated public/sw.js uses versions from release.json.
const RELEASE = "34",
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
  "/base.css?v=34",
  "/design-tokens.css?v=34",
  "/theme.css?v=34",
  "/appearance.css?v=34",
  "/shell.css?v=34",
  "/accounts.js?v=34",
  "/analytics-ui.js?v=34",
  "/app.js?v=34",
  "/appearance-init.js?v=34",
  "/appearance.js?v=34",
  "/backup-core.js?v=34",
  "/backup-ui.js?v=34",
  "/backup-zip.js?v=34",
  "/budget-core.js?v=34",
  "/budget-schema.js?v=34",
  "/budget-ui.js?v=34",
  "/category-history.js?v=34",
  "/data-model.js?v=34",
  "/dates.js?v=34",
  "/events.js?v=34",
  "/file-vault.js?v=34",
  "/format.js?v=34",
  "/help-ui.js?v=34",
  "/icons.js?v=34",
  "/import-ui.js?v=34",
  "/legacy-money.js?v=34",
  "/migration-copy.js?v=34",
  "/money.js?v=34",
  "/month-picker.js?v=34",
  "/ocr-parser.js?v=34",
  "/ocr-refine.js?v=34",
  "/operation-form.js?v=34",
  "/operations-ui.js?v=34",
  "/privacy-ui.js?v=34",
  "/pwa.js?v=34",
  "/record-actions.js?v=34",
  "/release-info.js?v=34",
  "/screenshot-source.js?v=34",
  "/shell-ui.js?v=34",
  "/state.js?v=34",
  "/sync-core.js?v=34",
  "/sync.js?v=34",
  "/ui.js?v=34",
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
