// Test-only bridge keeps established behavior regressions usable after the ESM migration.
// Production modules never install globals; real ESM linking is checked separately.
import nativeVM from "node:vm";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
const initialized = new WeakSet();
const classic = (code) =>
  code
    .replace(/^import[\s\S]*?(?:from\s*)?["'][^"'\n]+["'];?\s*/gm, "")
    .replace(/\bexport\s+(?=(?:async\s+)?(?:function|const|let|var))/g, "")
    .replace(/^const /gm, "var ");
function setup(context) {
  // Some established suites replace their DOM between scenarios in one VM.
  const currentQuery = context.document?.querySelector;
  if (currentQuery && !currentQuery.normalizesElements) {
    const wrapped = (...args) => {
      const element = currentQuery(...args);
      if (element) {
        element.dataset ||= {};
        element.classList ||= {
          toggle() {},
          contains() {
            return false;
          },
        };
        element.classList.add ||= () => {};
        element.classList.remove ||= () => {};
        element.setAttribute ||= (name, value) => {
          element[name] = value;
        };
      }
      return element;
    };
    wrapped.normalizesElements = true;
    context.document.querySelector = wrapped;
  }
  if (initialized.has(context)) return;
  initialized.add(context);
  for (const [key, value] of Object.entries({
    TextEncoder,
    TextDecoder,
    Blob,
    URL,
    AbortController,
    crypto: webcrypto,
    structuredClone,
  }))
    if (!context[key]) context[key] = value;
  context.window ||= {};
  context.window.addEventListener ||= () => {};
  context.document ||= {};
  context.document.addEventListener ||= () => {};
  context.document.querySelectorAll ||= () => [];
  context.document.getElementById ||= () => null;
  nativeVM.runInContext(classic(readFileSync("public/state.js", "utf8")), context);
  for (const key of Object.keys(context.state)) {
    const prior = context[key];
    if (prior !== undefined) context.state[key] = prior;
    Object.defineProperty(context, key, {
      configurable: true,
      get: () => context.state[key],
      set: (value) => (context.state[key] = value),
    });
  }
  const normalizeElement = (element) => {
    if (element) {
      element.dataset ||= {};
      element.classList ||= {
        toggle() {},
        contains() {
          return false;
        },
      };
      element.classList.add ||= () => {};
      element.classList.remove ||= () => {};
      element.setAttribute ||= (name, value) => {
        element[name] = value;
      };
    }
    return element;
  };
  const query = context.document.querySelector;
  if (query) context.document.querySelector = (...args) => normalizeElement(query(...args));
  const priorSelector = context.$;
  const selector = priorSelector ? (...args) => normalizeElement(priorSelector(...args)) : null;
  for (const file of [
    "money.js",
    "data-model.js",
    "budget-schema.js",
    "format.js",
    "dates.js",
    "screenshot-source.js",
    "appearance.js",
    "icons.js",
    "shell-ui.js",
    "operations-ui.js",
    "analytics-ui.js",
    "operation-form.js",
    "release-info.js",
  ])
    nativeVM.runInContext(classic(readFileSync("public/" + file, "utf8")), context);
  if (selector) context.$ = selector;
  context.initializeEvents ||= () => {};
  for (const name of [
    "offlineAccess",
    "forgetOfflineAccess",
    "pwaCardHtml",
    "backupControls",
    "uploadQueuedScreenshots",
    "claimGuestArchivesForMigration",
    "purgeOwnerLocalData",
    "vaultDeleteOwned",
    "preserveLegacyBudget",
  ])
    context[name] ||= () => null;
}
export default {
  ...nativeVM,
  runInContext(code, context, options) {
    setup(context);
    const result = nativeVM.runInContext(classic(code), context, options);
    if (code.includes("export const FinanceOCR")) context.window.FinanceOCR = context.FinanceOCR;
    return result;
  },
};
