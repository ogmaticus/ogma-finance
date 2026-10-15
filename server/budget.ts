import { legacyMoneyView } from "../public/legacy-money.js";
import { readLimitedBody, BodyLimitError } from "./request-body";
import { FinanceData as DataModel } from "../public/data-model.js";
import { BudgetSchema, BUDGET_MAX_BYTES, BUDGET_SIZE_MESSAGE } from "../public/budget-schema.js";
export type Identity = { userId: string } | null;
export type StorageEnv = { DB?: D1Database; BUCKET?: R2Bucket };
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store", Vary: "Cookie" } });
}
export function ownerOf(identity: Identity) {
  if (!identity) throw new ApiError(401, "Войдите в аккаунт");
  return identity.userId;
}
function checkExpectedOwner(request: Request, owner: string) {
  const expected = request.headers.get("X-Finance-Owner");
  if (expected && expected !== owner)
    throw new ApiError(
      401,
      "Аккаунт изменился. Синхронизируйте после входа; изменения сохранены на устройстве.",
    );
}
function database(env: StorageEnv) {
  if (!env.DB) throw new ApiError(503, "Хранилище бюджета недоступно");
  return env.DB;
}
function bucket(env: StorageEnv) {
  if (!env.BUCKET) throw new ApiError(503, "Хранилище скриншотов недоступно");
  return env.BUCKET;
}
export function checkOrigin(request: Request) {
  if (request.headers.get("Origin") !== new URL(request.url).origin)
    throw new ApiError(403, "Запрос разрешён только из приложения");
}
function object(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function identifier(value: unknown) {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,160}$/.test(value);
}
export function validateBudget(input: unknown) {
  try {
    return JSON.stringify(BudgetSchema.parse(input));
  } catch (error) {
    throw new ApiError(
      error instanceof Error && "code" in error && error.code === "budget_too_large" ? 413 : 400,
      error instanceof Error ? error.message : "Некорректный бюджет",
    );
  }
}
type OwnerState = { generation: number; deleting: number };
async function ownerState(db: D1Database, owner: string): Promise<OwnerState> {
  return (
    (await db
      .prepare("SELECT generation, deleting FROM owner_data_state WHERE owner = ?")
      .bind(owner)
      .first<OwnerState>()) || { generation: 0, deleting: 0 }
  );
}
function checkGeneration(request: Request, state: OwnerState) {
  const expected = request.headers.get("X-Finance-Generation");
  if (state.deleting)
    throw new ApiError(
      409,
      "Удаление данных ещё не завершено. Повторите удаление в личном кабинете.",
    );
  if ((expected === null ? 0 : Number(expected)) !== state.generation)
    throw new ApiError(
      409,
      "Данные аккаунта были удалены на другом устройстве. Обновите приложение перед новым сохранением.",
    );
}
const generationWhere =
  "COALESCE((SELECT generation FROM owner_data_state WHERE owner = ?),0) = ? AND COALESCE((SELECT deleting FROM owner_data_state WHERE owner = ?),0) = 0";
