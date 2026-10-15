// Encrypted file storage on local disk with an R2-compatible subset
// (put / get / delete) used by server/budget.ts.
// Each object: "FIN1" | 12-byte IV | AES-256-GCM ciphertext | 16-byte tag.
// The object key is bound as additional authenticated data, so a file
// cannot be swapped under another key without detection.
import crypto from "node:crypto";
import { mkdir, readFile, writeFile, rm, rename } from "node:fs/promises";
import path from "node:path";

const MAGIC = Buffer.from("FIN1");

export class FileStore {
  constructor(root, keyHex) {
    if (!/^[0-9a-f]{64}$/i.test(keyHex || "")) throw new Error("FILES_KEY must be 64 hex characters (32 bytes)");
    this.root = path.resolve(root);
    this.key = Buffer.from(keyHex, "hex");
  }
  #path(key) {
    if (typeof key !== "string" || !/^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*$/.test(key) || key.length > 300)
      throw new Error("Invalid object key");
    const full = path.resolve(this.root, key + ".bin");
    if (!full.startsWith(this.root + path.sep)) throw new Error("Invalid object key");
    return full;
  }
  async put(key, bytes, options = {}) {
    const file = this.#path(key);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(key));
    const meta = Buffer.from(JSON.stringify({ contentType: options.httpMetadata?.contentType || "application/octet-stream" }));
    const header = Buffer.alloc(4);
    header.writeUInt32BE(meta.length);
    const plain = Buffer.concat([header, meta, Buffer.from(bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes)]);
    const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const temp = file + "." + crypto.randomBytes(6).toString("hex") + ".tmp";
    await writeFile(temp, Buffer.concat([MAGIC, iv, encrypted, cipher.getAuthTag()]), { mode: 0o600 });
    await rename(temp, file);
  }
  async get(key) {
    let raw;
    try {
      raw = await readFile(this.#path(key));
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
    if (!raw.subarray(0, 4).equals(MAGIC)) throw new Error("Corrupted object");
    const iv = raw.subarray(4, 16),
      tag = raw.subarray(raw.length - 16),
      body = raw.subarray(16, raw.length - 16);
    const decipher = crypto.createDecipheriv("aes-256-gcm", this.key, iv);
    decipher.setAAD(Buffer.from(key));
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(body), decipher.final()]);
    const metaLength = plain.readUInt32BE(0);
    const meta = JSON.parse(plain.subarray(4, 4 + metaLength).toString("utf8"));
    const content = plain.subarray(4 + metaLength);
    return { body: content, size: content.length, httpMetadata: { contentType: meta.contentType } };
  }
  async delete(keys) {
    for (const key of Array.isArray(keys) ? keys : [keys]) await rm(this.#path(key), { force: true });
  }
}
