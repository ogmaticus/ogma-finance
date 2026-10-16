// Проверка входа на SMTP без отправки письма: node --env-file=/etc/finance/finance.env backend/smtp-check.mjs
import tls from "node:tls";
const { SMTP_HOST: host, SMTP_PORT = "465", SMTP_USER: user = "", SMTP_PASSWORD: pass = "" } = process.env;
const mask = (s) => s.replace(/[\w.+-]+@[\w.-]+/g, "***@***");
const sock = tls.connect({ host, port: Number(SMTP_PORT), servername: host });
sock.setTimeout(15000, () => { console.log("timeout"); sock.destroy(); });
let buf = "";
const steps = [
  null,
  "EHLO finance.local",
  "AUTH PLAIN " + Buffer.from(`\0${user}\0${pass}`).toString("base64"),
  "QUIT",
];
let i = 0;
sock.on("data", (d) => {
  buf += d.toString();
  const lines = buf.split("\r\n");
  buf = lines.pop();
  for (const l of lines) {
    console.log("S:", mask(l).slice(0, 200));
    if (/^\d{3} /.test(l)) {
      i++;
      if (i < steps.length) {
        console.log("C:", steps[i].startsWith("AUTH") ? "AUTH PLAIN <скрыто>" : steps[i]);
        sock.write(steps[i] + "\r\n");
      } else sock.end();
    }
  }
});
sock.on("error", (e) => console.log("error:", e.message));
