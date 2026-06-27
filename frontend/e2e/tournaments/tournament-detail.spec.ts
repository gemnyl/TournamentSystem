import { test, expect } from "../fixtures";
import { storageStateFor } from "../helpers/roles";
import { newApiContext, createTournament } from "../helpers/api";
import { deleteTournament } from "../helpers/backend";

/**
 * Group 10 — tournament detail page (/tournaments/:id).
 *
 * Read-only assertions run against the shared seed tournament; they never assert
 * volatile counts because parallel specs mutate categories/registrations. Every
 * mutating flow (create category, lifecycle transition) spins up an isolated
 * tournament via the organizer API and tears it down afterwards.
 */

test.describe("tournament detail (anonymous, read-only)", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("renders the seed tournament header and the four tabs", async ({ page, seedIds }) => {
    await page.goto(`/tournaments/${seedIds.tournament}`);
    await expect(
      page.getByRole("heading", { level: 1, name: "E2E Seed Tournament" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Інформація" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Категорії" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Учасники" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Результати" })).toBeVisible();
  });

  test("the categories tab lists the seeded category and syncs the URL", async ({
    page,
    seedIds,
  }) => {
    await page.goto(`/tournaments/${seedIds.tournament}`);
    await page.getByRole("button", { name: "Категорії" }).click();
    await expect(page).toHaveURL(/tab=categories/);
    await expect(page.getByText("Куміте Ю16 -60кг")).toBeVisible();
  });

  test("an anonymous visitor sees no management controls", async ({ page, seedIds }) => {
    await page.goto(`/tournaments/${seedIds.tournament}`);
    await expect(page.getByRole("button", { name: "Редагувати" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Вилучити турнір" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Керування татамі" })).toHaveCount(0);
  });
});

test.describe("tournament detail (organizer, management)", () => {
  // A tall viewport keeps long dialogs (category create) fully on-screen so the
  // submit button is never clipped below the fold.
  test.use({ storageState: storageStateFor("organizer"), viewport: { width: 1280, height: 1800 } });

  test("the owning organizer sees management controls", async ({ page, seedIds }) => {
    await page.goto(`/tournaments/${seedIds.tournament}`);
    await expect(page.getByRole("button", { name: "Редагувати", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Вилучити турнір" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Керування татамі" })).toBeVisible();

    await page.getByRole("button", { name: "Категорії" }).click();
    await expect(page.getByRole("button", { name: "Додати категорію" })).toBeVisible();
  });

  test("a category can be created through the dialog", async ({ page }) => {
    const title = `E2E Detail Cat ${Date.now()}`;
    const api = await newApiContext("organizer");
    try {
      const id = await createTournament(api, { title, status: "registration" });
      await page.goto(`/tournaments/${id}?tab=categories`);
      await page.getByRole("button", { name: "Додати категорію" }).click();

      const dialog = page.getByRole("dialog");
      await expect(dialog.getByText("Нова категорія")).toBeVisible();
      await dialog.getByPlaceholder("Кадети до 50 кг, чол.").fill("E2E UI Категорія");
      await dialog.getByPlaceholder("14").fill("10");
      await dialog.getByPlaceholder("17").fill("80");
      // Ruleset is required; open the Select and take the first sport-matched option.
      await dialog.getByRole("combobox").filter({ hasText: "Оберіть правила" }).click();
      await page.getByRole("option").first().click();
      await dialog.getByRole("button", { name: "Створити" }).click();

      await expect(page.getByText("Категорію створено!", { exact: true })).toBeVisible();
      await expect(page.getByText("E2E UI Категорія")).toBeVisible();
    } finally {
      deleteTournament(title);
      await api.dispose();
    }
  });

  test("the lifecycle buttons drive draft → registration → active", async ({ page }) => {
    const title = `E2E Lifecycle ${Date.now()}`;
    const api = await newApiContext("organizer");
    try {
      const id = await createTournament(api, { title, keepDraft: true });
      await page.goto(`/tournaments/${id}`);

      await page.getByRole("button", { name: "Відкрити реєстрацію" }).click();
      await expect(page.getByText("Реєстрацію відкрито", { exact: true })).toBeVisible();

      await page.getByRole("button", { name: "Розпочати" }).click();
      await expect(page.getByText("Турнір розпочато", { exact: true })).toBeVisible();
    } finally {
      deleteTournament(title);
      await api.dispose();
    }
  });
});
