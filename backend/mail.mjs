// Mail transports: "smtp" for production, "file" for tests, "console" for local development.
import net from "node:net";
import tls from "node:tls";
import crypto from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const b64 = (s) => Buffer.from(s, "utf8").toString("base64");
const encodeHeader = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);

export function buildMessage({ from, fromName, to, subject, text }) {
  const domain = from.split("@")[1] || "localhost";
  const body = b64(text).replace(/.{1,76}/g, "$&\r\n");
  return [
    `From: ${fromName ? `${encodeHeader(fromName)} <${from}>` : from}`,
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@${domain}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    body,
  ].join("\r\n");
}

class SmtpSession {
  constructor(socket) {
    this.attach(socket);
  }
  attach(socket) {
    this.socket = socket;
    this.buffer = "";
    this.waiters = [];
    this.lines = [];
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      this.buffer += chunk;
      let i;
      while ((i = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, i).replace(/\r$/, "");
        this.buffer = this.buffer.slice(i + 1);
        this.lines.push(line);
        if (/^\d{3} /.test(line)) {
          const reply = this.lines;
          this.lines = [];
          this.waiters.shift()?.resolve(reply);
        }
      }
    });
    socket.on("error", (e) => this.waiters.splice(0).forEach((w) => w.reject(e)));
  }
  read() {
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }
  async cmd(line, expect) {
    const reply = this.read();
    if (line !== null) this.socket.write(line + "\r\n");
    const lines = await reply;
    const code = Number(lines.at(-1).slice(0, 3));
    if (!expect.includes(code)) throw new Error(`SMTP ${code}: ${lines.at(-1)}`);
    return lines;
  }
}

export function createMailer(config, log = console.log) {
  const transport = config.MAIL_TRANSPORT || "console";
  const from = config.MAIL_FROM || "no-reply@localhost";
  const fromName = config.MAIL_FROM_NAME || "Финансы";
  if (transport === "console")
    return {
      async send(m) {
        log(`[mail:console] to=${m.to} subject=${m.subject}`);
      },
    };
  if (transport === "file")
    return {
      async send(m) {
        const dir = config.MAIL_DIR || "/tmp/finance-mail";
        await mkdir(dir, { recursive: true });
        await writeFile(path.join(dir, `${Date.now()}-${m.to}.json`), JSON.stringify(m));
      },
    };
  if (transport !== "smtp") throw new Error("Unknown MAIL_TRANSPORT " + transport);
  const host = config.SMTP_HOST,
    port = Number(config.SMTP_PORT || 465),
    secure = config.SMTP_SECURE !== "false";
  return {
    async send(m) {
      const socket = secure
        ? tls.connect({ host, port, servername: host })
        : net.connect({ host, port });
      await new Promise((resolve, reject) => {
        socket.once(secure ? "secureConnect" : "connect", resolve);
        socket.once("error", reject);
      });
      socket.setTimeout(20000, () => socket.destroy(new Error("SMTP timeout")));
      const s = new SmtpSession(socket);
      try {
        await s.cmd(null, [220]);
        let ehlo = await s.cmd("EHLO finance.local", [250]);
        if (!secure && ehlo.some((l) => /STARTTLS/i.test(l)) && config.SMTP_STARTTLS !== "false") {
          await s.cmd("STARTTLS", [220]);
          const upgraded = tls.connect({ socket, servername: host });
          await new Promise((resolve, reject) => {
            upgraded.once("secureConnect", resolve);
            upgraded.once("error", reject);
          });
          s.attach(upgraded);
          ehlo = await s.cmd("EHLO finance.local", [250]);
        }
        if (config.SMTP_USER)
          await s.cmd("AUTH PLAIN " + b64(`\0${config.SMTP_USER}\0${config.SMTP_PASSWORD || ""}`), [235]);
        await s.cmd(`MAIL FROM:<${from}>`, [250]);
        await s.cmd(`RCPT TO:<${m.to}>`, [250, 251]);
        await s.cmd("DATA", [354]);
        const message = buildMessage({ from, fromName, ...m }).replace(/^\./gm, "..");
        await s.cmd(message + "\r\n.", [250]);
        await s.cmd("QUIT", [221]).catch(() => {});
      } finally {
        s.socket.destroy();
      }
    },
  };
}
