// Database access: pool, migrations, and a D1-compatible adapter so that
// server/budget.ts (written for Cloudflare D1) runs on PostgreSQL unchanged.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "./pg.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

export function createPool(url, size = 10) {
  return new Pool(url, size);
}

export async function migrate(pool, log = () => {}) {
  await pool.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
  );
  const applied = new Set((await pool.query("SELECT version FROM schema_migrations")).rows.map((r) => r.version));
  const dir = path.join(here, "migrations");
  const files = (await readdir(dir)).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(path.join(dir, file), "utf8");
    await pool.transaction(async (c) => {
      await c.simple(sql);
      await c.query("INSERT INTO schema_migrations (version) VALUES ($1)", [file]);
    });
    log(`migration applied: ${file}`);
  }
}

// Converts SQLite-style "?" placeholders to PostgreSQL "$n".
// The budget queries never contain "?" inside string literals.
export function toPg(sql) {
  let n = 0;
  return sql.replace(/\?/g, () => "$" + ++n);
}

class Statement {
  constructor(db, sql, params = []) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }
  static from(db, sql) {
    return new Statement(db, toPg(sql));
  }
  bind(...params) {
    return new Statement(this.db, this.sql, params);
  }
  async first() {
    const result = await this.db.executor().query(this.sql, this.params);
    return result.rows[0] ?? null;
  }
  async all() {
    const result = await this.db.executor().query(this.sql, this.params);
    return { results: result.rows, success: true, meta: { changes: result.rowCount } };
  }
  async run() {
    const result = await this.db.executor().query(this.sql, this.params);
    return { results: result.rows, success: true, meta: { changes: result.rowCount } };
  }
}

export class D1Adapter {
  constructor(pool, connection = null) {
    this.pool = pool;
    this.connection = connection;
  }
  executor() {
    return this.connection || this.pool;
  }
  prepare(sql) {
    return Statement.from(this, sql);
  }
  // D1 runs a batch atomically; we run it in one transaction.
  async batch(statements) {
    return this.pool.transaction(async (c) => {
      const out = [];
      for (const s of statements) {
        const result = await c.query(s.sql, s.params);
        out.push({ results: result.rows, success: true, meta: { changes: result.rowCount } });
      }
      return out;
    });
  }
}
