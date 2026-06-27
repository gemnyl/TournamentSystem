import { test, expect } from "../fixtures";
import { storageStateFor } from "../helpers/roles";

/**
 * Group 8 — public pages and global navigation.
 *
 * /tournaments, /ratings and /privacy-policy are reachable without signing in.
 * Navigation lives in AppLayout's header (and footer for the privacy link).
 */

test.describe("public pages (anonymous)", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("the tournament list renders and shows the seeded tournament", async ({ page }) => {
    await page.goto("/tournaments");
    await expect(page.getByRole("heading", { name: "Турніри" })).toBeVisible();
    await expect(page.getByText("E2E Seed Tournament")).toBeVisible();
  });

  test("searching the tournament list filters results", async ({ page }) => {
    await page.goto("/tournaments");
    await expect(page.getByText("E2E Seed Tournament")).toBeVisible();
    await page.getByPlaceholder("Пошук за назвою або місцем...").fill("zzz-no-such-tournament");
    await expect(page.getByText("Турнірів не знайдено")).toBeVisible();
  });

  test("the ratings page renders with region and club tabs", async ({ page }) => {
    await page.goto("/ratings");
    await expect(page.getByRole("heading", { name: /Рейтинг України/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Рейтинг областей" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Рейтинг клубів" })).toBeVisible();
  });

  test("the privacy policy page renders", async ({ page }) => {
    await page.goto("/privacy-policy");
    await expect(
      page.getByRole("heading", { name: /Політика конфіденційності/ }),
    ).toBeVisible();
  });

  test("an unknown route shows the 404 page and links home", async ({ page }) => {
    await page.goto("/this-route-does-not-exist");
    await expect(page.getByRole("heading", { name: "404" })).toBeVisible();
    await expect(page.getByText("Сторінку не знайдено")).toBeVisible();
    await page.getByRole("link", { name: "На головну" }).click();
    await expect(page).toHaveURL(/\/tournaments$/);
  });

  test("anonymous visitors do not see the Athletes nav link", async ({ page }) => {
    await page.goto("/tournaments");
    await expect(page.getByRole("link", { name: "Атлети" })).toHaveCount(0);
  });
});

test.describe("header & footer navigation", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("the header links move between tournaments and ratings", async ({ page }) => {
    await page.goto("/tournaments");
    await page.getByRole("link", { name: "Рейтинги" }).click();
    await expect(page).toHaveURL(/\/ratings$/);
    await expect(page.getByRole("heading", { name: /Рейтинг України/ })).toBeVisible();
  });

  test("the footer link opens the privacy policy", async ({ page }) => {
    await page.goto("/tournaments");
    await page.getByRole("link", { name: "Політика конфіденційності" }).click();
    await expect(page).toHaveURL(/\/privacy-policy$/);
  });
});

test.describe("authenticated navigation (spectator)", () => {
  test.use({ storageState: storageStateFor("spectator") });

  test("a signed-in user sees the Athletes nav link and can open it", async ({ page }) => {
    await page.goto("/tournaments");
    await page.getByRole("link", { name: "Атлети" }).click();
    await expect(page).toHaveURL(/\/athletes$/);
    await expect(page.getByRole("heading", { name: "Атлети" })).toBeVisible();
  });
});
