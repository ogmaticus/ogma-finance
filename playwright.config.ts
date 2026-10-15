import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "e2e",
  use: { baseURL: process.env.E2E_BASE_URL || "http://127.0.0.1:5173" },
  projects: [
    { name: "mobile", use: { viewport: { width: 390, height: 844 } } },
    { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npm run dev -- --host 127.0.0.1 --port 5173",
        url: "http://127.0.0.1:5173/finance",
        reuseExistingServer: !process.env.CI,
      },
  reporter: "list",
});
