import { state } from "./state.js?v=34";
import {
  vaultDeleteOwned,
  vaultAll,
  retryScreenshotArchives,
  uploadQueuedScreenshots,
  cloudScreenshotsEnabled,
} from "./file-vault.js?v=34";
import { cacheBudgetKey, emptyPersonalBudget, budgetStorageKey } from "./sync-core.js?v=34";
import { offlineAccess, forgetOfflineAccess } from "./pwa.js?v=34";
import {
  syncBudget,
  renderProfile,
  hydrateBudget,
  cloudFetch,
  cloudCache,
  refreshProfile,
} from "./sync.js?v=34";
import { $ } from "./format.js?v=34";
import { render } from "./app.js?v=34";
import { animateDialogClose, askConfirm, showNotice, askForm } from "./ui.js?v=34";
import { exportFullBackup } from "./backup-ui.js?v=34";
export function privacyOwner() {
  return state.cloudSession?.user?.id || "guest";
}
export function privacyContext(owner) {
  if (privacyOwner() !== owner) throw Error("Аккаунт изменился. Повторите действие.");
}
export async function purgeOwnerLocalData(owner) {
  await vaultDeleteOwned(owner);
  for (const key of [
    cacheBudgetKey(owner),
    cacheBudgetKey(owner) + "-migrated",
    "finance-before-restore-" + owner,
    "finance-before-schema-" + owner,
  ])
    localStorage.removeItem(key);
  const access = offlineAccess();
  if (access?.user?.id === owner) forgetOfflineAccess();
  state.pendingScreenshotArchives = state.pendingScreenshotArchives.filter(
    (record) => record.owner !== owner,
  );
  if (state.localScreenshotURL) {
    URL.revokeObjectURL(state.localScreenshotURL);
    state.localScreenshotURL = null;
  }
}
export async function awaitPrivateJobs() {
  if (state.cloudSyncJob) await state.cloudSyncJob;
  if (state.vaultUploadJob) await state.vaultUploadJob;
  if (state.vaultArchiveJob) await state.vaultArchiveJob;
}
export function beginPrivateAction() {
  if (state.cloudLogoutBusy || state.backupBusy || state.ocrBusy || state.importSaving)
    throw Error("Завершите текущую операцию.");
  state.cloudLogoutBusy = true;
  clearTimeout(state.cloudTimer);
  const main = document.querySelector("main"),
    prior = Boolean(main?.inert);
  if (main) main.inert = true;
  return () => {
    state.cloudLogoutBusy = false;
    state.privacyAllowJobs = false;
    if (main) main.inert = prior;
    if (state.cloudDirty && !state.cloudConflict) state.cloudTimer = setTimeout(syncBudget, 2500);
  };
}
export async function openLogoutDialog() {
  if (!state.cloudSession?.user) return;
  try {
    const owner = privacyOwner(),
      files = await vaultAll();
    privacyContext(owner);
    const cloud = cloudScreenshotsEnabled(owner),
      local = files.filter((record) => record.owner === owner && !record.cloudFileId).length,
      unsent = cloud ? local : 0,
      pending = cloud && state.pendingScreenshotArchives.some((record) => record.owner === owner);
    if (!state.cloudDirty && !unsent && !pending && !local) return logoutAccount("discard");
    $("#logoutmessage").textContent =
      !state.cloudDirty && !unsent && !pending
        ? "Скриншоты хранятся только на этом устройстве и будут удалены при выходе. Чтобы сохранить их, скачайте полную копию."
        : `На устройстве есть ${state.cloudDirty ? "несохранённые изменения бюджета" : ""}${state.cloudDirty && (unsent || pending) ? " и " : ""}${unsent || pending ? "неотправленные скриншоты" : ""}. После выхода данные аккаунта будут удалены с этого устройства.`;
    $("#logouterror").textContent = "";
    $("#logoutdialog").showModal();
  } catch (error) {
    state.cloudError = "Не удалось проверить хранилище перед выходом: " + error.message;
    renderProfile();
  }
}
export async function logoutAccount(mode) {
  if (!state.cloudSession?.user || state.cloudLogoutBusy) return;
  let finish;
  const owner = privacyOwner(),
    url = state.cloudSession.signOutUrl;
  try {
    finish = beginPrivateAction();
    await awaitPrivateJobs();
    privacyContext(owner);
    if (mode === "sync") {
      state.privacyAllowJobs = true;
      if (!state.cloudIdentityVerified)
        throw Error("Для сохранения перед выходом подключитесь к интернету.");
      await retryScreenshotArchives();
      await uploadQueuedScreenshots();
      await syncBudget();
      state.privacyAllowJobs = false;
      const records = await vaultAll();
      const cloud = cloudScreenshotsEnabled(owner);
      if (
        state.cloudDirty ||
        (cloud && state.pendingScreenshotArchives.some((record) => record.owner === owner)) ||
        (cloud && records.some((record) => record.owner === owner && !record.cloudFileId))
      )
        throw Error("Не всё удалось сохранить. Скачайте копию или повторите синхронизацию.");
    }
    privacyContext(owner);
    await purgeOwnerLocalData(owner);
    clearTimeout(state.cloudTimer);
    state.cloudDirty = false;
    state.cloudConflict = null;
    state.cloudVersions = [];
    state.cloudFiles = [];
    hydrateBudget(emptyPersonalBudget());
    state.cloudSession = null;
    state.cloudIdentityVerified = false;
    state.cloudState = "guest";
    state.draft = [];
    state.ocrFiles = [];
    render();
    window.location.assign(url);
  } catch (error) {
    $("#logouterror").textContent = error.message;
    if (!$("#logoutdialog").open) $("#logoutdialog").showModal();
  } finally {
    finish?.();
  }
}
export async function downloadLogoutCopy() {
  await animateDialogClose($("#logoutdialog"));
  const result = await exportFullBackup({
    localOnly: !state.cloudIdentityVerified || navigator.onLine === false,
  });
  if (result) {
    $("#logoutmessage").textContent =
      "Копия подготовлена для скачивания. Убедитесь, что файл сохранён, перед выходом без синхронизации.";
    $("#logouterror").textContent = "";
    $("#logoutdialog").showModal();
  }
}
export async function deleteScreenshot(id) {
  let finish;
  const owner = privacyOwner();
  try {
    if (owner === "guest") return;
    if (
      !(await askConfirm(
        "Удалить этот скриншот из аккаунта и с устройства? Операции останутся, ссылки на исходник будут убраны.",
        "Удалить",
      ))
    )
      return;
    privacyContext(owner);
    finish = beginPrivateAction();
    await awaitPrivateJobs();
    await syncBudget();
    if (state.cloudDirty || state.cloudConflict)
      throw Error("Сначала синхронизируйте бюджет и сверите изменения.");
    await cloudFetch("/api/files/" + encodeURIComponent(id), { method: "DELETE" });
    privacyContext(owner);
    await vaultDeleteOwned(owner, id);
    const remote = await cloudFetch("/api/budget");
    hydrateBudget(remote.data || emptyPersonalBudget());
    state.cloudRevision = remote.revision;
    state.cloudGeneration = remote.generation || 0;
    state.cloudDirty = false;
    cloudCache();
    await refreshProfile();
  } catch (error) {
    state.cloudError = error.message;
    if (state.page === "Личный кабинет") renderProfile();
    await showNotice(error.message);
  } finally {
    finish?.();
  }
}
export async function deleteAllMyData() {
  const owner = privacyOwner();
  if (state.cloudLogoutBusy || state.backupBusy) return;
  if (
    !(await askConfirm(
      owner === "guest"
        ? "Удалить бюджет и скриншоты этого устройства?"
        : "Удалить весь бюджет аккаунта, серверные копии и скриншоты? Это удалит данные и с этого устройства.",
      "Продолжить",
    ))
  )
    return;
  const confirmation = await askForm({
    title: "Окончательное удаление",
    message: "Перед удалением можно скачать полную копию в разделе «Копии бюджета».",
    fields: [{ name: "confirmation", label: "Введите УДАЛИТЬ", required: true }],
    confirmLabel: "Удалить все мои данные",
  });
  if (confirmation?.confirmation?.trim().toUpperCase() !== "УДАЛИТЬ") return;
  let finish;
  try {
    privacyContext(owner);
    finish = beginPrivateAction();
    await awaitPrivateJobs();
    if (owner !== "guest") {
      if (!state.cloudIdentityVerified)
        throw Error("Подключитесь к интернету, чтобы удалить серверные данные.");
      const result = await cloudFetch("/api/budget", { method: "DELETE" });
      state.cloudGeneration = result.generation;
    }
    await purgeOwnerLocalData(owner);
    if (owner === "guest")
      localStorage.setItem(budgetStorageKey, JSON.stringify(emptyPersonalBudget()));
    hydrateBudget(emptyPersonalBudget());
    state.cloudRevision = 0;
    state.cloudDirty = false;
    state.cloudConflict = null;
    state.cloudVersions = [];
    state.cloudFiles = [];
    state.cloudUpdatedAt = null;
    state.cloudState = owner === "guest" ? "guest" : "synced";
    state.draft = [];
    state.ocrFiles = [];
    render();
    await showNotice("Данные удалены. Можно начать новый бюджет.");
  } catch (error) {
    state.cloudError = error.message;
    await showNotice("Удаление не завершилось: " + error.message);
  } finally {
    finish?.();
  }
}
document.getElementById("logoutdialog")?.addEventListener(
  "cancel",
  (event) => {
    if (state.cloudLogoutBusy) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  },
  { capture: true },
);

