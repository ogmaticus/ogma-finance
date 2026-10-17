// Email one-time-code login, sessions, consent log and rate limits.
import { loginCodeEmail } from "./mail-templates.mjs";
import crypto from "node:crypto";

export const CONSENT_VERSION = "2026-10-17";
export const SESSION_DAYS = 30;
const CODE_TTL_MINUTES = 10;
const MAX_CODE_ATTEMPTS = 5;

export class AuthError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function normalizeEmail(input) {
  const email = String(input ?? "").trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]{2,}$/.test(email))
    throw new AuthError(400, "Укажите корректный адрес почты", "invalid_email");
  return email;
}

export class Auth {
  constructor({ pool, secret, mailer, now = () => new Date() }) {
    if (!/^[0-9a-f]{64,}$/i.test(secret || "")) throw new Error("APP_SECRET must be at least 64 hex characters");
    this.pool = pool;
    this.secret = Buffer.from(secret, "hex");
    this.mailer = mailer;
    this.now = now;
  }
  hmac(value) {
    return crypto.createHmac("sha256", this.secret).update(value).digest("hex");
  }
  static sha256(value) {
    return crypto.createHash("sha256").update(value).digest("hex");
  }
  // Fixed-window counter; returns false when the limit is exceeded.
  async hit(key, limit, windowSeconds) {
    const { rows } = await this.pool.query(
      `INSERT INTO rate_limits (key, window_start, count) VALUES ($1, now(), 1)
       ON CONFLICT (key) DO UPDATE SET
         count = CASE WHEN rate_limits.window_start < now() - make_interval(secs => $2::double precision) THEN 1 ELSE rate_limits.count + 1 END,
         window_start = CASE WHEN rate_limits.window_start < now() - make_interval(secs => $2::double precision) THEN now() ELSE rate_limits.window_start END
       RETURNING count`,
      [key, windowSeconds],
    );
    return rows[0].count <= limit;
  }
  async requestCode(rawEmail, ip) {
    const email = normalizeEmail(rawEmail);
    const emailKey = this.hmac("email:" + email);
    if (!(await this.hit("code-ip:" + (ip || "unknown"), 20, 3600)))
      throw new AuthError(429, "Слишком много запросов. Попробуйте через час.", "rate_limited");
    if (!(await this.hit("code-email-min:" + emailKey, 1, 60)))
      throw new AuthError(429, "Код уже отправлен. Новый можно запросить через минуту.", "rate_limited");
    if (!(await this.hit("code-email-hour:" + emailKey, 5, 3600)))
      throw new AuthError(429, "Слишком много кодов для этой почты. Попробуйте через час.", "rate_limited");
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
    await this.pool.query(
      `INSERT INTO login_codes (email, code_hash, expires_at, attempts, created_at)
       VALUES ($1, $2, now() + make_interval(mins => $3::integer), 0, now())
       ON CONFLICT (email) DO UPDATE SET code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at, attempts = 0, created_at = now()`,
      [email, this.hmac("code:" + email + ":" + code), CODE_TTL_MINUTES],
    );
    await this.mailer.send({ to: email, ...loginCodeEmail({ code, ttlMinutes: CODE_TTL_MINUTES }) });
    return { email };
  }
  async verifyCode({ email: rawEmail, code: rawCode, consent }, { ip, userAgent }) {
    const code = String(rawCode ?? "").replace(/\s+/g, "");
    const email = normalizeEmail(rawEmail);
    if (!/^\d{6}$/.test(code)) throw new AuthError(400, "Введите 6 цифр из письма", "invalid_code");
    const { rows } = await this.pool.query(
      `UPDATE login_codes SET attempts = attempts + 1 WHERE email = $1 AND expires_at > now() RETURNING code_hash, attempts`,
      [email],
    );
    const row = rows[0];
    if (!row) throw new AuthError(400, "Код истёк или не запрашивался. Запросите новый.", "code_expired");
    if (row.attempts > MAX_CODE_ATTEMPTS) {
      await this.pool.query("DELETE FROM login_codes WHERE email = $1", [email]);
      throw new AuthError(429, "Слишком много попыток. Запросите новый код.", "too_many_attempts");
    }
    const expected = Buffer.from(row.code_hash, "hex"),
      actual = Buffer.from(this.hmac("code:" + email + ":" + code), "hex");
    if (!crypto.timingSafeEqual(expected, actual)) throw new AuthError(400, "Неверный код", "invalid_code");

    let user = (await this.pool.query("SELECT id, email, display_name FROM users WHERE email = $1", [email])).rows[0];
    const hasConsent =
      user &&
      (
        await this.pool.query(
          "SELECT 1 FROM consents WHERE user_id = $1 AND document = 'personal-data' AND version = $2 AND withdrawn_at IS NULL LIMIT 1",
          [user.id, CONSENT_VERSION],
        )
      ).rows.length > 0;
    if (!hasConsent && consent !== CONSENT_VERSION)
      throw new AuthError(428, "Подтвердите согласие на обработку персональных данных", "consent_required");

    const token = crypto.randomBytes(32).toString("base64url");
    await this.pool.transaction(async (c) => {
      await c.query("DELETE FROM login_codes WHERE email = $1", [email]);
      if (!user) {
        user = { id: "u_" + crypto.randomBytes(16).toString("base64url"), email, display_name: null };
        await c.query("INSERT INTO users (id, email, last_login_at) VALUES ($1, $2, now())", [user.id, email]);
      } else await c.query("UPDATE users SET last_login_at = now() WHERE id = $1", [user.id]);
      if (!hasConsent)
        await c.query(
          "INSERT INTO consents (user_id, email_hash, document, version, ip, user_agent) VALUES ($1, $2, 'personal-data', $3, $4, $5)",
          [user.id, this.hmac("email:" + email), CONSENT_VERSION, ip || null, String(userAgent || "").slice(0, 300) || null],
        );
      await c.query(
        "INSERT INTO sessions (id_hash, user_id, expires_at) VALUES ($1, $2, now() + make_interval(days => $3::integer))",
        [Auth.sha256(token), user.id, SESSION_DAYS],
      );
    });
    return { token, user };
  }
  async sessionUser(token) {
    if (!token || !/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
    const hash = Auth.sha256(token);
    const { rows } = await this.pool.query(
      `SELECT u.id, u.email, u.display_name, s.last_seen_at < now() - interval '1 day' AS stale
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id_hash = $1 AND s.expires_at > now()`,
      [hash],
    );
    const row = rows[0];
    if (!row) return null;
    if (row.stale)
      await this.pool.query(
        "UPDATE sessions SET last_seen_at = now(), expires_at = now() + make_interval(days => $2::integer) WHERE id_hash = $1",
        [hash, SESSION_DAYS],
      );
    return { userId: row.id, email: row.email, displayName: row.display_name || row.email };
  }
  async logout(token) {
    if (token) await this.pool.query("DELETE FROM sessions WHERE id_hash = $1", [Auth.sha256(token)]);
  }
  // Removes the user record and sessions; the consent log keeps only the
  // e-mail hash with a withdrawal mark as evidence of lawful processing.
  async deleteUser(userId) {
    await this.pool.transaction(async (c) => {
      const user = (await c.query("SELECT email FROM users WHERE id = $1", [userId])).rows[0];
      await c.query("UPDATE consents SET withdrawn_at = now(), user_id = NULL, ip = NULL, user_agent = NULL WHERE user_id = $1", [userId]);
      if (user) await c.query("DELETE FROM login_codes WHERE email = $1", [user.email]);
      await c.query("DELETE FROM users WHERE id = $1", [userId]);
    });
  }
  async cleanup() {
    await this.pool.query("DELETE FROM sessions WHERE expires_at < now()");
    await this.pool.query("DELETE FROM login_codes WHERE expires_at < now() - interval '1 day'");
    await this.pool.query("DELETE FROM rate_limits WHERE window_start < now() - interval '2 days'");
  }
}
