import { test, expect } from "../fixtures";
import { storageStateFor } from "../helpers/roles";
import { newApiContext, createTournament } from "../helpers/api";
import { deleteTournament } from "../helpers/backend";

/**
 * Group 13 — tatami administration (/tournaments/:tid/tatamis).
 *
 * canEdit is ownership-based (user.id === tournament.organizer), so the
 * management flow runs against an isolated tournament owned by the organizer.
 * The read-only check uses the judge assigned to the seed tournament.
 */

test.describe("tatami admin (organizer, management)", () => {
  test.use({ storageState: storageStateFor("organizer") });

  test("create then delete a tatami", async ({ page }) => {
    const title = `E2E Tatami ${Date.now()}`;
    const api = await newApiContext("organizer");
    try {
      const tid = await createTournament(api, { title, status: "registration" });
      await page.goto(`/tournaments/${tid}/tatamis`);
      await expect(page.getByRole("heading", { level: 1, name: "Керування татамі" })).toBeVisible();
      await expect(page.getByText("Татамі ще не створено")).toBeVisible();

      await page.getByRole("button", { name: "Додати татамі" }).first().click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByText("Нове татамі")).toBeVisible();
      await dialog.locator("#number").fill("9");
      await dialog.getByRole("button", { name: "Створити" }).click();

      await expect(page.getByText("Татамі успішно створено!", { exact: true })).toBeVisible();
      const row = page.getByRole("row", { name: /Татамі 9/ });
      await expect(row).toBeVisible();

      // Row buttons are [status toggle, edit, delete]; the trash is the third.
      await row.getByRole("button").nth(2).click();
      const delDialog = page.getByRole("dialog");
      await expect(delDialog.getByRole("heading", { name: "Видалити татамі" })).toBeVisible();
      await delDialog.getByRole("button", { name: "Видалити" }).click();

      await expect(page.getByText("Татамі успішно видалено!", { exact: true })).toBeVisible();
      await expect(page.getByRole("row", { name: /Татамі 9/ })).toHaveCount(0);
    } finally {
      deleteTournament(title);
      await api.dispose();
    }
  });

  test("the create dialog can be cancelled", async ({ page }) => {
    const title = `E2E Tatami Cancel ${Date.now()}`;
    const api = await newApiContext("organizer");
    try {
      const tid = await createTournament(api, { title, status: "registration" });
      await page.goto(`/tournaments/${tid}/tatamis`);
      await page.getByRole("button", { name: "Додати татамі" }).first().click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByText("Нове татамі")).toBeVisible();
      await dialog.getByRole("button", { name: "Скасувати" }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
    } finally {
      deleteTournament(title);
      await api.dispose();
    }
  });
});

test.describe("tatami admin (judge, read-only)", () => {
  test.use({ storageState: storageStateFor("judge") });

  test("an assigned judge gets a read-only view of the seed tournament", async ({
    page,
    seedIds,
  }) => {
    await page.goto(`/tournaments/${seedIds.tournament}/tatamis`);
    await expect(page.getByRole("heading", { level: 1, name: "Керування татамі" })).toBeVisible();
    await expect(page.getByText("Суддя (перегляд)")).toBeVisible();
    await expect(page.getByRole("button", { name: "Додати татамі" })).toHaveCount(0);
  });
});
