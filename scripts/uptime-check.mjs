// Внешний мониторинг доступности (запускается из GitHub Actions каждые 10 минут).
// Проверяет приложение, лендинг и срок сертификатов. Письмо уходит только при смене
// состояния: «сбой» и затем «восстановлено» — чтобы не засыпать почту одинаковыми письмами.
//   node scripts/uptime-check.mjs <файл-состояния>
// Почта: SMTP_USER, SMTP_PASSWORD, ALERT_EMAIL (+ SMTP_HOST) из секретов; без них — только журнал.
import tls from "node:tls";
import { readFile, writeFile } from "node:fs/promises";
import { createMailer } from "../backend/mail.mjs";

const STATE_FILE = process.argv[2] || "uptime-state.json";
const CERT_MIN_DAYS = 14;
const CHECKS = [
  { name: "Приложение (healthz)", url: "https://app.multiknopka.ru/healthz", expect: "ok" },
  { name: "Страница входа", url: "https://app.multiknopka.ru/login", expect: "Мультикнопка" },
  { name: "Лендинг", url: "https://multiknopka.ru/", expect: "Мультикнопка" },
];
const CERT_HOSTS = ["app.multiknopka.ru", "multiknopka.ru"];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function checkUrl({ url, expect }) {
  const started = Date.now();
  const res = await fetch(url, { signal: AbortSignal.timeout(15000), redirect: "manual" });
  const body = await res.text();
  const ms = Date.now() - started;
  if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
  if (!body.includes(expect)) throw new Error("неожиданный ответ");
  return `${ms} мс`;
}

function certDaysLeft(host) {
  return new Promise((resolve, reject) => {
    const s = tls.connect({ host, port: 443, servername: host, timeout: 15000 }, () => {
      const cert = s.getPeerCertificate();
      s.end();
      resolve(Math.floor((new Date(cert.valid_to) - Date.now()) / 86400000));
    });
    s.on("error", reject);
    s.on("timeout", () => s.destroy(new Error("таймаут TLS")));
  });
}

// Две повторные попытки с паузой — чтобы не поднимать тревогу из-за одного сетевого сбоя.
async function withRetry(fn) {
  let last;
  for (let i = 0; i < 3; i++) {
    try {
      return { ok: true, info: await fn() };
    } catch (e) {
      last = e;
      if (i < 2) await sleep(10000);
    }
  }
  return { ok: false, info: last?.message || String(last) };
}

const results = [];
for (const c of CHECKS) results.push({ name: c.name, ...(await withRetry(() => checkUrl(c))) });
for (const host of CERT_HOSTS) {
  const r = await withRetry(() => certDaysLeft(host));
  if (r.ok && r.info < CERT_MIN_DAYS) results.push({ name: `Сертификат ${host}`, ok: false, info: `осталось ${r.info} дн.` });
  else results.push({ name: `Сертификат ${host}`, ok: r.ok, info: r.ok ? `${r.info} дн.` : r.info });
}

for (const r of results) console.log(`${r.ok ? "OK  " : "FAIL"} ${r.name}: ${r.info}`);
const failed = results.filter((r) => !r.ok);
const nowDown = failed.length > 0;

let prev = { down: false };
try {
  prev = JSON.parse(await readFile(STATE_FILE, "utf8"));
} catch {}
await writeFile(STATE_FILE, JSON.stringify({ down: nowDown, at: new Date().toISOString() }));

const testAlert = process.env.TEST_ALERT === "true";
if (testAlert || nowDown !== Boolean(prev.down)) {
  const env = process.env;
  const to = env.ALERT_EMAIL || env.SMTP_USER;
  const subject = testAlert
    ? "Мультикнопка: проверка оповещений мониторинга"
    : nowDown
    ? `Мультикнопка: сбой — ${failed.map((f) => f.name).join(", ")}`
    : "Мультикнопка: всё снова работает";
  const text =
    (nowDown ? "Внешняя проверка обнаружила проблему.\n\n" : "Все проверки снова проходят.\n\n") +
    results.map((r) => `${r.ok ? "✓" : "✗"} ${r.name}: ${r.info}`).join("\n") +
    `\n\nВремя проверки: ${new Date().toISOString()}\nЖурнал: GitHub → Actions → Uptime monitor`;
  if (env.SMTP_USER && env.SMTP_PASSWORD && to) {
    const mailer = createMailer({
      MAIL_TRANSPORT: "smtp",
      SMTP_HOST: env.SMTP_HOST || "mail.hosting.reg.ru",
      SMTP_PORT: "465",
      SMTP_USER: env.SMTP_USER,
      SMTP_PASSWORD: env.SMTP_PASSWORD,
      MAIL_FROM: env.SMTP_USER,
      MAIL_FROM_NAME: "Мультикнопка · мониторинг",
    });
    await mailer.send({ to, subject, text });
    console.log("::notice::Письмо отправлено на " + to.replace(/^(.).*@/, "$1***@"));
  } else console.log("SMTP не настроен — письмо не отправлено");
}
if (nowDown) {
  console.log(`::error::${failed.map((f) => `${f.name}: ${f.info}`).join("; ")}`);
  process.exitCode = 1;
}
