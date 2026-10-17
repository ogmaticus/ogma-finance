// Generated public/sw.js uses versions from release.json.
const RELEASE = "33",
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
  "/base.css?v=33",
  "/design-tokens.css?v=33",
  "/theme.css?v=33",
  "/appearance.css?v=33",
  "/shell.css?v=33",
  "/accounts.js?v=33",
  "/analytics-ui.js?v=33",
  "/app.js?v=33",
  "/appearance-init.js?v=33",
  "/appearance.js?v=33",
  "/backup-core.js?v=33",
  "/backup-ui.js?v=33",
  "/backup-zip.js?v=33",
  "/budget-core.js?v=33",
  "/budget-schema.js?v=33",
  "/budget-ui.js?v=33",
  "/category-history.js?v=33",
  "/data-model.js?v=33",
  "/dates.js?v=33",
  "/events.js?v=33",
  "/file-vault.js?v=33",
  "/format.js?v=33",
  "/icons.js?v=33",
  "/import-ui.js?v=33",
  "/legacy-money.js?v=33",
  "/migration-copy.js?v=33",
  "/money.js?v=33",
  "/month-picker.js?v=33",
  "/ocr-parser.js?v=33",
  "/ocr-refine.js?v=33",
  "/operation-form.js?v=33",
  "/operations-ui.js?v=33",
  "/privacy-ui.js?v=33",
  "/pwa.js?v=33",
  "/record-actions.js?v=33",
  "/release-info.js?v=33",
  "/screenshot-source.js?v=33",
  "/shell-ui.js?v=33",
  "/state.js?v=33",
  "/sync-core.js?v=33",
  "/sync.js?v=33",
  "/ui.js?v=33",
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
