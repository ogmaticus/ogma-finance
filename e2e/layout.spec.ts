import { test, expect, type Page } from "@playwright/test";

async function openAnalytics(page: Page) {
  await page.locator('#nav [data-page="Ещё"]').click();
  await page.locator('#content [data-page="Аналитика"]').click();
}
async function openReview(page: Page) {
  await page.getByRole("button", { name: "Добавить операцию", exact: true }).click();
  await page.getByRole("button", { name: /Со скриншота/ }).click();
  await page.getByText("Дополнительно", { exact: true }).click();
  await page.getByRole("button", { name: "Пример", exact: true }).click();
  await expect(page.locator("#importlist")).toContainText("Стрелка");
}
test.beforeEach(async ({ page }) => {
  await page.route("**/api/session", (route) => route.fulfill({ json: { user: null } }));
  await page.addInitScript(() => localStorage.setItem("finance-view-month", "2026-09"));
});
for (const width of [900, 1100, 1440]) {
  test(`sidebar never covers main at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const response = await page.goto("/finance");
    expect(response?.headers()["content-security-policy"]).toContain("script-src");
    const geometry = await page.evaluate(() => ({
      main: document.querySelector("main")!.getBoundingClientRect().left,
      sidebar: document.querySelector("aside")!.getBoundingClientRect().right,
    }));
    expect(geometry.main).toBeGreaterThanOrEqual(geometry.sidebar);
  });
}
test("longest month fits at 360px", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 844 });
  await page.goto("/finance");
  await expect(page.locator("#monthlabel")).toHaveText("Сентябрь 2026");
  const fit = await page.locator("#monthlabel").evaluate((el) => el.scrollWidth <= el.clientWidth);
  expect(fit).toBe(true);
});
test("six months fit; twelve months reveal selected month", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/finance");
  await openAnalytics(page);
  const six = await page
    .locator(".chart-scroll")
    .evaluate((el) => ({ scroll: el.scrollWidth, width: el.clientWidth, left: el.scrollLeft }));
  expect(six.scroll).toBeLessThanOrEqual(six.width + 1);
  expect(six.left).toBe(0);
  await page.getByRole("button", { name: "12 мес.", exact: true }).click();
  const visible = await page.evaluate(() => {
    const viewport = document.querySelector(".chart-scroll")!.getBoundingClientRect();
    const month = document
      .querySelector('.flow-chart g[data-month="2026-09"]')!
      .getBoundingClientRect();
    return month.left >= viewport.left && month.right <= viewport.right + 1;
  });
  expect(visible).toBe(true);
});
test("review removes bottom navigation and month; Back restores navigation", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/finance");
  await openReview(page);
  await expect(page.locator("aside")).toBeHidden();
  await expect(page.locator(".month-control")).toBeHidden();
  await expect(page.locator("#bulkaccount option").first()).toHaveText(
    "Автоматически по скриншоту",
  );
  await page.getByRole("button", { name: "Назад из импорта" }).click();
  await expect(page.locator("aside")).toBeVisible();
});
for (const theme of ["light", "dark"])
  for (const screen of ["overview", "analytics", "review"]) {
    test(`screenshot ${theme} ${screen}`, async ({ page }, info) => {
      await page.addInitScript((mode) => localStorage.setItem("finance-theme-mode", mode), theme);
      await page.goto("/finance");
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      if (screen === "analytics") await openAnalytics(page);
      if (screen === "review") await openReview(page);
      await info.attach(`${info.project.name}-${theme}-${screen}`, {
        body: await page.screenshot({ fullPage: true, animations: "disabled" }),
        contentType: "image/png",
      });
    });
  }
