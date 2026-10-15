// Minimal PostgreSQL client (wire protocol v3) without third-party dependencies.
// Supports: TCP or Unix socket, trust / cleartext / md5 / SCRAM-SHA-256 auth,
// extended query protocol with text parameters, simple queries, a small pool
// and transactions on a dedicated connection.
import net from "node:net";
import crypto from "node:crypto";

export class PgError extends Error {
  constructor(fields) {
    super(fields.M || "PostgreSQL error");
    this.name = "PgError";
    this.code = fields.C;
    this.severity = fields.S;
    this.detail = fields.D;
    this.constraint = fields.n;
  }
}

const OID = { bool: 16, bytea: 17, int8: 20, int2: 21, int4: 23, text: 25, json: 114, float4: 700, float8: 701, jsonb: 3802 };

function parseValue(oid, text) {
  if (text === null) return null;
  switch (oid) {
    case OID.bool:
      return text === "t";
    case OID.int2:
    case OID.int4:
      return Number(text);
    case OID.int8: {
      const n = Number(text);
      return Number.isSafeInteger(n) ? n : BigInt(text);
    }
    case OID.float4:
    case OID.float8:
      return Number(text);
    case OID.json:
    case OID.jsonb:
      return JSON.parse(text);
    case OID.bytea:
      return text.startsWith("\\x") ? Buffer.from(text.slice(2), "hex") : Buffer.from(text, "binary");
    default:
      return text;
  }
}

function encodeParam(value) {
  if (value === null || value === undefined) return { oid: 0, text: null };
  if (typeof value === "boolean") return { oid: OID.bool, text: value ? "t" : "f" };
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Non-finite number parameter");
    return Number.isInteger(value) ? { oid: OID.int8, text: String(value) } : { oid: OID.float8, text: String(value) };
  }
  if (typeof value === "bigint") return { oid: OID.int8, text: value.toString() };
  if (Buffer.isBuffer(value) || value instanceof Uint8Array)
    return { oid: OID.bytea, text: "\\x" + Buffer.from(value).toString("hex") };
  if (value instanceof Date) return { oid: 0, text: value.toISOString() };
  if (typeof value === "object") return { oid: OID.jsonb, text: JSON.stringify(value) };
  return { oid: 0, text: String(value) };
}

class Writer {
  constructor() {
    this.parts = [];
  }
  int32(n) {
    const b = Buffer.alloc(4);
    b.writeInt32BE(n);
    this.parts.push(b);
    return this;
  }
  int16(n) {
    const b = Buffer.alloc(2);
    b.writeInt16BE(n);
    this.parts.push(b);
    return this;
  }
  cstr(s) {
    this.parts.push(Buffer.from(s, "utf8"), Buffer.from([0]));
    return this;
  }
  bytes(b) {
    this.parts.push(b);
    return this;
  }
  message(type) {
    const body = Buffer.concat(this.parts);
    const head = Buffer.alloc(type ? 5 : 4);
    if (type) {
      head.write(type, 0, "ascii");
      head.writeInt32BE(body.length + 4, 1);
    } else head.writeInt32BE(body.length + 4, 0);
    return Buffer.concat([head, body]);
  }
}