export async function deleteWholeAccount() {
  const owner = privacyOwner();
  if (owner === "guest" || state.cloudLogoutBusy || state.backupBusy) return;
  if (
    !(await askConfirm(
      "Удалить аккаунт? Будут удалены бюджет, серверные копии, скриншоты и данные входа, а согласие на обработку данных — отозвано. Отменить это нельзя.",
      "Продолжить",
    ))
  )
    return;
  const confirmation = await askForm({
    title: "Удаление аккаунта",
    message: "Перед удалением можно скачать полную копию в разделе «Копии бюджета».",
    fields: [{ name: "confirmation", label: "Введите УДАЛИТЬ", required: true }],
    confirmLabel: "Удалить аккаунт",
  });
  if (confirmation?.confirmation?.trim().toUpperCase() !== "УДАЛИТЬ") return;
  let finish;
  try {
    privacyContext(owner);
    finish = beginPrivateAction();
    await awaitPrivateJobs();
    if (!state.cloudIdentityVerified)
      throw Error("Подключитесь к интернету, чтобы удалить аккаунт.");
    await cloudFetch("/api/account", { method: "DELETE" });
    await purgeOwnerLocalData(owner);
    clearTimeout(state.cloudTimer);
    state.cloudDirty = false;
    state.cloudSession = null;
    state.cloudIdentityVerified = false;
    hydrateBudget(emptyPersonalBudget());
    window.location.assign("/login");
  } catch (error) {
    state.cloudError = error.message;
    await showNotice("Удаление аккаунта не завершилось: " + error.message);
  } finally {
    finish?.();
  }
}
