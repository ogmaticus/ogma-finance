// Entry point. Start: npm run server  (see package.json)
import { createPool, migrate } from "./db.mjs";
import { FileStore } from "./file-store.mjs";
import { createMailer } from "./mail.mjs";
import { createApp } from "./app.mjs";

const config = process.env;
const log = (entry) => console.log(JSON.stringify({ time: new Date().toISOString(), ...entry }));

for (const name of ["DATABASE_URL", "APP_SECRET", "FILES_KEY", "FILES_DIR", "PUBLIC_ORIGIN"])
  if (!config[name]) {
    console.error(`Missing required environment variable ${name}`);
    process.exit(1);
  }

const pool = createPool(config.DATABASE_URL, Number(config.DB_POOL_SIZE || 10));
await migrate(pool, (msg) => log({ level: "info", msg }));
const budget = await import("../server/budget.ts");
const { server, auth } = createApp({
  config,
  pool,
  files: new FileStore(config.FILES_DIR, config.FILES_KEY),
  mailer: createMailer(config, (msg) => log({ level: "info", msg })),
  budget,
  log,
});

const port = Number(config.PORT || 3000),
  host = config.HOST || "127.0.0.1";
server.listen(port, host, () => log({ level: "info", msg: `listening on http://${host}:${port}` }));

const cleanup = setInterval(() => auth.cleanup().catch((e) => log({ level: "error", msg: "cleanup failed", name: e?.name })), 3600_000);
cleanup.unref();

function shutdown() {
  log({ level: "info", msg: "shutting down" });
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
