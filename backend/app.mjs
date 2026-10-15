// HTTP application: routing, sessions, static files and security headers.
// Budget logic is reused from server/budget.ts through D1/R2-compatible adapters.
import http from "node:http";
import { Readable } from "node:stream";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { D1Adapter } from "./db.mjs";
import { Auth, AuthError, CONSENT_VERSION } from "./auth.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(here, "../public");
const PAGES_DIR = path.resolve(here, "pages");
const COOKIE = "fin_session";

export const APP_CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".wasm": "application/wasm",
  ".gz": "application/gzip",
  ".txt": "text/plain; charset=utf-8",
};

const BASE_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "Cross-Origin-Opener-Policy": "same-origin",
};

function parseCookies(header = "") {
  const out = {};
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function safeReturn(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return "/finance";
  if (/^\/(login|logout)\b/.test(value)) return "/finance";
  return value;
}

function jsonResponse(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", Vary: "Cookie", ...headers },
  });
}

async function readJson(request, max = 4096) {
  const text = await request.text();
  if (text.length > max) throw new AuthError(413, "Запрос слишком большой");
  try {
    return JSON.parse(text || "{}");
  } catch {
    throw new AuthError(400, "Некорректный JSON");
  }
}

export function createApp({ config, pool, files, mailer, budget, log = () => {} }) {
  const origin = new URL(config.PUBLIC_ORIGIN).origin;
  const secureCookie = origin.startsWith("https://");
  const auth = new Auth({ pool, secret: config.APP_SECRET, mailer });
  const env = { DB: new D1Adapter(pool), BUCKET: files };

  const sessionCookie = (token, maxAge) =>
    `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureCookie ? "; Secure" : ""}`;

  function checkOrigin(request) {
    if (request.headers.get("Origin") !== origin) throw new AuthError(403, "Запрос разрешён только из приложения");
  }

  async function staticFile(file, { csp = false, cache = "no-cache" } = {}) {
    try {
      const info = await stat(file);
      if (!info.isFile()) return null;
      const body = await readFile(file);
      const headers = { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": cache };
      if (csp) headers["Content-Security-Policy"] = APP_CSP;
      return new Response(body, { headers });
    } catch {
      return null;
    }
  }

  function publicPath(pathname, root) {
    let decoded;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      return null;
    }
    if (decoded.includes("\0")) return null;
    const full = path.resolve(root, "." + decoded);
    return full.startsWith(root + path.sep) ? full : null;
  }

  async function route(request, ctx) {
    const url = new URL(request.url);
    const p = url.pathname;
    const method = request.method;
    const identity = ctx.user ? { userId: ctx.user.userId } : null;

    if (p === "/healthz") {
      await pool.query("SELECT 1");
      return new Response("ok", { headers: { "Cache-Control": "no-store" } });
    }
    if (p === "/api/session" && method === "GET")
      return jsonResponse({
        user: ctx.user ? { id: ctx.user.userId, name: ctx.user.displayName, email: ctx.user.email } : null,
        signInUrl: "/login?return_to=%2Ffinance",
        signOutUrl: "/logout?return_to=%2Ffinance",
        consentVersion: CONSENT_VERSION,
      });
    if (p === "/api/auth/request-code" && method === "POST") {
      checkOrigin(request);
      const body = await readJson(request);
      const result = await auth.requestCode(body.email, ctx.ip);
      return jsonResponse({ ok: true, email: result.email });
    }
    if (p === "/api/auth/verify" && method === "POST") {
      checkOrigin(request);
      const body = await readJson(request);
      const { token } = await auth.verifyCode(body, { ip: ctx.ip, userAgent: request.headers.get("User-Agent") });
      return jsonResponse({ ok: true }, 200, { "Set-Cookie": sessionCookie(token, 30 * 86400) });
    }
    if (p === "/logout" && (method === "GET" || method === "POST")) {
      await auth.logout(ctx.token);
      return new Response(null, {
        status: 303,
        headers: { Location: safeReturn(url.searchParams.get("return_to")), "Set-Cookie": sessionCookie("", 0), "Cache-Control": "no-store" },
      });
    }
    if (p === "/api/account" && method === "DELETE") {
      checkOrigin(request);
      if (!ctx.user) throw new AuthError(401, "Войдите в аккаунт");
      // Erase budget data, versions and files with the same code path as "delete all my data".
      const erase = await budget.handleBudget(
        new Request(origin + "/api/budget", { method: "DELETE", headers: { Origin: origin } }),
        identity,
        env,
      );
      if (!erase.ok) return erase;
      await pool.query("DELETE FROM owner_data_state WHERE owner = $1", [ctx.user.userId]);
      await auth.deleteUser(ctx.user.userId);
      return jsonResponse({ deleted: true }, 200, { "Set-Cookie": sessionCookie("", 0) });
    }
    if (p === "/api/budget") return budget.handleBudget(request, identity, env);
    if (p === "/api/backups" && method === "GET") return budget.handleBackups(request, identity, env);
    if (p === "/api/files") return budget.handleFiles(request, identity, env);
    const fileMatch = p.match(/^\/api\/files\/([^/]+)$/);
    if (fileMatch) return budget.handleFile(request, identity, env, decodeURIComponent(fileMatch[1]));
    if (p.startsWith("/api/")) return jsonResponse({ error: "Не найдено" }, 404);

    if (method !== "GET" && method !== "HEAD") return new Response("Method Not Allowed", { status: 405 });
    if (p === "/") return Response.redirect(origin + "/finance", 302);
    if (p === "/app.html") return Response.redirect(origin + "/finance", 301);
    if (p === "/finance") return staticFile(path.join(PUBLIC_DIR, "app.html"), { csp: true });
    if (p === "/login") {
      if (ctx.user) return Response.redirect(origin + safeReturn(url.searchParams.get("return_to")), 302);
      return staticFile(path.join(PAGES_DIR, "login.html"), { csp: true });
    }
    if (p === "/privacy" || p === "/consent") return staticFile(path.join(PAGES_DIR, p.slice(1) + ".html"), { csp: true });
    if (p.startsWith("/auth/")) {
      const file = publicPath(p.slice("/auth".length), PAGES_DIR);
      if (file && /\.(js|css)$/.test(file)) return (await staticFile(file)) || new Response("Not Found", { status: 404 });
    }
    const file = publicPath(p, PUBLIC_DIR);
    if (file && !file.endsWith(".html")) {
      const versioned = url.searchParams.has("v");
      const cache =
        p === "/sw.js" || p.endsWith(".webmanifest")
          ? "no-cache"
          : versioned || p.startsWith("/ocr/") || p.startsWith("/icons/")
            ? "public, max-age=31536000, immutable"
            : "public, max-age=3600";
      const response = await staticFile(file, { cache });
      if (response) return response;
    }
    return new Response("Не найдено", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }

  async function handle(req, res) {
    const started = Date.now();
    const ip = config.TRUST_PROXY === "1" ? String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress : req.socket.remoteAddress;
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (v !== undefined && k !== "host") headers.set(k, Array.isArray(v) ? v.join(", ") : v);
    const hasBody = req.method !== "GET" && req.method !== "HEAD";
    const request = new Request(origin + req.url, {
      method: req.method,
      headers,
      body: hasBody ? Readable.toWeb(req) : undefined,
      duplex: hasBody ? "half" : undefined,
    });
    let response;
    try {
      const token = parseCookies(req.headers.cookie)[COOKIE];
      const user = token ? await auth.sessionUser(token) : null;
      const ctx = { token, user, ip };
      response = request.url.startsWith(origin + "/api/budget") || request.url.startsWith(origin + "/api/backups") || request.url.startsWith(origin + "/api/files")
        ? await budget.safeResponse(() => route(request, ctx), request)
        : await route(request, ctx);
    } catch (error) {
      if (error instanceof AuthError) response = jsonResponse({ error: error.message, code: error.code }, error.status);
      else {
        log({ level: "error", msg: "request failed", path: new URL(request.url).pathname, name: error?.name, code: error?.code });
        response = jsonResponse({ error: "Сервис временно недоступен. Попробуйте позже." }, 503);
      }
    }
    const out = { ...BASE_HEADERS };
    response.headers.forEach((v, k) => (out[k] = v));
    res.writeHead(response.status, out);
    if (req.method === "HEAD" || !response.body) res.end();
    else Readable.fromWeb(response.body).pipe(res);
    res.on("finish", () =>
      log({
        level: "info",
        method: req.method,
        path: new URL(request.url).pathname.replace(/\/api\/files\/[^/]+/, "/api/files/:id"),
        status: response.status,
        ms: Date.now() - started,
      }),
    );
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((error) => {
      log({ level: "error", msg: "fatal handler error", name: error?.name });
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  server.headersTimeout = 20000;
  server.requestTimeout = 120000;
  return { server, auth };
}
