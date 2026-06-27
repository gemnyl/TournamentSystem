import { test, expect } from "../fixtures";

/**
 * Group 20 — global ratings (/ratings), deeper coverage.
 *
 * Public page. It defaults to the "regions" leaderboard and mirrors the active
 * board into ?tab=. Each board has its own search box and empty-state message.
 * A nonsense query always collapses the table to the empty row, regardless of
 * whether any completed-tournament medals exist, so the search assertions are
 * stable in parallel runs.
 */

test.describe("global ratings (anonymous)", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("the regions board is the default and shows its column header", async ({ page }) => {
    await page.goto("/ratings");
    await expect(page.getByRole("heading", { name: /Рейтинг України/ })).toBeVisible();
    await expect(page.getByText("Глобальний залік")).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Область України" })).toBeVisible();
  });

  test("switching to the clubs board updates the URL and header", async ({ page }) => {
    await page.goto("/ratings");
    await page.getByRole("button", { name: "Рейтинг клубів" }).click();
    await expect(page).toHaveURL(/tab=clubs/);
    await expect(page.getByRole("columnheader", { name: "Спортивний клуб" })).toBeVisible();
  });

  test("deep-linking ?tab=clubs restores the clubs board", async ({ page }) => {
    await page.goto("/ratings?tab=clubs");
    await expect(page.getByRole("columnheader", { name: "Спортивний клуб" })).toBeVisible();
  });

  test("a nonsense search collapses each board to its empty state", async ({ page }) => {
    await page.goto("/ratings");
    await page.getByPlaceholder("Пошук області...").fill("zzz-no-such-region");
    await expect(page.getByText("Області за вашим запитом не знайдені")).toBeVisible();

    await page.getByRole("button", { name: "Рейтинг клубів" }).click();
    await page.getByPlaceholder("Пошук клубу чи області...").fill("zzz-no-such-club");
    await expect(page.getByText("Спортивні клуби за вашим запитом не знайдені")).toBeVisible();
  });
});
