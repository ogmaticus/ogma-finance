const MODES = ["light", "dark", "system"];
const LABELS = { light: "Светлая", dark: "Тёмная", system: "Системная" };
const COLORS = { light: "#f6f8fb", dark: "#0d1320" };
const KEY = "finance-theme-mode";
let preference = "system";
let media;
let initialized = false;
let storageAvailable = true;

function savedPreference() {
  try {
    const value = localStorage.getItem(KEY);
    return MODES.includes(value) ? value : "system";
  } catch {
    return "system";
  }
}
export function resolvedTheme() {
  return preference === "system" ? (media?.matches ? "dark" : "light") : preference;
}
function applyTheme() {
  const theme = resolvedTheme();
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.themeMode = preference;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", COLORS[theme]);
  document
    .querySelector('link[rel="manifest"]')
    ?.setAttribute("href", `/manifest-${theme}.webmanifest`);
  const toggle = document.getElementById("theme-toggle");
  if (toggle) {
    toggle.innerHTML = `${themeIcon(theme)}<span>${LABELS[theme]}</span>`;
    toggle.setAttribute(
      "aria-label",
      `Тема: ${LABELS[theme]}. Переключить на ${theme === "dark" ? "светлую" : "тёмную"}`,
    );
  }
  for (const button of document.querySelectorAll("button[data-theme-mode]")) {
    const selected = button.dataset.themeMode === preference;
    button.setAttribute("aria-pressed", String(selected));
  }
  const status = document.getElementById("theme-save-status");
  if (status)
    status.textContent = storageAvailable
      ? ""
      : "Тема применена. Браузер не разрешил сохранить выбор после закрытия.";
}
export function initializeTheme() {
  if (initialized) return;
  initialized = true;
  media = window.matchMedia?.("(prefers-color-scheme: dark)");
  preference = savedPreference();
  applyTheme();
  const followSystem = () => {
    if (preference === "system") applyTheme();
  };
  if (media?.addEventListener) media.addEventListener("change", followSystem);
  else media?.addListener?.(followSystem);
  window.addEventListener("storage", (event) => {
    if (event.key !== KEY && event.key !== null) return;
    preference = savedPreference();
    storageAvailable = true;
    applyTheme();
  });
}
export function setTheme(mode) {
  if (!MODES.includes(mode)) throw new Error("Неизвестный режим темы");
  preference = mode;
  try {
    localStorage.setItem(KEY, mode);
    storageAvailable = true;
  } catch {
    storageAvailable = false;
  }
  applyTheme();
}
export function selectTheme(event, element) {
  setTheme(element.dataset.themeMode);
}
export function toggleTheme() {
  setTheme(resolvedTheme() === "dark" ? "light" : "dark");
}
function themeIcon(mode) {
  const shapes =
    mode === "dark"
      ? '<path d="M20 13a8 8 0 0 1-9-9 8 8 0 1 0 9 9Z"/>'
      : mode === "light"
        ? '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4m11.2 11.2L19 19M5 19l1.4-1.4M17.6 6.4 19 5"/>'
        : '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/>';
  return `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shapes}</svg>`;
}
export function themeControls() {
  return `<section class="card appearance-card"><h2>Оформление</h2><p class="muted">Системная тема повторяет настройки устройства. Выбор сохраняется в этом браузере.</p><div class="theme-choices" role="group" aria-label="Тема приложения">${MODES.map((mode) => `<button type="button" class="theme-choice" data-action="selectTheme" data-action-event="click" data-theme-mode="${mode}" aria-pressed="${preference === mode}">${themeIcon(mode)}<span>${LABELS[mode]}</span></button>`).join("")}</div><p id="theme-save-status" role="status">${storageAvailable ? "" : "Тема применена. Браузер не разрешил сохранить выбор после закрытия."}</p></section>`;
}