export function parseConnectionString(url) {
  const u = new URL(url);
  const host = u.searchParams.get("host") || decodeURIComponent(u.hostname) || "localhost";
  return {
    host,
    port: Number(u.port || 5432),
    user: decodeURIComponent(u.username || "postgres"),
    password: decodeURIComponent(u.password || ""),
    database: decodeURIComponent(u.pathname.replace(/^\//, "") || u.username || "postgres"),
  };
}

export class Connection {
  constructor(config) {
    this.config = config;
    this.buffer = Buffer.alloc(0);
    this.waiters = [];
    this.queue = Promise.resolve();
    this.closed = false;
  }
  async connect() {
    const { host, port } = this.config;
    this.socket = host.startsWith("/")
      ? net.connect({ path: `${host}/.s.PGSQL.${port}` })
      : net.connect({ host, port });
    this.socket.setNoDelay(true);
    await new Promise((resolve, reject) => {
      this.socket.once("connect", resolve);
      this.socket.once("error", reject);
    });
    this.socket.on("data", (chunk) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.drain();
    });
    this.socket.on("error", (error) => this.fail(error));
    this.socket.on("close", () => this.fail(new Error("PostgreSQL connection closed")));
    const startup = new Writer()
      .int32(196608)
      .cstr("user")
      .cstr(this.config.user)
      .cstr("database")
      .cstr(this.config.database)
      .cstr("client_encoding")
      .cstr("UTF8")
      .cstr("TimeZone")
      .cstr("UTC")
      .bytes(Buffer.from([0]))
      .message(null);
    this.socket.write(startup);
    await this.authenticate();
    return this;
  }
  fail(error) {
    this.closed = true;
    this.error = error;
    for (const waiter of this.waiters.splice(0)) waiter.reject(error);
  }
  drain() {
    while (this.buffer.length >= 5) {
      const length = this.buffer.readInt32BE(1);
      if (this.buffer.length < length + 1) return;
      const type = String.fromCharCode(this.buffer[0]);
      const body = this.buffer.subarray(5, length + 1);
      this.buffer = this.buffer.subarray(length + 1);
      if (type === "N" || type === "S" || type === "K" || type === "A") continue; // notices, params, key data, notifications
      const waiter = this.waiters.shift();
      if (waiter) waiter.resolve({ type, body: Buffer.from(body) });
      else this.pending = (this.pending || []).concat({ type, body: Buffer.from(body) });
    }
  }
  next() {
    if (this.pending?.length) return Promise.resolve(this.pending.shift());
    if (this.closed) return Promise.reject(this.error || new Error("Connection closed"));
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }
  static fields(body) {
    const fields = {};
    let i = 0;
    while (i < body.length && body[i] !== 0) {
      const code = String.fromCharCode(body[i]);
      const end = body.indexOf(0, i + 1);
      fields[code] = body.toString("utf8", i + 1, end);
      i = end + 1;
    }
    return fields;
  }
  async authenticate() {
    let scram = null;
    for (;;) {
      const { type, body } = await this.next();
      if (type === "E") throw new PgError(Connection.fields(body));
      if (type === "Z") return;
      if (type !== "R") continue;
      const kind = body.readInt32BE(0);
      if (kind === 0) continue;
      if (kind === 3) {
        this.socket.write(new Writer().cstr(this.config.password).message("p"));
      } else if (kind === 5) {
        const salt = body.subarray(4, 8);
        const inner = crypto.createHash("md5").update(this.config.password + this.config.user).digest("hex");
        const outer = crypto.createHash("md5").update(Buffer.concat([Buffer.from(inner), salt])).digest("hex");
        this.socket.write(new Writer().cstr("md5" + outer).message("p"));
      } else if (kind === 10) {
        const mechanisms = body.subarray(4).toString("utf8").split("\0");
        if (!mechanisms.includes("SCRAM-SHA-256")) throw new Error("Unsupported SASL mechanism");
        const nonce = crypto.randomBytes(18).toString("base64");
        const clientFirstBare = `n=*,r=${nonce}`;
        scram = { nonce, clientFirstBare };
        const initial = Buffer.from("n,," + clientFirstBare);
        this.socket.write(new Writer().cstr("SCRAM-SHA-256").int32(initial.length).bytes(initial).message("p"));
      } else if (kind === 11) {
        const serverFirst = body.subarray(4).toString("utf8");
        const attrs = Object.fromEntries(serverFirst.split(",").map((p) => [p[0], p.slice(2)]));
        if (!attrs.r?.startsWith(scram.nonce)) throw new Error("SCRAM nonce mismatch");
        const salted = crypto.pbkdf2Sync(this.config.password, Buffer.from(attrs.s, "base64"), Number(attrs.i), 32, "sha256");
        const clientKey = crypto.createHmac("sha256", salted).update("Client Key").digest();
        const storedKey = crypto.createHash("sha256").update(clientKey).digest();
        const withoutProof = `c=biws,r=${attrs.r}`;
        const authMessage = `${scram.clientFirstBare},${serverFirst},${withoutProof}`;
        const signature = crypto.createHmac("sha256", storedKey).update(authMessage).digest();
        const proof = Buffer.from(clientKey.map((b, i) => b ^ signature[i]));
        const serverKey = crypto.createHmac("sha256", salted).update("Server Key").digest();
        scram.serverSignature = crypto.createHmac("sha256", serverKey).update(authMessage).digest("base64");
        this.socket.write(new Writer().bytes(Buffer.from(`${withoutProof},p=${proof.toString("base64")}`)).message("p"));
      } else if (kind === 12) {
        const final = body.subarray(4).toString("utf8");
        if (final !== `v=${scram.serverSignature}`) throw new Error("SCRAM server signature mismatch");
      } else throw new Error("Unsupported PostgreSQL authentication method " + kind);
    }
  }
  run(fn) {
    const job = this.queue.then(fn, fn);
    this.queue = job.catch(() => {});
    return job;
  }
  query(text, params = []) {
    return this.run(() => this.#extended(text, params));
  }
  simple(text) {
    return this.run(() => this.#simple(text));
  }
  async #collect() {
    let columns = [],
      rows = [],
      rowCount = 0,
      error = null;
    for (;;) {
      const { type, body } = await this.next();
      if (type === "T") {
        const count = body.readInt16BE(0);
        columns = [];
        let i = 2;
        for (let c = 0; c < count; c++) {
          const end = body.indexOf(0, i);
          const name = body.toString("utf8", i, end);
          i = end + 1;
          const oid = body.readInt32BE(i + 6);
          columns.push({ name, oid });
          i += 18;
        }
      } else if (type === "D") {
        const count = body.readInt16BE(0);
        const row = {};
        let i = 2;
        for (let c = 0; c < count; c++) {
          const len = body.readInt32BE(i);
          i += 4;
          const text = len === -1 ? null : body.toString("utf8", i, i + len);
          if (len > 0) i += len;
          row[columns[c].name] = parseValue(columns[c].oid, text);
        }
        rows.push(row);
      } else if (type === "C") {
        const tag = body.toString("utf8", 0, body.length - 1);
        const n = Number(tag.split(" ").at(-1));
        rowCount += Number.isFinite(n) ? n : 0;
      } else if (type === "E") {
        error = new PgError(Connection.fields(body));
      } else if (type === "Z") {
        if (error) throw error;
        return { rows, rowCount };
      }
    }
  }
  async #extended(text, params) {
    if (this.closed) throw this.error || new Error("Connection closed");
    const encoded = params.map(encodeParam);
    const parse = new Writer().cstr("").cstr(text).int16(encoded.length);
    for (const p of encoded) parse.int32(p.oid);
    const bind = new Writer().cstr("").cstr("").int16(0).int16(encoded.length);
    for (const p of encoded) {
      if (p.text === null) bind.int32(-1);
      else {
        const b = Buffer.from(p.text, "utf8");
        bind.int32(b.length).bytes(b);
      }
    }
    bind.int16(0);
    this.socket.write(
      Buffer.concat([
        parse.message("P"),
        bind.message("B"),
        new Writer().bytes(Buffer.from("P")).cstr("").message("D"),
        new Writer().cstr("").int32(0).message("E"),
        new Writer().message("S"),
      ]),
    );
    return this.#collect();
  }
  async #simple(text) {
    if (this.closed) throw this.error || new Error("Connection closed");
    this.socket.write(new Writer().cstr(text).message("Q"));
    return this.#collect();
  }
  async end() {
    if (this.closed) return;
    this.closed = true;
    try {
      this.socket.end(new Writer().message("X"));
    } catch {}
  }
}

