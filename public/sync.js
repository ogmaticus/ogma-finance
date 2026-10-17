import { preserveLegacyBudget } from "./migration-copy.js?v=33";
import { icon } from "./icons.js?v=33";
import { APP_VERSION } from "./release-info.js?v=33";
import { themeControls } from "./appearance.js?v=33";
import { BudgetSchema } from "./budget-schema.js?v=33";
import { state } from "./state.js?v=33";
import {
  parseBudget,
  rememberBudgetBaseline,
  liveRecords,
  cacheBudgetKey,
  budgetStorageKey,
  emptyPersonalBudget,
  isBudget,
  mergeBudgets,
} from "./sync-core.js?v=33";
import { FinanceData } from "./data-model.js?v=33";
import { $, esc } from "./format.js?v=33";
import {
  purgeOwnerLocalData,
  openLogoutDialog,
  deleteScreenshot,
  deleteAllMyData,
  deleteWholeAccount,
} from "./privacy-ui.js?v=33";
import {
  uploadQueuedScreenshots,
  claimGuestArchivesForMigration,
  cloudScreenshotsEnabled,
  setCloudScreenshots,
} from "./file-vault.js?v=33";
import { offlineAccess, forgetOfflineAccess, pwaCardHtml } from "./pwa.js?v=33";
import { go, render, seed } from "./app.js?v=33";
import { showNotice, askConfirm } from "./ui.js?v=33";
import { FinanceBackup } from "./backup-core.js?v=33";
import { backupControls } from "./backup-ui.js?v=33";
export const baseCategories = [
  "Продукты",
  "Транспорт",
  "Покупки",
  "Кафе",
  "Жильё",
  "Здоровье",
  "Развлечения",
  "Зарплата",
  "Другое",
];
export function hydrateBudget(data) {
  preserveLegacyBudget(data);
  state.db = parseBudget(data);
  rememberBudgetBaseline(state.db);
  state.db.categories = Array.isArray(state.db.categories) ? state.db.categories : [];
  state.db.merchantRules = Array.isArray(state.db.merchantRules) ? state.db.merchantRules : [];
  state.cats.splice(
    0,
    state.cats.length,
    ...new Set([
      ...baseCategories,
      ...Object.keys(state.db.limits),
      ...Object.values(state.db.budgetsByMonth || {}).flatMap((plan) => Object.keys(plan)),
      ...state.db.categories,
      ...liveRecords("ops")
        .map((o) => o.category)
        .filter((c) => c && c !== "Перевод"),
    ]),
  );
}
export function cloudCache() {
  if (!state.cloudSession?.user) return;
  localStorage.setItem(
    cacheBudgetKey(state.cloudSession.user.id),
    JSON.stringify({
      data: state.db,
      revision: state.cloudRevision,
      dirty: state.cloudDirty,
      updatedAt: state.cloudUpdatedAt,
      generation: state.cloudGeneration,
      snapshot: state.cloudSnapshotSerial > state.cloudSnapshotCommitted,
    }),
  );
}
export function persistBudget(data, options = {}) {
  try {
    state.db = BudgetSchema.parse(FinanceData.stamp(data, state.budgetBaseline));
  } catch (error) {
    if (state.budgetBaseline) state.db = JSON.parse(JSON.stringify(state.budgetBaseline));
    throw error;
  }
  rememberBudgetBaseline(state.db);
  if (options.snapshot) state.cloudSnapshotSerial++;
  if (state.cloudSession?.user) {
    state.cloudDirty = true;
    try {
      cloudCache();
    } catch (error) {
      state.cloudError = "Не удалось сохранить копию на устройстве. Скачайте бюджет.";
    }
    if (state.cloudState !== "conflict") {
      state.cloudState =
        state.cloudIdentityVerified &&
        (typeof navigator === "undefined" || navigator.onLine !== false)
          ? "pending"
          : "offline";
      clearTimeout(state.cloudTimer);
      if (state.cloudState === "pending") state.cloudTimer = setTimeout(syncBudget, 2500);
    }
  } else {
    try {
      localStorage.setItem(budgetStorageKey, JSON.stringify(state.db));
    } catch (error) {
      state.cloudError = "Не удалось сохранить бюджет в браузере. Скачайте копию.";
    }
  }
  updateCloudBadge();
}
export async function cloudFetch(path, options = {}) {
  if (typeof navigator !== "undefined" && navigator.onLine === false)
    throw Error("Нет соединения. Изменения сохранены на устройстве.");
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(path, {
      ...options,
      headers: {
        ...options.headers,
        ...(state.cloudSession?.user && path !== "/api/session"
          ? {
              "X-Finance-Owner": state.cloudSession.user.id,
              "X-Finance-Schema": "3",
              "X-Finance-Generation": String(state.cloudGeneration),
            }
          : {}),
      },
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
    });
    let value;
    try {
      value = await response.json();
    } catch {
      throw Error("Не удалось получить ответ сервера");
    }
    if (!response.ok) {
      const error = new Error(value.error || "Ошибка сервера");
      error.status = response.status;
      error.code = value.code;
      throw error;
    }
    return value;
  } finally {
    clearTimeout(timer);
  }
}
export function updateCloudBadge() {
  const badge = $("#cloudbadge");
  if (!badge) return;
  const labels = {
    checking: "Подключение…",
    guest: "Войти · сохранить бюджет",
    synced: "Сохранено в аккаунте",
    pending: "Есть изменения",
    syncing: "Сохранение…",
    offline: "Сохранено на устройстве",
    conflict: "Нужно сверить изменения",
    "waiting-import": "Перенести бюджет",
  };
  badge.innerHTML = icon(
    state.cloudState === "synced"
      ? "cloud-check"
      : ["checking", "syncing"].includes(state.cloudState)
        ? "refresh"
        : state.cloudState === "conflict"
          ? "alert"
          : "cloud",
  );
  badge.title = labels[state.cloudState] || "Личный кабинет";
  badge.ariaLabel = badge.title + ". Открыть личный кабинет";
  badge.className =
    "cloud-badge " +
    (state.cloudState === "synced" ? "ok" : state.cloudState === "conflict" ? "warn" : "");
}
export async function acceptRemoteReset(remote) {
  const owner = state.cloudSession?.user?.id;
  if (!owner) return;
  if (remote.deleting)
    throw Error("Удаление данных ещё выполняется. Повторите удаление в личном кабинете.");
  await purgeOwnerLocalData(owner);
  state.cloudGeneration = remote.generation || 0;
  state.cloudRevision = remote.revision;
  state.cloudUpdatedAt = remote.updatedAt;
  state.cloudDirty = false;
  state.cloudConflict = null;
  state.cloudSnapshotSerial = state.cloudSnapshotCommitted = 0;
  state.cloudMigrationAvailable = false;
  state.cloudFiles = [];
  state.cloudVersions = [];
  hydrateBudget(remote.data || emptyPersonalBudget());
  state.cloudState = "synced";
  state.cloudError = "Данные аккаунта были удалены на другом устройстве. Локальная копия очищена.";
  cloudCache();
}
// Без входа приложение не показываем: сервер сообщает signInRequired, и мы уходим на страницу входа.
// Офлайн (сессию проверить нельзя) работает прежний режим с сохранённым доступом.
function requireSignIn() {
  if (!state.cloudSession?.signInRequired || state.cloudSession.user) return false;
  const url = state.cloudSession.signInUrl || "/login?return_to=%2Ffinance";
  if (typeof location !== "undefined" && typeof location.replace === "function")
    location.replace(url);
  return true;
}
export async function initializeCloud() {
  const main = document.querySelector("main");
  if (main) main.inert = true;
  try {
    state.cloudSession = await cloudFetch("/api/session");
    state.cloudIdentityVerified = true;
    const access = offlineAccess();
    if (access && access.user.id !== state.cloudSession.user?.id) forgetOfflineAccess();
    if (!state.cloudSession.user) {
      if (requireSignIn()) return;
      state.cloudState = "guest";
      return;
    }
    const raw = localStorage.getItem(budgetStorageKey);
    state.cloudMigrationAvailable =
      Boolean(raw) &&
      raw !== localStorage.getItem(cacheBudgetKey(state.cloudSession.user.id) + "-migrated");
    let cached = null;
    try {
      const c = localStorage.getItem(cacheBudgetKey(state.cloudSession.user.id));
      if (c) cached = JSON.parse(c);
    } catch {}
    const remote = await cloudFetch("/api/budget");
    if (cached && (cached.generation || 0) !== (remote.generation || 0)) {
      await acceptRemoteReset(remote);
      cached = null;
    }
    state.cloudGeneration = remote.generation || 0;
    state.cloudRevision = remote.revision;
    state.cloudUpdatedAt = remote.updatedAt;
    if (cached?.dirty && isBudget(cached.data)) {
      if (cached.snapshot) state.cloudSnapshotSerial++;
      hydrateBudget(cached.data);
      state.cloudDirty = true;
      if (cached.revision !== remote.revision) {
        state.cloudRevision = cached.revision;
        state.cloudConflict = remote;
        state.cloudState = "conflict";
      } else {
        state.cloudState = "pending";
        state.cloudTimer = setTimeout(syncBudget, 300);
      }
    } else if (remote.data) {
      hydrateBudget(remote.data);
      state.cloudState = "synced";
      state.cloudDirty = false;
      cloudCache();
    } else {
      hydrateBudget(emptyPersonalBudget());
      state.cloudState = state.cloudMigrationAvailable ? "waiting-import" : "synced";
      state.cloudDirty = false;
      cloudCache();
    }
    uploadQueuedScreenshots();
    if (state.cloudMigrationAvailable) go("Личный кабинет");
    else render();
  } catch (error) {
    state.cloudError = error.message;
    if (!state.cloudSession?.user && true) {
      const access = offlineAccess();
      if (access) {
        state.cloudSession = {
          user: access.user,
          signInUrl: "/login?return_to=%2Ffinance",
          signOutUrl: "/logout?return_to=%2Ffinance",
        };
        state.cloudIdentityVerified = false;
      }
    }
    if (state.cloudSession?.user) {
      try {
        const cache = JSON.parse(
          localStorage.getItem(cacheBudgetKey(state.cloudSession.user.id)) || "null",
        );
        hydrateBudget(cache?.data || emptyPersonalBudget());
        state.cloudGeneration = cache?.generation || 0;
        state.cloudRevision = cache?.revision || 0;
        state.cloudDirty = Boolean(cache?.dirty);
      } catch {
        hydrateBudget(emptyPersonalBudget());
      }
    }
    state.cloudState = "offline";
    render();
  } finally {
    if (main) main.inert = false;
    updateCloudBadge();
    if (state.page === "Личный кабинет") renderProfile();
  }
}
export function syncBudget() {
  if (state.cloudSyncJob) return state.cloudSyncJob;
  state.cloudSyncJob = runBudgetSync().finally(() => {
    state.cloudSyncJob = null;
  });
  return state.cloudSyncJob;
}
export async function runBudgetSync() {
  if (state.backupBusy && !state.backupAllowSync) return;
  if (
    !state.cloudIdentityVerified ||
    !state.cloudSession?.user ||
    state.cloudBusy ||
    !state.cloudDirty ||
    state.cloudConflict ||
    state.cloudState === "waiting-import"
  )
    return;
  state.cloudBusy = true;
  state.cloudState = "syncing";
  updateCloudBadge();
  const snapshot = JSON.stringify(state.db),
    revision = state.cloudRevision,
    snapshotSerial = state.cloudSnapshotSerial;
  try {
    const saved = await cloudFetch("/api/budget", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        revision,
        data: JSON.parse(snapshot),
        snapshot: snapshotSerial > state.cloudSnapshotCommitted,
      }),
    });
    state.cloudSnapshotCommitted = snapshotSerial;
    state.cloudRevision = saved.revision;
    state.cloudUpdatedAt = saved.updatedAt;
    state.cloudDirty = JSON.stringify(state.db) !== snapshot;
    state.cloudState = state.cloudDirty ? "pending" : "synced";
    state.cloudError = "";
    cloudCache();
    if (state.cloudDirty) state.cloudTimer = setTimeout(syncBudget, 300);
  } catch (error) {
    if (error.status === 409) {
      state.cloudConflict = await cloudFetch("/api/budget").catch(() => ({
        revision: null,
        data: null,
      }));
      if (
        state.cloudConflict.generation !== undefined &&
        state.cloudConflict.generation !== state.cloudGeneration
      ) {
        await acceptRemoteReset(state.cloudConflict);
      } else {
        state.cloudState = "conflict";
        state.cloudError = "Бюджет изменён на другом устройстве. Ваши изменения сохранены здесь.";
      }
    } else {
      if (error.status === 401) state.cloudIdentityVerified = false;
      state.cloudState = "offline";
      state.cloudError = error.message;
    }
    try {
      cloudCache();
    } catch {
      state.cloudError += " Скачайте копию бюджета: хранилище устройства заполнено.";
    }
  } finally {
    state.cloudBusy = false;
    updateCloudBadge();
    if (state.page === "Личный кабинет") renderProfile();
  }
}
export async function transferLocalBudget() {
  let local;
  try {
    local = parseBudget(localStorage.getItem(budgetStorageKey));
  } catch {
    await showNotice("В этом браузере нет корректного сохранённого бюджета.");
    return;
  }
  if (
    !(await askConfirm(
      "Перенести бюджет этого браузера в ваш аккаунт? Если запись изменена в обоих бюджетах, используем вариант с этого устройства. Предыдущая серверная версия сохранится.",
      "Перенести",
    ))
  )
    return;
  hydrateBudget(mergeBudgets(state.db, local));
  state.cloudState = "pending";
  persistBudget(state.db, { snapshot: true });
  await syncBudget();
  if (!state.cloudDirty) {
    localStorage.setItem(
      cacheBudgetKey(state.cloudSession.user.id) + "-migrated",
      localStorage.getItem(budgetStorageKey),
    );
    state.cloudMigrationAvailable = false;
  }
  await claimGuestArchivesForMigration();
  await uploadQueuedScreenshots();
  renderProfile();
}
export async function resolveCloudConflict() {
  if (
    state.cloudConflict?.generation !== undefined &&
    state.cloudConflict.generation !== state.cloudGeneration
  ) {
    await acceptRemoteReset(state.cloudConflict);
    render();
    return;
  }
  if (!state.cloudConflict?.data) {
    state.cloudConflict = await cloudFetch("/api/budget").catch(() => null);
    if (!state.cloudConflict?.data) {
      await showNotice("Не удалось получить серверную версию. Попробуйте позднее.");
      return;
    }
  }
  if (
    !(await askConfirm(
      "Объединить изменения с другим устройством? Новые записи сохраним из обеих версий. Для изменённых записей выберем более позднее изменение; удалённые записи не вернутся; предыдущая серверная версия останется в копиях.",
      "Объединить",
    ))
  )
    return;
  hydrateBudget(mergeBudgets(state.cloudConflict.data, state.db));
  state.cloudRevision = state.cloudConflict.revision;
  state.cloudConflict = null;
  state.cloudState = "pending";
  persistBudget(state.db, { snapshot: true });
  await syncBudget();
}
export function exportBudget() {
  const blob = new Blob(
      [
        JSON.stringify(
          {
            format: "finance-backup",
            version: 1,
            exportedAt: new Date().toISOString(),
            data: FinanceData.exportData(state.db),
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    ),
    url = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = url;
  link.download = "finance-budget-" + new Date().toISOString().slice(0, 10) + ".json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
export async function restoreBudgetFile(file) {
  if (!file) return;
  let data;
  try {
    const parsed = JSON.parse(await file.text());
    data = FinanceBackup.validateBudget(parsed.data || parsed);
  } catch {
    await showNotice("Файл не содержит корректный бюджет.");
    return;
  }
  if (
    !(await askConfirm(
      "Заменить текущий бюджет данными из файла? Перед заменой сохранится предыдущая версия.",
      "Восстановить",
    ))
  )
    return;
  localStorage.setItem(
    "finance-before-restore-" + (state.cloudSession?.user?.id || "guest"),
    JSON.stringify(state.db),
  );
  hydrateBudget(FinanceData.replacement(data, state.db));
  if (state.cloudState === "waiting-import") state.cloudState = "pending";
  persistBudget(state.db, { snapshot: true });
  await syncBudget();
  renderProfile();
}
export async function refreshProfile() {
  if (!state.cloudIdentityVerified) {
    await reconnectCloud();
    if (!state.cloudIdentityVerified) return;
  }
  if (!state.cloudSession?.user) return;
  try {
    const [backups, files] = await Promise.all([
      cloudFetch("/api/backups"),
      cloudFetch("/api/files"),
    ]);
    state.cloudVersions = backups.versions;
    state.cloudFiles = files.files;
    state.cloudError = "";
  } catch (error) {
    state.cloudError = error.message;
  }
  renderProfile();
}
export async function restoreCloudVersion(revision) {
  const backup = await cloudFetch("/api/backups?revision=" + revision).catch((error) => {
    state.cloudError = error.message;
    return null;
  });
  if (!backup) return;
  if (
    !(await askConfirm(
      "Восстановить бюджет из выбранной копии? Текущий бюджет сохранится как предыдущая версия.",
      "Восстановить",
    ))
  )
    return;
  hydrateBudget(FinanceData.replacement(backup.data, state.db));
  persistBudget(state.db, { snapshot: true });
  await syncBudget();
  await refreshProfile();
}
export function renderProfile() {
  const user = state.cloudSession?.user;
  $("#content").innerHTML =
    `<div class="card profile-card"><span class="import-kicker">ЛИЧНЫЙ КАБИНЕТ</span><h2>${user ? esc(user.name) : "Сохраните бюджет в аккаунте"}</h2>${user ? `${user.name !== user.email ? `<p class="muted">${esc(user.email)}</p>` : ""}<div class="profile-status">${esc(state.cloudState === "synced" ? "Бюджет сохранён на сервере" : state.cloudState === "waiting-import" ? "Можно перенести бюджет из браузера" : state.cloudState === "conflict" ? "Есть изменения на другом устройстве" : state.cloudState === "offline" ? "Сервер недоступен. Изменения остаются на устройстве" : "Сохранение бюджета…")}</div><small>${state.cloudUpdatedAt ? "Последнее сохранение: " + esc(new Date(state.cloudUpdatedAt).toLocaleString("ru-RU")) : ""}</small>` : "<p>Войдите по почте — бюджет будет доступен на всех ваших устройствах. Пароль не нужен.</p>"}<div class="actions" style="margin-top:var(--gap-16)">${user ? `<button data-action="syncAccountBudget" data-action-event="click">Синхронизировать</button>${state.cloudMigrationAvailable ? '<button class="primary" data-action="transferDeviceBudget" data-action-event="click">Перенести бюджет этого браузера</button>' : ""}${state.cloudConflict ? '<button class="primary" data-action="reviewCloudConflict" data-action-event="click">Сверить изменения</button>' : ""}<button class="button-link" data-action="openAccountLogout" data-action-event="click">Выйти</button>` : `<a class="button-link primary" target="_top" href="${esc(state.cloudSession?.signInUrl || "/login?return_to=%2Ffinance")}">Войти</a>`}</div><p class="profile-error" role="status">${esc(state.cloudError || state.vaultError)}</p></div>${pwaCardHtml()}<div class="card"><h2>Копии бюджета</h2>${backupControls()}${state.cloudVersions.length ? state.cloudVersions.map((v) => `<div class="row"><div><b>Версия ${v.revision}</b><br><small>${esc(new Date(v.created_at).toLocaleString("ru-RU"))}</small></div><button data-action="restoreSelectedCloudVersion" data-action-event="click" data-revision="${esc(v.revision)}">Восстановить</button></div>`).join("") : '<p class="muted">Снимки создаются раз в 30 минут и перед импортом, восстановлением или слиянием. Хранятся последние 30 и месячные копии за год.</p>'}</div><div class="card"><h2>Скриншоты</h2><p class="muted">Скриншоты распознаются на устройстве и по умолчанию хранятся только на нём. Облачная копия нужна, чтобы открывать исходники с других устройств; на сервере она хранится в зашифрованном виде.</p>${user ? `<label class="offline-choice"><input type="checkbox" ${cloudScreenshotsEnabled() ? "checked" : ""} data-action="toggleCloudScreenshots" data-action-event="change"><span>Хранить копии скриншотов в облаке<small>Выключено — исходники остаются только на этом устройстве и удаляются при выходе.</small></span></label>${cloudScreenshotsEnabled() ? '<button data-action="refreshImageArchive" data-action-event="click">Обновить архив</button>' : ""}` : '<p class="muted">Облачные копии доступны после входа.</p>'}<div class="profile-files">${state.cloudFiles.map((f) => `<div class="profile-file"><a target="_blank" rel="noopener" href="/api/files/${f.id}"><img loading="lazy" src="/api/files/${f.id}" alt="${esc(f.name)}"><small>${esc(f.name)}</small></a><button class="negative" data-file-id="${esc(f.id)}" data-action="removeArchivedScreenshot" data-action-event="click">Удалить скриншот</button></div>`).join("")}</div></div><div class="card"><h2>Управление данными</h2><div class="actions"><button class="negative" data-action="removeAccountData" data-action-event="click">Удалить все мои данные</button>${user ? '<button class="negative" data-action="removeWholeAccount" data-action-event="click">Удалить аккаунт</button>' : ""}</div><p class="muted"><a href="/privacy" target="_blank" rel="noopener">Политика обработки данных</a> · <a href="/consent" target="_blank" rel="noopener">Согласие</a></p></div>`;
  $("#content").innerHTML += themeControls();
  $("#content").innerHTML += `<p class="app-version">Версия ${APP_VERSION}</p>`;
}
if (typeof window.addEventListener === "function") {
  window.addEventListener("load", initializeCloud);
  window.addEventListener("online", reconnectCloud);
  window.addEventListener("offline", () => {
    state.cloudState = "offline";
    updateCloudBadge();
  });
}
export async function synchronizeCloud() {
  if (!state.cloudIdentityVerified) {
    await reconnectCloud();
    return;
  }
  if (!state.cloudSession?.user) return;
  if (state.cloudDirty) {
    await syncBudget();
  } else if (!state.cloudBusy) {
    try {
      const remote = await cloudFetch("/api/budget");
      if (!state.cloudDirty) {
        if ((remote.generation || 0) !== state.cloudGeneration) {
          await acceptRemoteReset(remote);
          return;
        }
        hydrateBudget(remote.data || emptyPersonalBudget());
        state.cloudGeneration = remote.generation || 0;
        state.cloudRevision = remote.revision;
        state.cloudUpdatedAt = remote.updatedAt;
        state.cloudState = "synced";
        cloudCache();
        state.cloudError = "";
      }
    } catch (error) {
      state.cloudError = error.message;
      state.cloudState = "offline";
    }
  }
  await uploadQueuedScreenshots();
  updateCloudBadge();
  if (state.page === "Личный кабинет") renderProfile();
}
export async function refreshScreenshotArchive() {
  await uploadQueuedScreenshots();
  await refreshProfile();
}
export async function reconnectCloud() {
  if (state.backupBusy || state.cloudLogoutBusy) return;
  if (state.cloudReconnectBusy) return;
  if (state.cloudBusy || state.vaultUploading) {
    setTimeout(reconnectCloud, 1500);
    return;
  }
  state.cloudReconnectBusy = true;
  const main = document.querySelector("main");
  if (main) main.inert = true;
  try {
    if (state.cloudSession?.user) cloudCache();
    const prior = state.cloudSession?.user?.id,
      session = await cloudFetch("/api/session");
    if (prior !== session.user?.id) {
      state.cloudSession = session;
      state.cloudIdentityVerified = true;
      state.cloudDirty = false;
      state.cloudConflict = null;
      state.cloudRevision = 0;
      state.cloudVersions = [];
      state.cloudFiles = [];
      forgetOfflineAccess();
      if (session.user) await initializeCloud();
      else if (requireSignIn()) return;
      else {
        hydrateBudget(parseBudget(localStorage.getItem(budgetStorageKey) || structuredClone(seed)));
        state.cloudState = "guest";
        state.cloudError = "";
      }
    } else {
      state.cloudSession = session;
      state.cloudIdentityVerified = true;
      await synchronizeCloud();
    }
    render();
  } catch (error) {
    state.cloudIdentityVerified = false;
    state.cloudState = "offline";
    state.cloudError = error.message;
  } finally {
    state.cloudReconnectBusy = false;
    if (main) main.inert = false;
    updateCloudBadge();
    if (state.page === "Личный кабинет") renderProfile();
  }
}
if (typeof document.addEventListener === "function")
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      clearTimeout(state.cloudTimer);
      syncBudget();
    }
  });
export function syncAccountBudget(event, element) {
  return synchronizeCloud();
}
export function transferDeviceBudget(event, element) {
  return transferLocalBudget();
}
export function reviewCloudConflict(event, element) {
  return resolveCloudConflict();
}
export function openAccountLogout(event, element) {
  return openLogoutDialog();
}
export function restoreSelectedCloudVersion(event, element) {
  return restoreCloudVersion(Number(element.dataset.revision));
}
export function refreshImageArchive(event, element) {
  return refreshScreenshotArchive();
}
export function removeArchivedScreenshot(event, element) {
  return deleteScreenshot(element.dataset.fileId);
}
export function removeAccountData(event, element) {
  return deleteAllMyData();
}
export function removeWholeAccount(event, element) {
  return deleteWholeAccount();
}
export function toggleCloudScreenshots(event, element) {
  setCloudScreenshots(element.checked);
  renderProfile();
}
