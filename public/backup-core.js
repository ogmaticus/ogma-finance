import { BudgetSchema } from "./budget-schema.js?v=31";
import { FinanceData } from "./data-model.js?v=31";
import { FinanceZip } from "./backup-zip.js?v=31";
export const FinanceBackup = (() => {
  const encoder = new TextEncoder();
  function validateBudget(input) {
    return BudgetSchema.parse(input);
  }
  async function digest(blob) {
    return Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())),
      (b) => b.toString(16).padStart(2, "0"),
    ).join("");
  }
  async function mime(blob) {
    if (blob.size < 8 || blob.size > 10485760) throw Error("Размер скриншота должен быть до 10 МБ");
    const b = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
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
    throw Error("В копии найден неподдерживаемый скриншот");
  }
  async function create(input, images, onProgress = () => {}) {
    const data = FinanceData.exportData(BudgetSchema.parse(input, { allowOversizeRead: true }));
    const grouped = new Map();
    for (let i = 0; i < images.length; i++) {
      const image = images[i],
        kind = await mime(image.blob),
        sha = await digest(image.blob);
      let entry = grouped.get(sha);
      if (!entry) {
        entry = {
          path:
            "screenshots/" +
            sha +
            { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp" }[kind],
          sha256: sha,
          name: String(image.name || "Скриншот").slice(0, 160),
          mime: kind,
          size: image.blob.size,
          sourceIds: [],
          screenshotIds: [],
          blob: image.blob,
          createdAt: image.createdAt || new Date().toISOString(),
        };
        grouped.set(sha, entry);
      }
      entry.sourceIds = [...new Set([...entry.sourceIds, ...(image.sourceIds || [])])];
      entry.screenshotIds = [...new Set([...entry.screenshotIds, ...(image.screenshotIds || [])])];
      onProgress(i + 1, images.length);
    }
    const all = [...grouped.values()],
      sourceOwners = new Map(),
      screenOwners = new Map();
    for (const f of all) {
      for (const alias of f.sourceIds) {
        if (!sourceOwners.has(alias)) sourceOwners.set(alias, f);
        else if (sourceOwners.get(alias) !== f) sourceOwners.set(alias, null);
      }
      for (const alias of f.screenshotIds) {
        if (screenOwners.has(alias) && screenOwners.get(alias) !== f)
          throw Error("Неоднозначный источник скриншота");
        screenOwners.set(alias, f);
      }
    }
    for (const f of all) f.sourceIds = f.sourceIds.filter((alias) => sourceOwners.get(alias) === f);
    const sources = new Set(all.flatMap((f) => f.sourceIds)),
      screens = new Set(all.flatMap((f) => f.screenshotIds)),
      missingImages = data.ops
        .filter(
          (o) =>
            (o.sourceId || o.screenshotId) &&
            !(
              (o.screenshotId && screens.has(o.screenshotId)) ||
              (o.sourceId && sources.has(o.sourceId))
            ),
        )
        .map((o) => ({
          operationId: o.id,
          sourceId: o.sourceId || "",
          screenshotId: o.screenshotId || "",
        }));
    if (all.length > 10000) throw Error("Для одной копии поддерживается до 10 000 изображений");
    const manifest = {
      format: "finance-full-backup",
      version: 1,
      exportedAt: new Date().toISOString(),
      images: all.map(({ blob, ...rest }) => rest),
      missingImages,
    };
    if (encoder.encode(JSON.stringify(manifest)).length > 16777216)
      throw Error("Описание копии слишком большое");
    return {
      manifest,
      entries: [
        {
          name: "manifest.json",
          blob: new Blob([JSON.stringify(manifest)], { type: "application/json" }),
        },
        {
          name: "budget.json",
          blob: new Blob([JSON.stringify(data)], { type: "application/json" }),
        },
        ...all.map((f) => ({ name: f.path, blob: f.blob })),
      ],
    };
  }
  async function read(file, onProgress = () => {}) {
    const zip = await FinanceZip.open(file);
    let manifest, data;
    try {
      manifest = JSON.parse(await (await zip.read("manifest.json")).text());
      data = validateBudget(JSON.parse(await (await zip.read("budget.json")).text()));
    } catch (error) {
      throw Error("Копия не прошла проверку: " + error.message);
    }
    if (
      manifest?.format !== "finance-full-backup" ||
      manifest.version !== 1 ||
      !Array.isArray(manifest.images) ||
      manifest.images.length > 10000 ||
      !Array.isArray(manifest.missingImages) ||
      manifest.missingImages.length > 20000
    )
      throw Error("Неподдерживаемая версия копии");
    if (zip.entries.size !== manifest.images.length + 2)
      throw Error("Состав файлов не совпадает с описанием копии");
    const paths = new Set(),
      sourceMap = new Map(),
      screenMap = new Map(),
      images = [];
    for (let i = 0; i < manifest.images.length; i++) {
      const item = manifest.images[i];
      if (
        !item ||
        typeof item.path !== "string" ||
        paths.has(item.path) ||
        typeof item.name !== "string" ||
        item.name.length > 160 ||
        (item.createdAt !== undefined &&
          (typeof item.createdAt !== "string" ||
            item.createdAt.length > 40 ||
            !Number.isFinite(Date.parse(item.createdAt)))) ||
        !/^[a-f0-9]{64}$/.test(item.sha256) ||
        !Array.isArray(item.sourceIds) ||
        !Array.isArray(item.screenshotIds) ||
        item.sourceIds.length > 20000 ||
        item.screenshotIds.length > 20000 ||
        ![...item.sourceIds, ...item.screenshotIds].every(
          (s) => typeof s === "string" && s.length <= 400,
        )
      )
        throw Error("Некорректное описание скриншота");
      const blob = await zip.read(item.path),
        kind = await mime(blob);
      if (
        kind !== item.mime ||
        item.size !== blob.size ||
        (await digest(blob)) !== item.sha256 ||
        item.path !==
          "screenshots/" +
            item.sha256 +
            { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp" }[kind]
      )
        throw Error("Скриншот повреждён или не соответствует описанию");
      paths.add(item.path);
      const image = { ...item, blob: blob.slice(0, blob.size, kind) };
      images.push(image);
      for (const [values, map] of [
        [item.sourceIds, sourceMap],
        [item.screenshotIds, screenMap],
      ])
        for (const alias of values) {
          if (map.has(alias) && map.get(alias) !== image)
            throw Error("Неоднозначная связь скриншота с операцией");
          map.set(alias, image);
        }
      onProgress(i + 1, manifest.images.length);
    }
    return { data, manifest, images, sourceMap, screenMap };
  }
  function remap(data, images) {
    const sources = new Map(),
      screens = new Map();
    for (const image of images) {
      for (const alias of image.sourceIds) sources.set(alias, image);
      for (const alias of image.screenshotIds) screens.set(alias, image);
    }
    const restored = JSON.parse(JSON.stringify(data));
    for (const o of restored.ops) {
      const image = screens.get(o.screenshotId) || sources.get(o.sourceId);
      if (image) {
        o.sourceId = "backup-" + image.sha256;
        if (image.cloudFileId) o.screenshotId = image.cloudFileId;
        else delete o.screenshotId;
        o.localScreenshot = true;
        delete o.screenshotUnavailable;
        delete o.originalScreenshotId;
      } else if (o.sourceId || o.screenshotId) {
        if (o.screenshotId) o.originalScreenshotId = o.screenshotId;
        delete o.screenshotId;
        o.screenshotUnavailable = true;
      }
    }
    return restored;
  }
  return { validateBudget, digest, mime, create, read, remap };
})();
