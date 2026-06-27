import { test, expect } from "../fixtures";
import { storageStateFor } from "../helpers/roles";

/**
 * Group 17 — coach dashboard (/coach/dashboard).
 *
 * ProtectedRoute gates the page to the coach role; the seed coach has a complete
 * profile (phone + birth date) so it never bounces to /profile. The dashboard is
 * a single page with button-driven tabs whose active tab is mirrored into the
 * ?tab= query param, so navigation can be asserted both by clicking and by deep
 * link. Assertions stick to the seed club's roster and to the data-free tabs
 * (Live, billing) whose empty states are stable across parallel runs.
 */

test.describe("coach dashboard (coach)", () => {
  test.use({ storageState: storageStateFor("coach") });

  test("the roster tab lists the seed club's athletes", async ({ page }) => {
    await page.goto("/coach/dashboard");

    await expect(page.getByRole("heading", { level: 1, name: "Панель тренера" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Реєстр спортсменів" })).toBeVisible();
    // Seed athletes belong to this coach and are never mutated by other specs.
    await expect(page.getByRole("heading", { name: "Боєць Андрій" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Імпорт з CSV/Excel" })).toBeVisible();
  });

  test("clicking the tabs switches panes and syncs the URL", async ({ page }) => {
    await page.goto("/coach/dashboard");

    await page.getByRole("button", { name: "Live Scoreboard" }).click();
    await expect(page).toHaveURL(/tab=live/);
    await expect(page.getByRole("heading", { name: "Live Scoreboard Tracker" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Немає активних поєдинків" })).toBeVisible();

    await page.getByRole("button", { name: "Рахунки та оплата" }).click();
    await expect(page).toHaveURL(/tab=billing/);
    await expect(
      page.getByRole("heading", { name: "Розрахункові рахунки та оплати" }),
    ).toBeVisible();
  });

  test("deep-linking a tab via the URL restores it on load", async ({ page }) => {
    await page.goto("/coach/dashboard?tab=live");
    await expect(page.getByRole("heading", { name: "Live Scoreboard Tracker" })).toBeVisible();
  });
});
