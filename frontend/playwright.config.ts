import { defineConfig, devices } from "@playwright/test";

/**
 * E2E config — runs against the live docker-compose stack.
 *
 *   Frontend (nginx + SPA): http://localhost
 *   Backend  (Daphne/DRF):  proxied under http://localhost/api
 *
 * Override the target with E2E_BASE_URL and the backend container name with
 * E2E_BACKEND_CONTAINER (see e2e/helpers/backend.ts).
 *
 * global-setup seeds users + baseline data and writes per-role storageState.
 */
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  globalSetup: "./e2e/global-setup.ts",

  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  workers: process.env.CI ? 2 : 4,

  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],

  timeout: 45_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: BASE_URL,
    actionTimeout: 15_000,
    navigationTimeout: 20_000,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    locale: "uk-UA",
    timezoneId: "Europe/Kyiv",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
