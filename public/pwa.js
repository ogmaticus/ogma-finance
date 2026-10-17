import { state } from "./state.js?v=34";
import { cloudCache, renderProfile, reconnectCloud } from "./sync.js?v=34";
import { esc } from "./format.js?v=34";
import { budgetStorageKey } from "./sync-core.js?v=34";
export function offlineAccess() {
  try {
    const value = JSON.parse(localStorage.getItem("finance-offline-access") || "null");
    return value?.user?.id && value.user.name && value.enabled === true ? value : null;
  } catch {
    return null;
  }
}
export function forgetOfflineAccess() {
  localStorage.removeItem("finance-offline-access");
}
export function toggleOfflineAccess(enabled) {
  if (!state.cloudSession?.user || !state.cloudIdentityVerified) return;
  try {
    if (enabled) {
      cloudCache();
      localStorage.setItem(
        "finance-offline-access",
        JSON.stringify({ enabled: true, user: state.cloudSession.user }),
      );
    } else forgetOfflineAccess();
    state.pwaMessage = "";
  } catch {
    state.pwaMessage = "Не удалось сохранить настройку устройства.";
  }
  renderProfile();
}
export function installedApp() {
  return (
    Boolean(
      typeof window.matchMedia === "function" &&
      window.matchMedia("(display-mode: standalone)").matches,
    ) || Boolean(typeof navigator !== "undefined" && navigator.standalone)
  );
}
export function pwaCardHtml() {
  const remembered = offlineAccess(),
    user = state.cloudSession?.user;
  return `<div class="card install-card"><div class="install-heading"><img src="/icons/icon-192.png" alt=""><div><span class="import-kicker">ВСЕГДА ПОД РУКОЙ</span><h2>${installedApp() ? "Приложение на этом устройстве" : "Приложение на вашем телефоне"}</h2></div></div><p>${installedApp() ? "Вы открыли приложение с главного экрана." : "Добавьте «Финансы» на главный экран, чтобы открывать бюджет одним нажатием."}</p>${state.installPrompt && !installedApp() ? '<button class="primary" data-action="installApplication" data-action-event="click">Установить приложение</button>' : installedApp() ? "" : '<p class="muted install-help">Android: меню браузера → «Установить приложение» или «Добавить на главный экран». iPhone: Safari → «Поделиться» → «На экран Домой».</p>'}<p class="muted">${state.pwaReady ? "Приложение готово к работе без интернета." : "Подготавливаем приложение для запуска без интернета. Для первого открытия нужна сеть."}</p>${user ? `<label class="offline-choice"><input type="checkbox" ${remembered?.user.id === user.id ? "checked" : ""} ${state.cloudIdentityVerified ? "" : "disabled"} data-action="changeOfflineAccess" data-action-event="change"><span>Открывать мой бюджет без интернета на этом устройстве<small>Включайте на личном устройстве. Бюджет и скриншоты хранятся на устройстве до выхода; при выходе они удаляются.</small></span></label>` : ""}<button data-action="prepareOfflineOCR" data-action-event="click">Подготовить распознавание без интернета</button><p class="muted">Модели загружаются при первом распознавании или по этой кнопке (около 10 МБ).</p><p class="profile-error" role="status">${esc(state.pwaMessage)}</p></div>`;
}
export async function installFinanceApp() {
  if (!state.installPrompt) return;
  const prompt = state.installPrompt;
  state.installPrompt = null;
  await prompt.prompt();
  await prompt.userChoice;
  renderProfile();
}
export function showAvailableUpdate() {
  const banner = document.getElementById("updatebanner");
  if (banner) banner.hidden = !state.pwaRegistration?.waiting;
}
export async function applyFinanceUpdate() {
  if (!state.pwaRegistration?.waiting) return;
  const editing = document.querySelector("dialog[open]");
  if (
    state.backupBusy ||
    state.cloudLogoutBusy ||
    state.ocrBusy ||
    state.draft.length ||
    state.ocrFiles.length ||
    editing ||
    state.cloudBusy ||
    state.vaultUploading ||
    state.importSaving ||
    state.pendingScreenshotArchives.length
  ) {
    state.pwaMessage =
      "Сначала завершите импорт, редактирование или сохранение. Затем обновите приложение.";
    const status = document.getElementById("updatestatus");
    if (status) status.textContent = state.pwaMessage;
    return;
  }
  try {
    if (state.cloudSession?.user) cloudCache();
    else if (localStorage.getItem(budgetStorageKey))
      localStorage.setItem(budgetStorageKey, JSON.stringify(state.db));
  } catch {
    const status = document.getElementById("updatestatus");
    if (status)
      status.textContent = "Не удалось сохранить копию. Скачайте бюджет перед обновлением.";
    return;
  }
  state.pwaApplyRequested = true;
  state.pwaRegistration.waiting.postMessage({ type: "APPLY_UPDATE" });
}
export async function initializePwa() {
  if (typeof navigator === "undefined" || !navigator.serviceWorker) {
    state.pwaMessage = "Этот браузер не поддерживает запуск без интернета.";
    return;
  }
  try {
    state.pwaRegistration = await navigator.serviceWorker.register("/sw.js", {
      scope: "/",
      type: "module",
      updateViaCache: "none",
    });
    state.pwaRegistration.addEventListener("updatefound", () => {
      const worker = state.pwaRegistration.installing;
      if (worker)
        worker.addEventListener("statechange", () => {
          if (worker.state === "installed") {
            showAvailableUpdate();
            if (state.page === "Личный кабинет") renderProfile();
          }
        });
    });
    showAvailableUpdate();
    await navigator.serviceWorker.ready;
    state.pwaReady = true;
    if (state.page === "Личный кабинет") renderProfile();
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (state.pwaApplyRequested) window.location.reload();
    });
    await state.pwaRegistration.update();
  } catch {
    state.pwaMessage = "Запуск без интернета пока не подготовлен. Проверьте соединение.";
    if (state.page === "Личный кабинет") renderProfile();
  }
}
if (typeof window.addEventListener === "function") {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    state.installPrompt = event;
    if (state.page === "Личный кабинет") renderProfile();
  });
  window.addEventListener("appinstalled", () => {
    state.installPrompt = null;
    if (state.page === "Личный кабинет") renderProfile();
  });
  window.addEventListener("load", initializePwa);
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) reconnectCloud();
  });
}
export function installApplication(event, element) {
  return installFinanceApp();
}
export function changeOfflineAccess(event, element) {
  return toggleOfflineAccess(element.checked);
}
export async function prepareOfflineOCR() {
  const worker = navigator.serviceWorker?.controller || state.pwaRegistration?.active;
  if (!worker) {
    state.pwaMessage = "Дождитесь подготовки приложения и повторите.";
    renderProfile();
    return;
  }
  state.pwaMessage = "Подготавливаем распознавание…";
  renderProfile();
  const channel = new MessageChannel();
  try {
    const response = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        channel.port1.close();
        reject(Error("Загрузка не завершилась. Проверьте соединение и повторите."));
      }, 120000);
      channel.port1.onmessage = (event) => {
        clearTimeout(timer);
        channel.port1.close();
        resolve(event.data);
      };
      worker.postMessage({ type: "PREPARE_OCR" }, [channel.port2]);
    });
    state.pwaMessage = response.ready
      ? "Распознавание готово к работе без интернета."
      : response.error || "Не удалось подготовить распознавание.";
  } catch (error) {
    state.pwaMessage = error.message;
  }
  renderProfile();
}
