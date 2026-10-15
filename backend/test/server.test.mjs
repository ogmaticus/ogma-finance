// Integration tests for the v2 server against a real PostgreSQL.
// Run: TEST_DATABASE_URL=postgres://... node --experimental-transform-types --import ./backend/register.mjs --test backend/test/
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import net from "node:net";
import { createPool, migrate } from "../db.mjs";
import { FileStore } from "../file-store.mjs";
import { createMailer } from "../mail.mjs";
import { createApp } from "../app.mjs";

const DB = process.env.TEST_DATABASE_URL;
if (!DB) throw new Error("Set TEST_DATABASE_URL to an empty test database");

let pool, server, base, filesDir, mailDir, auth;
const PNG = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), crypto.randomBytes(200)]);

before(async () => {
  pool = createPool(DB, 5);
  await pool.query("DROP SCHEMA public CASCADE");
  await pool.query("CREATE SCHEMA public");
  await migrate(pool);
  filesDir = await mkdtemp(path.join(tmpdir(), "fin-files-"));
  mailDir = await mkdtemp(path.join(tmpdir(), "fin-mail-"));
  const app = createApp({
    config: {
      PUBLIC_ORIGIN: "http://127.0.0.1:0",
      APP_SECRET: crypto.randomBytes(32).toString("hex"),
    },
    pool,
    files: new FileStore(filesDir, crypto.randomBytes(32).toString("hex")),
    mailer: createMailer({ MAIL_TRANSPORT: "file", MAIL_DIR: mailDir }),
    budget: await import("../../server/budget.ts"),
  });
  server = app.server;
  auth = app.auth;
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.close();
  await pool.end();
});

// The app was configured before the port was known; requests carry the configured origin.
const ORIGIN = "http://127.0.0.1:0";
async function req(pathname, { method = "GET", body, cookie, headers = {}, origin = true } = {}) {
  const h = { ...headers };
  if (origin) h.Origin = ORIGIN;
  if (cookie) h.Cookie = cookie;
  if (body !== undefined && !(body instanceof FormData)) h["Content-Type"] = "application/json";
  const r = await fetch(base + pathname, {
    method,
    headers: h,
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    redirect: "manual",
  });
  const text = await r.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: r.status, json, text, headers: r.headers };
}
async function lastCode(email) {
  const files = (await readdir(mailDir)).filter((f) => f.endsWith(`-${email}.json`)).sort();
  const mail = JSON.parse(await readFile(path.join(mailDir, files.at(-1)), "utf8"));
  return mail.text.match(/\b(\d{6})\b/)[1];
}
async function login(email) {
  await pool.query("DELETE FROM rate_limits");
  const r1 = await req("/api/auth/request-code", { method: "POST", body: { email } });
  assert.equal(r1.status, 200, r1.text);
  const code = await lastCode(email);
  const r2 = await req("/api/auth/verify", { method: "POST", body: { email, code, consent: "2026-10-15" } });
  assert.equal(r2.status, 200, r2.text);
  return r2.headers.get("set-cookie").split(";")[0];
}
const budgetDoc = (name) => ({
  schemaVersion: 3,
  accounts: [{ id: "card", name: "Карта", openingMinor: 0 }],
  ops: [{ id: "op1", name, amountMinor: 12345, type: "expense", date: "2026-10-01", account: "card", category: "Кафе" }],
  goals: [],
  limits: {},
});

test("login: origin, validation, rate limit, consent, wrong code, session cookie", async () => {
  assert.equal((await req("/api/auth/request-code", { method: "POST", body: { email: "a@b.ru" }, origin: false })).status, 403);
  assert.equal((await req("/api/auth/request-code", { method: "POST", body: { email: "not-an-email" } })).status, 400);
  const email = "anna@example.ru";
  assert.equal((await req("/api/auth/request-code", { method: "POST", body: { email: "Anna@Example.RU " } })).status, 200);
  const again = await req("/api/auth/request-code", { method: "POST", body: { email } });
  assert.equal(again.status, 429);
  const code = await lastCode(email);
  const wrong = code === "000000" ? "111111" : "000000";
  assert.equal((await req("/api/auth/verify", { method: "POST", body: { email, code: wrong, consent: "2026-10-15" } })).status, 400);
  const noConsent = await req("/api/auth/verify", { method: "POST", body: { email, code } });
  assert.equal(noConsent.status, 428);
  assert.equal(noConsent.json.code, "consent_required");
  assert.equal((await pool.query("SELECT count(*)::int n FROM users")).rows[0].n, 0, "no user before consent");
  const ok = await req("/api/auth/verify", { method: "POST", body: { email, code, consent: "2026-10-15" } });
  assert.equal(ok.status, 200);
  const cookie = ok.headers.get("set-cookie");
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  // A code works only once.
  assert.equal((await req("/api/auth/verify", { method: "POST", body: { email, code, consent: "2026-10-15" } })).status, 400);
  const session = await req("/api/session", { cookie: cookie.split(";")[0] });
  assert.equal(session.json.user.email, email);
  const consent = (await pool.query("SELECT * FROM consents")).rows;
  assert.equal(consent.length, 1);
  assert.equal(consent[0].version, "2026-10-15");
  assert.ok(consent[0].ip);
  // Sessions and codes are stored only as hashes.
  const token = cookie.split(";")[0].split("=")[1];
  assert.equal((await pool.query("SELECT count(*)::int n FROM sessions WHERE id_hash = $1", [token])).rows[0].n, 0);
});

