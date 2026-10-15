import {
  chooseOperationType,
  chooseOperationCategory,
  chooseOperationDate,
  showOperationDate,
  updateOperationForm,
} from "./operation-form.js?v=32";
import { setAnalyticsRange } from "./analytics-ui.js?v=32";
import {
  toggleOperationFilters,
  updateOperationFilters,
  resetOperationFilters,
} from "./operations-ui.js?v=32";
import {
  navigatePage,
  openAddChooser,
  closeAddChooser,
  chooseAdd,
  openOverviewOperation,
} from "./shell-ui.js?v=32";
import { downloadMigrationCopy } from "./migration-copy.js?v=32";
import { selectTheme, toggleTheme } from "./appearance.js?v=32";
import {
  go,
  edit,
  removeCategoryRule,
  viewLocalScreenshot,
  editOperationFromList,
  showOperations,
  openScreenshotImport,
  showBudget,
  editAccountById,
  deleteAccountById,
  createAccount,
  showIndexedCategoryHistory,
  fundGoalById,
  editGoalById,
  deleteGoalById,
  createGoal,
} from "./app.js?v=32";
import { shiftFinanceMonth, openMonthPicker, applyMonthPicker } from "./month-picker.js?v=32";
import {
  prepareOfflineOCR,
  applyFinanceUpdate,
  installApplication,
  changeOfflineAccess,
} from "./pwa.js?v=32";
import { retryScreenshotArchives } from "./file-vault.js?v=32";
import { animateDialogClose, showNotice } from "./ui.js?v=32";
import {
  restartImport,
  showImportBulkDate,
  setImportInlineField,
  saveImportEdit,
  pickScreenshotFiles,
  cancelScreenshotRecognition,
  retryScreenshotRecognition,
  changeImportAccount,
  changeImportYear,
  changeMissingImportDate,
  changeAllImportDates,
  changeTransferAccountSide,
  selectAllImportRows,
  deselectAllImportRows,
  createImportRow,
  changeBankCategoryPreference,
  toggleImportIssues,
  saveScreenshotOperations,
  loadImportExample,
  toggleImportRow,
  editImportRow,
  changeImportEditType,
  changeImportEditAccount,
  closeImportEditor,
} from "./import-ui.js?v=32";
import { saveAccountForm, closeAccountEditor } from "./accounts.js?v=32";
import { logoutAccount, downloadLogoutCopy } from "./privacy-ui.js?v=32";
import { confirmAccountDelete, updateAccountDeleteMode } from "./record-actions.js?v=32";
import {
  saveMonthlyLimit,
  showBudgetCategoryHistory,
  editBudgetCategoryLimit,
  showAnalyticsCategoryHistory,
  copyPriorMonthBudget,
} from "./budget-ui.js?v=32";
import {
  downloadFullBackup,
  downloadBudgetJson,
  restoreSelectedBackup,
  restoreLocalBackup,
  refreshAccountProfile,
} from "./backup-ui.js?v=32";
import {
  showHistoryCategory,
  editCategoryTileLimit,
  editHistoryCategoryLimit,
  closeCategoryHistory,
  previousHistoryMonth,
  chooseHistoryMonth,
  nextHistoryMonth,
  clearHistoryMonth,
} from "./category-history.js?v=32";
import {
  syncAccountBudget,
  transferDeviceBudget,
  reviewCloudConflict,
  openAccountLogout,
  restoreSelectedCloudVersion,
  refreshImageArchive,
  removeArchivedScreenshot,
  removeAccountData,
  removeWholeAccount,
  toggleCloudScreenshots,
} from "./sync.js?v=32";
export function openProfile(event, element) {
  return go("Личный кабинет");
}
export function previousFinanceMonth(event, element) {
  return shiftFinanceMonth(-1);
}
export function chooseFinanceMonth(event, element) {
  return openMonthPicker();
}
export function nextFinanceMonth(event, element) {
  return shiftFinanceMonth(1);
}
export function openImportFromHeader(event, element) {
  return go("Импорт");
}
export function createOperationFromHeader(event, element) {
  return edit();
}
export function updateFinanceApp(event, element) {
  return applyFinanceUpdate();
}
export function retryImageArchives(event, element) {
  return retryScreenshotArchives();
}
export function closeOperationDialog(event, element) {
  return animateDialogClose(document.getElementById("modal"));
}
export function submitImportEdit(event, element) {
  return saveImportEdit(event);
}
export function submitAccountForm(event, element) {
  return saveAccountForm(event);
}
export function logoutAfterSync(event, element) {
  return logoutAccount("sync");
}
export function downloadLogoutBackup(event, element) {
  return downloadLogoutCopy();
}
export function logoutWithoutSync(event, element) {
  return logoutAccount("discard");
}
export function closeLogoutDialog(event, element) {
  return animateDialogClose(document.getElementById("logoutdialog"));
}
export function submitAccountDelete(event, element) {
  return confirmAccountDelete(event);
}
export function changeAccountDeleteMode(event, element) {
  return updateAccountDeleteMode();
}
export function closeAccountDeleteDialog(event, element) {
  return animateDialogClose(document.getElementById("deleteaccountdialog"));
}
export function submitMonthPicker(event, element) {
  return applyMonthPicker(event);
}
export function closeMonthPicker(event, element) {
  return animateDialogClose(document.getElementById("monthpickerdialog"));
}
export function submitMonthlyLimit(event, element) {
  return saveMonthlyLimit(event);
}
export function removeMonthlyLimit(event, element) {
  return saveMonthlyLimit(null, true);
}
export function closeBudgetLimitDialog(event, element) {
  return animateDialogClose(document.getElementById("budgetlimitdialog"));
}
export function closeScreenshotPreview(event, element) {
  return animateDialogClose(document.getElementById("screenshotpreview"));
}
export function initializeEvents() {
  for (const type of ["click", "change", "input", "submit"])
    document.addEventListener(type, (event) => {
      const element = event.target.closest?.(`[data-action-event="${type}"]`);
      if (!element) return;
      const action = actions[element.dataset.action];
      if (!action) return;
      if (type === "submit" || element.tagName === "A") event.preventDefault();
      Promise.resolve(action(event, element)).catch((error) => showNotice(error.message));
    });
}
const actions = {
  backFromImport: () => go("Обзор"),
  openBackupSettings: () => go("Личный кабинет"),
  chooseOperationType,
  chooseOperationCategory,
  chooseOperationDate,
  showOperationDate,
  updateOperationForm,
  restartImport,
  showImportBulkDate,
  setImportInlineField,
  setAnalyticsRange,
  toggleOperationFilters,
  updateOperationFilters,
  resetOperationFilters,
  navigatePage,
  openAddChooser,
  closeAddChooser,
  chooseAdd,
  openOverviewOperation,
  selectTheme,
  toggleTheme,
  downloadMigrationCopy,
  prepareOfflineOCR,
  openProfile,
  previousFinanceMonth,
  chooseFinanceMonth,
  nextFinanceMonth,
  openImportFromHeader,
  createOperationFromHeader,
  updateFinanceApp,
  retryImageArchives,
  closeOperationDialog,
  submitImportEdit,
  submitAccountForm,
  logoutAfterSync,
  downloadLogoutBackup,
  logoutWithoutSync,
  closeLogoutDialog,
  submitAccountDelete,
  changeAccountDeleteMode,
  closeAccountDeleteDialog,
  submitMonthPicker,
  closeMonthPicker,
  submitMonthlyLimit,
  removeMonthlyLimit,
  closeBudgetLimitDialog,
  closeScreenshotPreview,
  closeAccountEditor,
  removeCategoryRule,
  viewLocalScreenshot,
  editOperationFromList,
  showOperations,
  openScreenshotImport,
  showBudget,
  editAccountById,
  deleteAccountById,
  createAccount,
  showIndexedCategoryHistory,
  fundGoalById,
  editGoalById,
  deleteGoalById,
  createGoal,
  downloadFullBackup,
  downloadBudgetJson,
  restoreSelectedBackup,
  restoreLocalBackup,
  refreshAccountProfile,
  showBudgetCategoryHistory,
  editBudgetCategoryLimit,
  showAnalyticsCategoryHistory,
  copyPriorMonthBudget,
  showHistoryCategory,
  editCategoryTileLimit,
  editHistoryCategoryLimit,
  closeCategoryHistory,
  previousHistoryMonth,
  chooseHistoryMonth,
  nextHistoryMonth,
  clearHistoryMonth,
  pickScreenshotFiles,
  cancelScreenshotRecognition,
  retryScreenshotRecognition,
  changeImportAccount,
  changeImportYear,
  changeMissingImportDate,
  changeAllImportDates,
  changeTransferAccountSide,
  selectAllImportRows,
  deselectAllImportRows,
  createImportRow,
  changeBankCategoryPreference,
  toggleImportIssues,
  saveScreenshotOperations,
  loadImportExample,
  toggleImportRow,
  editImportRow,
  changeImportEditType,
  changeImportEditAccount,
  closeImportEditor,
  installApplication,
  changeOfflineAccess,
  syncAccountBudget,
  transferDeviceBudget,
  reviewCloudConflict,
  openAccountLogout,
  restoreSelectedCloudVersion,
  refreshImageArchive,
  removeArchivedScreenshot,
  removeAccountData,
  removeWholeAccount,
  toggleCloudScreenshots,
};