export class Pool {
  constructor(config, size = 5) {
    this.config = typeof config === "string" ? parseConnectionString(config) : config;
    this.size = size;
    this.idle = [];
    this.total = 0;
    this.waiting = [];
  }
  async acquire() {
    while (this.idle.length) {
      const c = this.idle.pop();
      if (!c.closed) return c;
      this.total--;
    }
    if (this.total < this.size) {
      this.total++;
      try {
        return await new Connection(this.config).connect();
      } catch (error) {
        this.total--;
        throw error;
      }
    }
    return new Promise((resolve) => this.waiting.push(resolve));
  }
  release(connection) {
    if (connection.closed) {
      this.total--;
      if (this.waiting.length) this.acquire().then(this.waiting.shift());
      return;
    }
    const waiter = this.waiting.shift();
    if (waiter) waiter(connection);
    else this.idle.push(connection);
  }
  async query(text, params) {
    const c = await this.acquire();
    try {
      return await c.query(text, params);
    } finally {
      this.release(c);
    }
  }
  async transaction(fn) {
    const c = await this.acquire();
    try {
      await c.simple("BEGIN");
      try {
        const result = await fn(c);
        await c.simple("COMMIT");
        return result;
      } catch (error) {
        await c.simple("ROLLBACK").catch(() => {});
        throw error;
      }
    } finally {
      this.release(c);
    }
  }
  async end() {
    for (const c of this.idle.splice(0)) await c.end();
  }
}