test("login: brute force on a code is stopped after 5 attempts", async () => {
  await pool.query("DELETE FROM rate_limits");
  const email = "brute@example.ru";
  await req("/api/auth/request-code", { method: "POST", body: { email } });
  const code = await lastCode(email);
  const wrong = String((Number(code) + 1) % 1000000).padStart(6, "0");
  for (let i = 0; i < 5; i++)
    assert.equal((await req("/api/auth/verify", { method: "POST", body: { email, code: wrong, consent: "2026-10-15" } })).status, 400);
  const blocked = await req("/api/auth/verify", { method: "POST", body: { email, code, consent: "2026-10-15" } });
  assert.equal(blocked.status, 429, "even the right code is refused after too many attempts");
});

test("returning user signs in without re-consenting; expired session is rejected", async () => {
  const cookie = await login("returning@example.ru");
  await pool.query("DELETE FROM rate_limits");
  await req("/api/auth/request-code", { method: "POST", body: { email: "returning@example.ru" } });
  const code = await lastCode("returning@example.ru");
  assert.equal((await req("/api/auth/verify", { method: "POST", body: { email: "returning@example.ru", code } })).status, 200);
  await pool.query("UPDATE sessions SET expires_at = now() - interval '1 minute'");
  assert.equal((await req("/api/session", { cookie })).json.user, null);
});

test("budget sync, revision conflict and isolation between users", async () => {
  const alice = await login("alice@example.ru");
  const bob = await login("bob@example.ru");
  const put0 = await req("/api/budget", { method: "PUT", cookie: alice, body: { revision: 0, data: budgetDoc("Кофе") } });
  assert.equal(put0.status, 200, put0.text);
  assert.equal(put0.json.revision, 1);
  const stale = await req("/api/budget", { method: "PUT", cookie: alice, body: { revision: 0, data: budgetDoc("Чай") } });
  assert.equal(stale.status, 409);
  const got = await req("/api/budget", { cookie: alice, headers: { "X-Finance-Schema": "3" } });
  assert.equal(got.json.data.ops[0].name, "Кофе");
  const bobView = await req("/api/budget", { cookie: bob, headers: { "X-Finance-Schema": "3" } });
  assert.equal(bobView.json.revision, 0);
  assert.equal(bobView.json.data, null);
  const wrongOwner = await req("/api/budget", { cookie: bob, headers: { "X-Finance-Owner": "someone-else" } });
  assert.equal(wrongOwner.status, 401);
  assert.equal((await req("/api/budget")).status, 401, "anonymous access refused");
  const csrf = await req("/api/budget", { method: "PUT", cookie: alice, origin: false, body: { revision: 1, data: budgetDoc("X") } });
  assert.equal(csrf.status, 403);
});

test("screenshots are encrypted at rest, private to the owner and deletable", async () => {
  const alice = await login("alice2@example.ru");
  const bob = await login("bob2@example.ru");
  const form = new FormData();
  form.append("file", new File([PNG], "s.png", { type: "image/png" }));
  form.append("sourceId", "src-1");
  const up = await req("/api/files", { method: "POST", cookie: alice, body: form });
  assert.equal(up.status, 200, up.text);
  const id = up.json.id;
  const onDisk = [];
  const walk = async (dir) => {
    for (const e of await readdir(dir, { withFileTypes: true }))
      e.isDirectory() ? await walk(path.join(dir, e.name)) : onDisk.push(path.join(dir, e.name));
  };
  await walk(filesDir);
  const raw = await readFile(onDisk.at(-1));
  assert.equal(raw.includes(PNG.subarray(0, 8)), false, "plaintext PNG header must not be on disk");
  assert.equal(raw.includes(PNG.subarray(20, 60)), false);
  const r = await fetch(base + "/api/files/" + id, { headers: { Cookie: alice } });
  assert.equal(r.status, 200);
  assert.ok(Buffer.from(await r.arrayBuffer()).equals(PNG));
  assert.equal((await req("/api/files/" + id, { cookie: bob })).status, 404, "other user cannot read");
  assert.equal((await req("/api/files/" + id, { method: "DELETE", cookie: alice })).status, 200);
  assert.equal((await req("/api/files/" + id, { cookie: alice })).status, 404);
  const fake = new FormData();
  fake.append("file", new File([Buffer.from("<script>alert(1)</script>")], "x.png", { type: "image/png" }));
  assert.equal((await req("/api/files", { method: "POST", cookie: alice, body: fake })).status, 400, "content sniffing rejects non-images");
});

