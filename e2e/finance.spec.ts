import { test, expect } from "@playwright/test";
test.beforeEach(async ({ page }) => {
  await page.route("**/api/session", (route) => route.fulfill({ json: { user: null } }));
  await page.goto("/finance");
});
test("manual operation uses integer kopecks and persists", async ({ page }) => {
  await page.getByRole("button", { name: "Добавить операцию", exact: true }).click();
  await page.getByRole("button", { name: /Добавить вручную/ }).click();
  await page.locator('#form [name="name"]').fill("Тестовая покупка");
  await page.locator('#form [name="amount"]').fill("12.34");
  await page.locator("#form button.primary").click();
  const data = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("finance-prototype-v1") || "{}"),
  );
  expect(data.ops.find((op: any) => op.name === "Тестовая покупка").amountMinor).toBe(1234);
});
test("demo screenshot rows can be completed and imported", async ({ page }) => {
  await page.getByRole("button", { name: "Добавить операцию", exact: true }).click();
  await page.getByRole("button", { name: /Со скриншота/ }).click();
  await page.getByText("Дополнительно", { exact: true }).click();
  await page.getByRole("button", { name: "Пример", exact: true }).click();
  await expect(page.locator("#importlist")).toContainText("Стрелка");
  await page.locator(".import-settings summary").click();
  await page.locator("#bulkdate").fill("2026-10-14");
  await page.locator("#bulkdate").dispatchEvent("change");
  await page.locator("#importlist .import-item-main").last().click();
  await page.locator('#importeditform [name="type"]').selectOption("income");
  await page.locator("#importeditform button.primary").click();
  await page.getByRole("button", { name: /Добавить \d+ операций/ }).click();
  await expect(page.locator("#content")).toContainText("Операции добавлены");
  await page.getByRole("button", {name:"Открыть операции",exact:true}).click();
  await expect(page.locator("#title")).toHaveText("Операции");
});
test("category limit opens, saves and is shown", async ({ page }) => {
  await page.locator('#nav [data-page="Бюджет"]').click();
  await page.locator("#content .compact-budget-row").first().click();
  await expect(page.locator("#budgetlimitdialog")).toBeVisible();
  await page.locator("#budgetlimitamount").fill("1234.56");
  await page.locator("#budgetlimitdialog button.primary").click();
  await expect(page.locator("#budgetlimitdialog")).not.toBeVisible();
});
test("logout removes only signed-in owners data", async ({ page }) => {
  await page.route("**/api/session", (route) =>
    route.fulfill({
      json: {
        user: { id: "e2e", name: "Тест", email: "test@example.test" },
        signOutUrl: "/signed-out",
      },
    }),
  );
  await page.route("**/api/budget", (route) =>
    route.fulfill({ json: { revision: 0, data: null, generation: 0 } }),
  );
  await page.route("**/api/backups", (route) => route.fulfill({ json: { versions: [] } }));
  await page.route("**/api/files", (route) => route.fulfill({ json: { files: [] } }));
  await page.route("**/signed-out", (route) =>
    route.fulfill({ contentType: "text/html", body: "Выход" }),
  );
  await page.reload();
  await page.locator('#nav [data-page="Ещё"]').click();
  await page.locator('#content [data-page="Личный кабинет"]').click();
  await page.getByRole("button", { name: "Выйти", exact: true }).click();
  await expect(page).toHaveURL(/signed-out$/);
  expect(await page.evaluate(() => localStorage.getItem("finance-user-e2e"))).toBeNull();
});
