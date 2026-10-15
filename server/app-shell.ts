import html from "../public/app.html?raw";
export const APP_CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'";
export function appShellResponse() {
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": APP_CSP,
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin",
      "Cache-Control": "no-cache",
    },
  });
}
