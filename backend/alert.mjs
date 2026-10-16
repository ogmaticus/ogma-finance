// Оповещение администратора письмом: node backend/alert.mjs "Тема" [текст]
// Адрес — ALERT_EMAIL; почта настраивается теми же MAIL_*/SMTP_*, что и приложение.
// К письму прикладываются последние строки журнала упавшей службы (если доступны).
import { execFileSync } from "node:child_process";
import os from "node:os";
import { createMailer } from "./mail.mjs";

const [subject = "Сбой на сервере «Финансов»", extra = ""] = process.argv.slice(2);
const to = process.env.ALERT_EMAIL;
if (!to) {
  console.error("[alert] ALERT_EMAIL не задан — оповещение не отправлено:", subject);
  process.exit(0);
}

let journal = "";
const unit = /службы (\S+)/.exec(subject)?.[1];
if (unit) {
  try {
    journal = execFileSync("journalctl", ["-u", unit, "-n", "30", "--no-pager", "-o", "cat"], {
      encoding: "utf8",
      timeout: 10000,
    });
  } catch {
    journal = "(журнал недоступен)";
  }
}

const text = [
  subject,
  `Сервер: ${os.hostname()}`,
  `Время (UTC): ${new Date().toISOString()}`,
  extra,
  journal && `Последние строки журнала:\n${journal}`,
]
  .filter(Boolean)
  .join("\n\n");

await createMailer(process.env).send({ to, subject, text });
console.log("[alert] отправлено:", to, subject);