export async function handleBudget(request: Request, identity: Identity, env: StorageEnv) {
  const owner = ownerOf(identity);
  checkExpectedOwner(request, owner);
  const db = database(env),
    state = await ownerState(db, owner);
  if (request.method === "GET") {
    const row = await db
      .prepare("SELECT revision, data, updated_at FROM budget_documents WHERE owner = ?")
      .bind(owner)
      .first<{ revision: number; data: string; updated_at: string }>();
    return json({
      ...(row
        ? {
            revision: row.revision,
            data:
              request.headers.get("X-Finance-Schema") === "3"
                ? DataModel.normalize(JSON.parse(row.data))
                : legacyMoneyView(DataModel.normalize(JSON.parse(row.data))),
            updatedAt: row.updated_at,
          }
        : { revision: 0, data: null, updatedAt: null }),
      generation: state.generation,
      deleting: Boolean(state.deleting),
    });
  }
  if (request.method === "DELETE") {
    checkOrigin(request);
    if (!state.deleting) {
      const claimed = await db
        .prepare(
          "INSERT INTO owner_data_state (owner,generation,deleting) VALUES (?,1,1) ON CONFLICT(owner) DO UPDATE SET generation=owner_data_state.generation+1,deleting=1 WHERE owner_data_state.deleting=0 RETURNING generation",
        )
        .bind(owner)
        .first<{ generation: number }>();
      if (!claimed) throw new ApiError(409, "Удаление уже выполняется");
      state.generation = claimed.generation;
    }
    const files = await db
      .prepare("SELECT object_key FROM screenshot_files WHERE owner = ?")
      .bind(owner)
      .all<{ object_key: string }>();
    for (let i = 0; i < files.results.length; i += 100)
      await bucket(env).delete(files.results.slice(i, i + 100).map((file) => file.object_key));
    await db.batch([
      db.prepare("DELETE FROM screenshot_files WHERE owner = ?").bind(owner),
      db.prepare("DELETE FROM budget_versions WHERE owner = ?").bind(owner),
      db.prepare("DELETE FROM budget_documents WHERE owner = ?").bind(owner),
      db
        .prepare("UPDATE owner_data_state SET deleting=0 WHERE owner = ? AND generation = ?")
        .bind(owner, state.generation),
    ]);
    return json({ deleted: true, generation: state.generation });
  }
  if (request.method !== "PUT") throw new ApiError(405, "Метод недоступен");
  checkOrigin(request);
  checkGeneration(request, state);
  if (Number(request.headers.get("Content-Length") || 0) > BUDGET_MAX_BYTES + 65536)
    throw new ApiError(413, BUDGET_SIZE_MESSAGE);
  let body: any;
  try {
    body = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        await readLimitedBody(request, BUDGET_MAX_BYTES + 65536),
      ),
    );
  } catch (error) {
    if (error instanceof BodyLimitError) throw new ApiError(413, BUDGET_SIZE_MESSAGE);
    throw new ApiError(400, "Некорректный JSON");
  }
  if (
    !object(body) ||
    !Number.isInteger(body.revision) ||
    body.revision < 0 ||
    (body.snapshot !== undefined && typeof body.snapshot !== "boolean")
  )
    throw new ApiError(400, "Некорректная версия");
  const encoded = validateBudget(body.data),
    now = new Date().toISOString(),
    snapshotCutoff = new Date(Date.parse(now) - 30 * 60000).toISOString(),
    monthCutoff = new Date(now);
  monthCutoff.setUTCDate(1);
  monthCutoff.setUTCMonth(monthCutoff.getUTCMonth() - 11);
  monthCutoff.setUTCHours(0, 0, 0, 0);
  let revision: number | undefined;
  if (body.revision === 0) {
    const result = await db
      .prepare(
        `INSERT INTO budget_documents (owner,revision,data,updated_at) SELECT ?,1,?,? WHERE ${generationWhere} ON CONFLICT(owner) DO NOTHING RETURNING revision`,
      )
      .bind(owner, encoded, now, owner, state.generation, owner)
      .first<{ revision: number }>();
    revision = result?.revision;
  } else {
    const result = await db.batch([
      db
        .prepare(
          `INSERT INTO budget_versions (owner,revision,data,created_at) SELECT owner,revision,data,? FROM budget_documents WHERE owner = ? AND revision = ? AND ${generationWhere} AND (? = 1 OR NOT EXISTS(SELECT 1 FROM budget_versions WHERE owner = ? AND created_at > ?)) ON CONFLICT(owner,revision) DO NOTHING`,
        )
        .bind(
          now,
          owner,
          body.revision,
          owner,
          state.generation,
          owner,
          body.snapshot ? 1 : 0,
          owner,
          snapshotCutoff,
        ),
      db
        .prepare(
          `UPDATE budget_documents SET data = ?,revision = revision+1,updated_at = ? WHERE owner = ? AND revision = ? AND ${generationWhere} RETURNING revision`,
        )
        .bind(encoded, now, owner, body.revision, owner, state.generation, owner),
      db
        .prepare(
          "DELETE FROM budget_versions WHERE owner = ? AND revision NOT IN (SELECT revision FROM budget_versions WHERE owner = ? ORDER BY created_at DESC,revision DESC LIMIT 30) AND revision NOT IN (SELECT MAX(revision) FROM budget_versions WHERE owner = ? AND created_at >= ? GROUP BY substr(created_at,1,7))",
        )
        .bind(owner, owner, owner, monthCutoff.toISOString()),
    ]);
    revision = (result[1].results[0] as { revision: number } | undefined)?.revision;
  }
  if (!revision)
    return json(
      {
        error: "Бюджет изменён на другом устройстве. Обе версии нужно сверить.",
        code: "revision_conflict",
      },
      409,
    );
  return json({ revision, updatedAt: now, generation: state.generation });
}
export async function handleBackups(request: Request, identity: Identity, env: StorageEnv) {
  const owner = ownerOf(identity);
  checkExpectedOwner(request, owner);
  const db = database(env),
    query = new URL(request.url).searchParams,
    version = query.get("revision");
  if (version) {
    const revision = Number(version);
    if (!Number.isInteger(revision) || revision < 1) throw new ApiError(400, "Некорректная версия");
    const row = await db
      .prepare(
        "SELECT revision, data, created_at FROM budget_versions WHERE owner = ? AND revision = ?",
      )
      .bind(owner, revision)
      .first<{ revision: number; data: string; created_at: string }>();
    if (!row) throw new ApiError(404, "Копия не найдена");
    return json({
      revision: row.revision,
      data:
        request.headers.get("X-Finance-Schema") === "3"
          ? DataModel.normalize(JSON.parse(row.data))
          : legacyMoneyView(DataModel.normalize(JSON.parse(row.data))),
      createdAt: row.created_at,
    });
  }
  const result = await db
    .prepare(
      "SELECT revision, created_at FROM budget_versions WHERE owner = ? ORDER BY revision DESC LIMIT 42",
    )
    .bind(owner)
    .all();
  return json({ versions: result.results });
}
async function hash(bytes: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function imageMime(bytes: ArrayBuffer) {
  const b = new Uint8Array(bytes);
  if (
    b[0] === 137 &&
    b[1] === 80 &&
    b[2] === 78 &&
    b[3] === 71 &&
    b[4] === 13 &&
    b[5] === 10 &&
    b[6] === 26 &&
    b[7] === 10
  )
    return "image/png";
  if (b[0] === 255 && b[1] === 216 && b[2] === 255) return "image/jpeg";
  if (
    String.fromCharCode(...b.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...b.slice(8, 12)) === "WEBP"
  )
    return "image/webp";
  throw new ApiError(400, "Разрешены изображения PNG, JPG или WebP");
}
export async function handleFiles(request: Request, identity: Identity, env: StorageEnv) {
  const owner = ownerOf(identity);
  checkExpectedOwner(request, owner);
  const db = database(env);
  if (request.method === "GET") {
    const cursor = new URL(request.url).searchParams.get("cursor");
    let point: string[] | null = null;
    if (cursor) {
      if (cursor.length > 512) throw new ApiError(400, "Некорректный указатель архива");
      try {
        point = JSON.parse(atob(cursor));
      } catch {
        throw new ApiError(400, "Некорректный указатель архива");
      }
      if (
        !Array.isArray(point) ||
        point.length !== 2 ||
        !/^\d{4}-\d{2}-\d{2}T[0-9:.]+Z$/.test(point[0]) ||
        !identifier(point[1])
      )
        throw new ApiError(400, "Некорректный указатель архива");
    }
    const statement = point
      ? db
          .prepare(
            "SELECT id, name, mime, size, source_id, created_at FROM screenshot_files WHERE owner = ? AND (created_at < ? OR (created_at = ? AND id < ?)) ORDER BY created_at DESC, id DESC LIMIT 101",
          )
          .bind(owner, point[0], point[0], point[1])
      : db
          .prepare(
            "SELECT id, name, mime, size, source_id, created_at FROM screenshot_files WHERE owner = ? ORDER BY created_at DESC, id DESC LIMIT 101",
          )
          .bind(owner);
    const result = await statement.all(),
      files = result.results.slice(0, 100),
      last = files.at(-1) as { created_at: string; id: string } | undefined;
    return json({
      files,
      nextCursor:
        result.results.length > 100 && last
          ? btoa(JSON.stringify([last.created_at, last.id]))
          : null,
    });
  }
  if (request.method !== "POST") throw new ApiError(405, "Метод недоступен");
  checkOrigin(request);
  const state = await ownerState(db, owner);
  checkGeneration(request, state);
  if (Number(request.headers.get("Content-Length") || 0) > 11 * 1024 * 1024)
    throw new ApiError(413, "Изображение больше 10 МБ");
  const limited = await readLimitedBody(request, 11 * 1024 * 1024);
  const form = await new Response(limited.buffer as ArrayBuffer, {
      headers: { "Content-Type": request.headers.get("Content-Type") || "" },
    }).formData(),
    file = form.get("file");
  if (!(file instanceof File) || file.size < 8 || file.size > 10 * 1024 * 1024)
    throw new ApiError(400, "Выберите изображение до 10 МБ");
  const bytes = await file.arrayBuffer(),
    mime = imageMime(bytes),
    digest = await hash(bytes),
    sourceId = String(form.get("sourceId") || "").slice(0, 400);
  const existing = await db
    .prepare("SELECT id FROM screenshot_files WHERE owner = ? AND hash = ?")
    .bind(owner, digest)
    .first<{ id: string }>();
  checkGeneration(request, await ownerState(db, owner));
  if (existing) return json({ id: existing.id, reused: true });
  const id = crypto.randomUUID(),
    prefix = await hash(new TextEncoder().encode(owner).buffer),
    key = prefix + "/" + state.generation + "/" + digest,
    now = new Date().toISOString();
  await bucket(env).put(key, bytes, { httpMetadata: { contentType: mime } });
  await db
    .prepare(
      `INSERT INTO screenshot_files (id, owner, hash, object_key, name, mime, size, source_id, created_at) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${generationWhere} ON CONFLICT(owner,hash) DO NOTHING`,
    )
    .bind(
      id,
      owner,
      digest,
      key,
      file.name.replace(/[\r\n\\/]/g, "_").slice(0, 160),
      mime,
      file.size,
      sourceId,
      now,
      owner,
      state.generation,
      owner,
    )
    .run();
  const after = await ownerState(db, owner);
  if (after.deleting || after.generation !== state.generation) {
    await bucket(env).delete(key);
    throw new ApiError(409, "Данные аккаунта были удалены. Скриншот не сохранён.");
  }
  const saved = await db
    .prepare("SELECT id FROM screenshot_files WHERE owner = ? AND hash = ?")
    .bind(owner, digest)
    .first<{ id: string }>();
  return json({ id: saved!.id });
}
export async function handleFile(
  request: Request,
  identity: Identity,
  env: StorageEnv,
  id: string,
) {
  const owner = ownerOf(identity);
  checkExpectedOwner(request, owner);
  if (!identifier(id)) throw new ApiError(400, "Некорректный файл");
  const row = await database(env)
    .prepare("SELECT object_key, mime, name FROM screenshot_files WHERE owner = ? AND id = ?")
    .bind(owner, id)
    .first<{ object_key: string; mime: string; name: string }>();
  if (!row) throw new ApiError(404, "Файл не найден");
  if (request.method === "DELETE") {
    checkOrigin(request);
    checkGeneration(request, await ownerState(database(env), owner));
    await bucket(env).delete(row.object_key);
    await database(env)
      .prepare("DELETE FROM screenshot_files WHERE owner = ? AND id = ?")
      .bind(owner, id)
      .run();
    for (let attempt = 0; attempt < 4; attempt++) {
      const budget = await database(env)
        .prepare("SELECT revision,data FROM budget_documents WHERE owner = ?")
        .bind(owner)
        .first<{ revision: number; data: string }>();
      if (!budget) break;
      const data = DataModel.normalize(JSON.parse(budget.data));
      data.removedScreenshotIds = { ...data.removedScreenshotIds, [id]: new Date().toISOString() };
      for (const operation of data.ops)
        if (operation.screenshotId === id) {
          delete operation.screenshotId;
          operation.screenshotUnavailable = true;
          operation.updatedAt = new Date().toISOString();
        }
      const result = await database(env)
        .prepare(
          "UPDATE budget_documents SET data = ?,revision=revision+1,updated_at=? WHERE owner=? AND revision=? RETURNING revision",
        )
        .bind(validateBudget(data), new Date().toISOString(), owner, budget.revision)
        .first();
      if (result) break;
      if (attempt === 3)
        throw new ApiError(409, "Скриншот удалён, обновите бюджет для очистки ссылок.");
    }
    return json({ deleted: true });
  }
  if (request.method !== "GET") throw new ApiError(405, "Метод недоступен");
  const object = await bucket(env).get(row.object_key);
  if (!object) throw new ApiError(404, "Файл не найден");
  return new Response(object.body, {
    headers: {
      "Content-Type": row.mime,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Content-Disposition": "inline",
    },
  });
}
export async function safeResponse(run: () => Promise<Response>, request?: Request) {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ApiError || error instanceof BodyLimitError)
      return json({ error: error.message }, error.status);
    if (
      error instanceof Error &&
      /SQLITE_TOOBIG|string or blob too big|(?:row|string|blob) size.{0,60}(?:limit|exceed)/i.test(
        error.message,
      )
    )
      return json({ error: BUDGET_SIZE_MESSAGE }, 413);
    const requestId = crypto.randomUUID();
    // Only operational messages are logged; exception text from dependencies can contain user values.
    const message =
      error instanceof Error &&
      /^(D1_|R2_|SQLITE_|database|bucket|storage|fetch|network|timeout)/i.test(error.message)
        ? error.message
            .replace(/[\r\n]/g, " ")
            .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email redacted]")
            .replace(/\b(?:SELECT|INSERT|UPDATE|DELETE)\b.*/i, "[SQL redacted]")
            .slice(0, 240)
            .replace(/(['"])[^'"]*\1/g, "[redacted]")
        : "Unexpected service error";
    console.error(
      JSON.stringify({
        requestId,
        method: request?.method || "unknown",
        route: request
          ? new URL(request.url).pathname.replace(/\/api\/files\/[^/]+/, "/api/files/:id")
          : "unknown",
        name: error instanceof Error ? error.name : "unknown",
        message,
      }),
    );
    return json({ error: "Сервис временно недоступен. Данные на устройстве сохранены." }, 503);
  }
}
