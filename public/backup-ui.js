import { screenshotSourceId, legacyScreenshotSourceId } from "./screenshot-source.js?v=34";
import { state } from "./state.js?v=34";
import { animateDialogClose, askConfirm } from "./ui.js?v=34";
import {
  syncBudget,
  cloudFetch,
  hydrateBudget,
  cloudCache,
  persistBudget,
  renderProfile,
  exportBudget,
  restoreBudgetFile,
  refreshProfile,
} from "./sync.js?v=34";
import { vaultAll, vaultWriteBatch, cloudScreenshotsEnabled } from "./file-vault.js?v=34";
import { FinanceBackup } from "./backup-core.js?v=34";
import { FinanceZip } from "./backup-zip.js?v=34";
import { FinanceData } from "./data-model.js?v=34";
import { budgetStorageKey } from "./sync-core.js?v=34";
import { forgetOfflineAccess } from "./pwa.js?v=34";
import { render } from "./app.js?v=34";
export function backupOwner() {
  return state.cloudSession?.user?.id || "guest";
}
export function backupContext(owner) {
  if (backupOwner() !== owner) throw Error("Аккаунт изменился. Повторите действие после входа.");
}
export function setBackupStatus(message) {
  state.backupStatus = message;
  const status = document.getElementById("backupstatus");
  if (status) {
    status.textContent = message;
    status.hidden = !message;
  }
  const dialog = document.getElementById("backupdialog");
  if (dialog?.open) document.getElementById("backupmessage").textContent = message;
}
export function confirmBackupRestore(message) {
  return new Promise((resolve) => {
    const dialog = document.getElementById("backupdialog"),
      form = document.getElementById("backupform"),
      cancel = document.getElementById("backupcancel"),
      confirm = document.getElementById("backupconfirm");
    document.getElementById("backuptitle").textContent = "Восстановить копию?";
    document.getElementById("backupmessage").textContent = message;
    dialog.dataset.phase = "confirm";
    dialog.setAttribute("aria-busy", "false");
    confirm.textContent = "Восстановить";
    confirm.hidden = false;
    cancel.textContent = "Отмена";
    cancel.disabled = false;
    form.onsubmit = (event) => {
      event.preventDefault();
      if (dialog.dataset.phase !== "confirm") return;
      dialog.dataset.phase = "working";
      dialog.setAttribute("aria-busy", "true");
      document.getElementById("backuptitle").textContent = "Восстанавливаем бюджет";
      confirm.hidden = true;
      cancel.disabled = true;
      cancel.textContent = "Подождите…";
      dialog.onclose = null;
      resolve(true);
    };
    cancel.onclick = () => {
      if (dialog.dataset.phase !== "working") animateDialogClose(dialog);
    };
    dialog.onclose = () => {
      dialog.onclose = null;
      resolve(false);
    };
    dialog.showModal();
  });
}
export function finishBackupRestore(success, message) {
  const dialog = document.getElementById("backupdialog");
  if (!dialog) return;
  dialog.dataset.phase = "result";
  dialog.setAttribute("aria-busy", "false");
  document.getElementById("backuptitle").textContent = success
    ? "Бюджет восстановлен"
    : "Не удалось восстановить";
  document.getElementById("backupmessage").textContent = message;
  document.getElementById("backupconfirm").hidden = true;
  const close = document.getElementById("backupcancel");
  close.textContent = "Понятно";
  close.disabled = false;
  close.onclick = () => animateDialogClose(dialog);
  document.getElementById("backupform").onsubmit = (event) => event.preventDefault();
  if (!dialog.open) dialog.showModal();
}
export const backupDialog = document.getElementById("backupdialog");
backupDialog?.addEventListener(
  "cancel",
  (event) => {
    if (backupDialog.dataset.phase === "working") {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  },
  true,
);
export function beginBackup() {
  if (
    state.backupBusy ||
    state.cloudBusy ||
    state.vaultUploading ||
    state.vaultArchiving ||
    state.ocrBusy ||
    state.importSaving
  )
    throw Error("Сначала завершите распознавание или сохранение.");
  state.backupBusy = true;
  clearTimeout(state.cloudTimer);
  const main = document.querySelector("main"),
    prior = Boolean(main?.inert);
  if (main) main.inert = true;
  return () => {
    state.backupBusy = false;
    state.backupAllowSync = false;
    if (main) main.inert = prior;
    if (state.cloudDirty && !state.cloudConflict) state.cloudTimer = setTimeout(syncBudget, 300);
  };
}
export async function backupFile(id, owner) {
  backupContext(owner);
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch("/api/files/" + encodeURIComponent(id), {
      headers: { "X-Finance-Owner": owner },
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) throw Error("Не удалось получить скриншот. Проверьте соединение и аккаунт.");
    backupContext(owner);
    return await response.blob();
  } finally {
    clearTimeout(timer);
  }
}
export async function collectBackupImages(owner, options = {}) {
  const sources = new Map(),
    local = (await vaultAll()).filter((r) => r.owner === owner);
  for (const r of local)
    sources.set(r.sourceId, {
      blob: r.blob,
      name: r.name,
      createdAt: r.createdAt,
      sourceIds: [r.sourceId],
      screenshotIds: r.cloudFileId ? [r.cloudFileId] : [],
    });
  for (const pending of state.pendingScreenshotArchives.filter((r) => r.owner === owner))
    for (const file of pending.files) {
      const source =
        pending.sources?.find((source) => source === legacyScreenshotSourceId(file)) ||
        (await screenshotSourceId(file));
      sources.set(source, { blob: file, name: file.name, sourceIds: [source], screenshotIds: [] });
    }
  if (owner === "guest" || options.localOnly) return [...sources.values()];
  if (!state.cloudIdentityVerified)
    throw Error(
      "Для полной копии аккаунта подключитесь к интернету. Локальные изменения можно скачать кнопкой «Только бюджет».",
    );
  const remote = [];
  let cursor = null,
    page = 0;
  const seen = new Set();
  do {
    backupContext(owner);
    const result = await cloudFetch(
      "/api/files" + (cursor ? "?cursor=" + encodeURIComponent(cursor) : ""),
    );
    for (const item of result.files) {
      if (seen.has(item.id))
        throw Error("Архив изменился во время выгрузки. Повторите скачивание.");
      seen.add(item.id);
      const same = [...sources.values()].find((r) => r.screenshotIds.includes(item.id));
      if (same) {
        same.sourceIds = [
          ...new Set([...same.sourceIds, ...(item.source_id ? [item.source_id] : [])]),
        ];
        continue;
      }
      setBackupStatus("Получаем скриншоты: " + seen.size);
      remote.push({
        blob: await backupFile(item.id, owner),
        name: item.name,
        createdAt: item.created_at,
        sourceIds: item.source_id ? [item.source_id] : [],
        screenshotIds: [item.id],
      });
    }
    cursor = result.nextCursor;
    if (++page > 101) throw Error("Слишком много скриншотов для одной копии.");
  } while (cursor);
  return [...sources.values(), ...remote];
}
export function downloadBackupBlob(blob, filename) {
  const url = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
export async function exportFullBackup(options = {}) {
  let finish;
  try {
    finish = beginBackup();
    const owner = backupOwner(),
      snapshot = JSON.parse(JSON.stringify(state.db));
    setBackupStatus("Подготавливаем бюджет и скриншоты…");
    const images = await collectBackupImages(owner, options);
    backupContext(owner);
    const copy = await FinanceBackup.create(snapshot, images, (n, total) =>
      setBackupStatus(`Проверяем скриншоты: ${n} из ${total}`),
    );
    if (
      copy.manifest.missingImages.length &&
      !(await askConfirm(
        `Для ${copy.manifest.missingImages.length} операций исходные скриншоты не найдены. Скачать бюджет и все доступные изображения? В копии будут отмечены недостающие исходники.`,
        `Скачать доступное`,
      ))
    ) {
      setBackupStatus("Скачивание отменено.");
      return;
    }
    const zip = await FinanceZip.build(copy.entries, (n, total) =>
      setBackupStatus(`Собираем архив: ${n} из ${total}`),
    );
    backupContext(owner);
    downloadBackupBlob(
      zip,
      "finance-full-backup-" + new Date().toISOString().slice(0, 10) + ".zip",
    );
    setBackupStatus(
      `Копия скачана: ${snapshot.ops.length} операций, ${copy.manifest.images.length} скриншотов.` +
        (copy.manifest.missingImages.length ? " Есть недостающие исходники." : ""),
    );
    return true;
  } catch (error) {
    setBackupStatus(error.message);
  } finally {
    finish?.();
  }
}
export async function restoreFullBackup(file) {
  if (!file || state.backupBusy) return;
  let finish;
  try {
    finish = beginBackup();
    const owner = backupOwner();
    if (state.pendingScreenshotArchives.length)
      throw Error("Сначала сохраните ожидающие скриншоты или скачайте полную копию.");
    setBackupStatus("Проверяем архив…");
    const copy = await FinanceBackup.read(file, (n, total) =>
      setBackupStatus(`Проверяем скриншоты: ${n} из ${total}`),
    );
    backupContext(owner);
    if (
      !(await confirmBackupRestore(
        `Восстановить ${copy.data.accounts.length} счетов, ${copy.data.ops.length} операций и ${copy.images.length} скриншотов? Текущий бюджет сохранится как предыдущая копия.` +
          (copy.manifest.missingImages.length
            ? ` В архиве отмечены ${copy.manifest.missingImages.length} операций без исходников.`
            : ""),
      ))
    ) {
      setBackupStatus("Восстановление отменено.");
      return;
    }
    setBackupStatus("Сохраняем текущий бюджет…");
    if (owner !== "guest") {
      if (!state.cloudIdentityVerified)
        throw Error("Для восстановления в аккаунт подключитесь к интернету.");
      if (state.cloudConflict) throw Error("Сначала сверите изменения с другим устройством.");
      state.backupAllowSync = true;
      await syncBudget();
      state.backupAllowSync = false;
      if (state.cloudDirty)
        throw Error("Не удалось сохранить текущий бюджет. Восстановление остановлено.");
    }
    backupContext(owner);
    const previous = JSON.parse(JSON.stringify(state.db)),
      previousKey = "finance-before-restore-" + owner;
    localStorage.setItem(previousKey, JSON.stringify(previous));
    const revision = state.cloudRevision;
    for (let i = 0; i < copy.images.length; i++) {
      backupContext(owner);
      const image = copy.images[i];
      if (owner !== "guest" && cloudScreenshotsEnabled(owner)) {
        setBackupStatus(`Восстанавливаем скриншоты: ${i + 1} из ${copy.images.length}`);
        const form = new FormData();
        form.append("file", image.blob, image.name);
        form.append("sourceId", "backup-" + image.sha256);
        image.cloudFileId = (await cloudFetch("/api/files", { method: "POST", body: form })).id;
      }
    }
    backupContext(owner);
    const restored = FinanceData.replacement(FinanceBackup.remap(copy.data, copy.images), state.db),
      records = copy.images.map((image) => ({
        key: owner + "::backup-" + image.sha256,
        owner,
        sourceId: "backup-" + image.sha256,
        name: image.name,
        blob: image.blob,
        createdAt: image.createdAt || new Date().toISOString(),
        cloudFileId: image.cloudFileId || null,
        archiveStandalone: true,
      }));
    setBackupStatus("Сохраняем скриншоты на устройстве…");
    await vaultWriteBatch(records);
    backupContext(owner);
    setBackupStatus("Применяем бюджет из копии…");
    if (owner === "guest") {
      localStorage.setItem(budgetStorageKey, JSON.stringify(restored));
      hydrateBudget(restored);
      state.cloudError = "";
    } else {
      const saved = await cloudFetch("/api/budget", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision, data: restored, snapshot: true }),
      });
      backupContext(owner);
      state.cloudRevision = saved.revision;
      state.cloudUpdatedAt = saved.updatedAt;
      hydrateBudget(restored);
      state.cloudDirty = false;
      state.cloudState = "synced";
      state.cloudError = "";
      try {
        cloudCache();
      } catch {
        state.cloudError = "Бюджет восстановлен на сервере, но копия устройства не обновилась.";
        try {
          forgetOfflineAccess();
        } catch {}
      }
    }
    render();
    const result =
      `Восстановлено: ${FinanceData.live(restored.accounts).length} счетов, ${FinanceData.live(restored.ops).length} операций, ${copy.images.length} скриншотов.` +
      (state.cloudError.includes("копия устройства не обновилась")
        ? " Копия устройства не обновилась."
        : "") +
      (copy.manifest.missingImages.length
        ? " Некоторые исходные скриншоты отсутствуют в архиве."
        : "") +
      " Предыдущий бюджет доступен в разделе «Копии бюджета».";
    setBackupStatus(result);
    finishBackupRestore(true, result);
  } catch (error) {
    const reason =
      error.name === "QuotaExceededError"
        ? "Не хватает места на устройстве. Освободите место и повторите восстановление."
        : error.message;
    setBackupStatus("Восстановление остановлено: " + reason);
    finishBackupRestore(false, state.backupStatus);
  } finally {
    finish?.();
  }
}
export async function restorePreviousLocalBudget() {
  const owner = backupOwner(),
    raw = localStorage.getItem("finance-before-restore-" + owner);
  if (!raw) return;
  let previous;
  try {
    previous = FinanceBackup.validateBudget(JSON.parse(raw));
  } catch (error) {
    setBackupStatus(error.message);
    return;
  }
  if (
    !(await askConfirm("Вернуть бюджет, сохранённый перед последним восстановлением?", "Вернуть"))
  )
    return;
  const current = JSON.stringify(state.db);
  try {
    localStorage.setItem("finance-before-restore-" + owner, current);
    hydrateBudget(FinanceData.replacement(previous, state.db));
    persistBudget(state.db, { snapshot: true });
    await syncBudget();
    renderProfile();
    setBackupStatus("Предыдущий бюджет возвращён.");
  } catch (error) {
    setBackupStatus(error.message);
  }
}
export function backupControls() {
  const hasPrevious = Boolean(localStorage.getItem("finance-before-restore-" + backupOwner()));
  return `${localStorage.getItem("finance-before-schema-" + backupOwner()) ? '<button data-action="downloadMigrationCopy" data-action-event="click">Скачать исходные данные до миграции</button>' : ""}<div class="actions"><button class="primary" data-action="downloadFullBackup" data-action-event="click">Скачать всё со скриншотами</button><button data-action="downloadBudgetJson" data-action-event="click">Только бюджет · JSON</button><label class="button-link">Восстановить копию<input type="file" accept="application/zip,.zip,application/json,.json" hidden data-action="restoreSelectedBackup" data-action-event="change"></label>${hasPrevious ? '<button data-action="restoreLocalBackup" data-action-event="click">Вернуть предыдущий бюджет</button>' : ""}${state.cloudSession?.user ? '<button data-action="refreshAccountProfile" data-action-event="click">Серверные копии</button>' : ""}</div><p class="muted">ZIP содержит бюджет и оригиналы изображений. До замены проверяются файлы и сохраняется текущий бюджет.</p>`;
}
export function downloadFullBackup(event, element) {
  return exportFullBackup();
}
export function downloadBudgetJson(event, element) {
  return exportBudget();
}
export function restoreSelectedBackup(event, element) {
  const file = element.files[0];
  element.value = "";
  if (file?.name.toLowerCase().endsWith(".zip")) restoreFullBackup(file);
  else restoreBudgetFile(file);
}
export function restoreLocalBackup(event, element) {
  return restorePreviousLocalBudget();
}
export function refreshAccountProfile(event, element) {
  return refreshProfile();
}
