import { screenshotSourceId, legacyScreenshotSourceId } from "./screenshot-source.js?v=31";
import { state } from "./state.js?v=31";
import { renderProfile, cloudFetch, persistBudget } from "./sync.js?v=31";
import { liveRecords } from "./sync-core.js?v=31";
import { backupFile } from "./backup-ui.js?v=31";
export function openVault() {
  if (state.vaultConnection) return Promise.resolve(state.vaultConnection);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("finance-screenshots", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("files", { keyPath: "key" });
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      state.vaultConnection = request.result;
      resolve(state.vaultConnection);
    };
  });
}
export async function vaultWrite(record, previousKey) {
  const connection = await openVault();
  return new Promise((resolve, reject) => {
    const tx = connection.transaction("files", "readwrite");
    tx.objectStore("files").put(record);
    if (previousKey && previousKey !== record.key) tx.objectStore("files").delete(previousKey);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || Error("Сохранение прервано"));
  });
}
export async function vaultAll() {
  const connection = await openVault();
  return new Promise((resolve, reject) => {
    const tx = connection.transaction("files", "readonly"),
      request = tx.objectStore("files").getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function archiveImportedScreenshots(files, rows) {
  const sources = new Set(rows.map((o) => o.sourceId).filter(Boolean)),
    owner = state.cloudSession?.user?.id || "guest",
    selected = [];
  for (const file of files)
    if (sources.has(legacyScreenshotSourceId(file)) || sources.has(await screenshotSourceId(file)))
      selected.push(file);
  if (!selected.length) return true;
  state.pendingScreenshotArchives.push({ files: selected, owner, sources: [...sources] });
  return retryScreenshotArchives();
}
export function renderScreenshotStorageNotice() {
  const banner = document.getElementById("storagebanner");
  if (banner) banner.hidden = !state.pendingScreenshotArchives.length;
}
export function retryScreenshotArchives() {
  if (state.vaultArchiveJob) return state.vaultArchiveJob;
  state.vaultArchiveJob = runScreenshotArchive().finally(() => {
    state.vaultArchiveJob = null;
  });
  return state.vaultArchiveJob;
}
export async function runScreenshotArchive() {
  if (state.vaultArchiving) return false;
  state.vaultArchiving = true;
  try {
    while (state.pendingScreenshotArchives.length) {
      const record = state.pendingScreenshotArchives[0];
      for (const file of record.files) {
        const sourceId =
          record.sources?.find((source) => source === legacyScreenshotSourceId(file)) ||
          (await screenshotSourceId(file));
        await vaultWrite({
          key: record.owner + "::" + sourceId,
          owner: record.owner,
          sourceId,
          name: file.name,
          blob: file,
          createdAt: new Date().toISOString(),
          cloudFileId: null,
        });
      }
      state.pendingScreenshotArchives.shift();
    }
    state.vaultError = "";
    uploadQueuedScreenshots();
    return true;
  } catch (error) {
    state.vaultError =
      "Операции добавлены, но исходные скриншоты пока не сохранены. Не закрывайте страницу и повторите сохранение.";
    return false;
  } finally {
    state.vaultArchiving = false;
    renderScreenshotStorageNotice();
    if (state.page === "Личный кабинет") renderProfile();
  }
}
export function uploadQueuedScreenshots() {
  if (state.vaultUploadJob) return state.vaultUploadJob;
  state.vaultUploadJob = runScreenshotUpload().finally(() => {
    state.vaultUploadJob = null;
  });
  return state.vaultUploadJob;
}
export async function runScreenshotUpload() {
  if (state.cloudLogoutBusy && !state.privacyAllowJobs) return;
  if (
    state.backupBusy ||
    !state.cloudIdentityVerified ||
    !state.cloudSession?.user ||
    state.vaultUploading
  )
    return;
  state.vaultUploading = true;
  const owner = state.cloudSession.user.id;
  try {
    const records = await vaultAll(),
      sources = new Set(
        liveRecords("ops")
          .map((o) => o.sourceId)
          .filter(Boolean),
      );
    for (const record of records) {
      if (
        (record.owner !== owner && record.owner !== "guest") ||
        (!sources.has(record.sourceId) && !(record.owner === owner && record.archiveStandalone))
      )
        continue;
      if (!record.cloudFileId) {
        const form = new FormData();
        form.append("file", record.blob, record.name);
        form.append("sourceId", record.sourceId);
        const result = await cloudFetch("/api/files", { method: "POST", body: form });
        if (state.cloudSession?.user?.id !== owner) break;
        const previousKey = record.key;
        record.cloudFileId = result.id;
        record.owner = owner;
        record.key = owner + "::" + record.sourceId;
        await vaultWrite(record, previousKey);
      }
      if (state.cloudSession?.user?.id !== owner) break;
      let changed = false;
      for (const o of liveRecords("ops"))
        if (o.sourceId === record.sourceId && o.screenshotId !== record.cloudFileId) {
          o.screenshotId = record.cloudFileId;
          delete o.screenshotUnavailable;
          delete o.originalScreenshotId;
          changed = true;
        }
      if (changed) persistBudget(state.db);
    }
    state.vaultError = "";
  } catch (error) {
    state.vaultError = "Скриншоты пока не отправлены: " + error.message;
  } finally {
    state.vaultUploading = false;
    if (state.page === "Личный кабинет") renderProfile();
  }
}
export async function vaultWriteBatch(records) {
  if (!records.length) return;
  const connection = await openVault();
  return new Promise((resolve, reject) => {
    const tx = connection.transaction("files", "readwrite");
    for (const record of records) tx.objectStore("files").put(record);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || Error("Не удалось сохранить скриншоты"));
  });
}
export async function claimGuestArchivesForMigration() {
  if (!state.cloudSession?.user) return;
  const owner = state.cloudSession.user.id;
  for (const record of await vaultAll())
    if (
      record.owner === "guest" &&
      (record.archiveStandalone ||
        liveRecords("ops").some((operation) => operation.sourceId === record.sourceId))
    ) {
      const previous = record.key;
      record.owner = owner;
      record.key = owner + "::" + record.sourceId;
      await vaultWrite(record, previous);
    }
}
export async function openLocalScreenshot(source) {
  const owner = state.cloudSession?.user?.id || "guest",
    dialog = document.getElementById("screenshotpreview"),
    content = document.getElementById("screenshotpreviewcontent");
  content.textContent = "Загружаем скриншот…";
  dialog.showModal();
  try {
    const records = await vaultAll(),
      record = records.find((r) => r.sourceId === source && r.owner === owner),
      operation = liveRecords("ops").find((o) => o.sourceId === source);
    let blob = record?.blob;
    if (
      !blob &&
      operation?.screenshotId &&
      state.cloudIdentityVerified &&
      owner !== "guest" &&
      true
    )
      blob = await backupFile(operation.screenshotId, owner);
    if (!blob) throw Error("Исходный скриншот не найден на этом устройстве.");
    if (owner !== (state.cloudSession?.user?.id || "guest") || !dialog.open) return;
    if (state.localScreenshotURL) URL.revokeObjectURL(state.localScreenshotURL);
    state.localScreenshotURL = URL.createObjectURL(blob);
    const img = document.createElement("img");
    img.src = state.localScreenshotURL;
    img.alt = record?.name || operation?.name || "Скриншот";
    content.replaceChildren(img);
    dialog.onclose = () => {
      if (state.localScreenshotURL) URL.revokeObjectURL(state.localScreenshotURL);
      state.localScreenshotURL = null;
    };
  } catch (error) {
    content.textContent = error.message;
  }
}
export async function vaultDeleteOwned(owner, fileId) {
  const records = (await vaultAll()).filter(
    (record) => record.owner === owner && (!fileId || record.cloudFileId === fileId),
  );
  if (!records.length) return;
  const connection = await openVault();
  return new Promise((resolve, reject) => {
    const tx = connection.transaction("files", "readwrite");
    for (const record of records) tx.objectStore("files").delete(record.key);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || Error("Не удалось очистить скриншоты устройства"));
  });
}