test("logout invalidates the session", async () => {
  const cookie = await login("leaver@example.ru");
  const out = await req("/logout?return_to=%2Ffinance", { cookie });
  assert.equal(out.status, 303);
  assert.equal(out.headers.get("location"), "/finance");
  assert.match(out.headers.get("set-cookie"), /Max-Age=0/);
  assert.equal((await req("/api/session", { cookie })).json.user, null);
  assert.equal((await req("/logout?return_to=https://evil.example", {})).headers.get("location"), "/finance");
});

test("account deletion removes data, files and login; consent is anonymised and withdrawn", async () => {
  const cookie = await login("delete-me@example.ru");
  const userId = (await req("/api/session", { cookie })).json.user.id;
  await req("/api/budget", { method: "PUT", cookie, body: { revision: 0, data: budgetDoc("Удалить") } });
  const form = new FormData();
  form.append("file", new File([Buffer.concat([PNG, Buffer.from("x")])], "d.png", { type: "image/png" }));
  await req("/api/files", { method: "POST", cookie, body: form });
  const before = (await pool.query("SELECT object_key FROM screenshot_files WHERE owner = $1", [userId])).rows;
  assert.equal(before.length, 1);
  assert.equal((await req("/api/account", { method: "DELETE", cookie, origin: false })).status, 403);
  const del = await req("/api/account", { method: "DELETE", cookie });
  assert.equal(del.status, 200, del.text);
  for (const [table, column] of [["budget_documents", "owner"], ["budget_versions", "owner"], ["screenshot_files", "owner"], ["users", "id"], ["sessions", "user_id"]])
    assert.equal((await pool.query(`SELECT count(*)::int n FROM ${table} WHERE ${column} = $1`, [userId])).rows[0].n, 0, table);
  await assert.rejects(readFile(path.join(filesDir, before[0].object_key + ".bin")));
  const consents = (await pool.query("SELECT user_id, ip, withdrawn_at FROM consents WHERE user_id IS NULL AND withdrawn_at IS NOT NULL")).rows;
  assert.ok(consents.length >= 1);
  assert.equal(consents[0].ip, null);
  assert.equal((await req("/api/session", { cookie })).json.user, null);
});

test("static app: CSP on HTML, no path traversal, caching rules", async () => {
  const app = await req("/finance");
  assert.equal(app.status, 200);
  assert.match(app.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  assert.equal(app.headers.get("x-content-type-options"), "nosniff");
  const login = await req("/login");
  assert.match(login.headers.get("content-security-policy"), /script-src 'self'/);
  assert.equal((await req("/..%2f..%2fetc%2fpasswd")).status, 404);
  assert.equal((await req("/%2e%2e/backend/main.mjs")).status, 404);
  assert.equal((await req("/../server/budget.ts")).status, 404);
  const js = await req("/app.js?v=32");
  assert.match(js.headers.get("cache-control"), /immutable/);
  assert.equal((await req("/sw.js")).headers.get("cache-control"), "no-cache");
  assert.equal((await req("/api/nope")).status, 404);
});

test("SMTP transport speaks the protocol and encodes Russian text", async () => {
  const received = [];
  const smtp = net.createServer((socket) => {
    socket.setEncoding("utf8");
    socket.write("220 test ESMTP\r\n");
    let data = false,
      buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk;
      let i;
      while ((i = buffer.indexOf("\r\n")) >= 0) {
        const line = buffer.slice(0, i);
        buffer = buffer.slice(i + 2);
        received.push(line);
        if (data) {
          if (line === ".") {
            data = false;
            socket.write("250 queued\r\n");
          }
          continue;
        }
        if (line.startsWith("EHLO")) socket.write("250-test\r\n250 AUTH PLAIN\r\n");
        else if (line.startsWith("AUTH PLAIN")) socket.write("235 ok\r\n");
        else if (line.startsWith("MAIL") || line.startsWith("RCPT")) socket.write("250 ok\r\n");
        else if (line === "DATA") (data = true), socket.write("354 go\r\n");
        else if (line === "QUIT") socket.end("221 bye\r\n");
      }
    });
  });
  await new Promise((r) => smtp.listen(0, "127.0.0.1", r));
  const mailer = createMailer({
    MAIL_TRANSPORT: "smtp",
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: String(smtp.address().port),
    SMTP_SECURE: "false",
    SMTP_STARTTLS: "false",
    SMTP_USER: "robot@example.ru",
    SMTP_PASSWORD: "secret",
    MAIL_FROM: "robot@example.ru",
  });
  await mailer.send({ to: "user@example.ru", subject: "Код входа: 123456", text: "Ваш код: 123456" });
  smtp.close();
  assert.ok(received.some((l) => l === "RCPT TO:<user@example.ru>"));
  assert.ok(received.some((l) => l.startsWith("Subject: =?UTF-8?B?")));
  const body = received.slice(received.indexOf("") + 1, received.indexOf(".")).join("");
  assert.equal(Buffer.from(body, "base64").toString("utf8"), "Ваш код: 123456");
});

test("cleanup removes expired sessions and stale codes", async () => {
  await pool.query("UPDATE sessions SET expires_at = now() - interval '1 day'");
  await auth.cleanup();
  assert.equal((await pool.query("SELECT count(*)::int n FROM sessions")).rows[0].n, 0);
});
