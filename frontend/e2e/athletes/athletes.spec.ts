import { test, expect } from "../fixtures";
import { storageStateFor } from "../helpers/roles";
import { deleteAthlete } from "../helpers/backend";

/**
 * Group 9 — athletes registry (/athletes).
 *
 * Spectators get a read-only view; coaches (and admins) can manage their club's
 * athletes. The management spec drives the full create → delete cycle in list
 * view, where rows expose stable role="row" accessible names, and cleans up
 * after itself via the backend in case an assertion aborts mid-flow.
 */

test.describe("athletes (spectator, read-only)", () => {
  test.use({ storageState: storageStateFor("spectator") });

  test("renders the registry without management controls", async ({ page }) => {
    await page.goto("/athletes");
    await expect(page.getByRole("heading", { name: "Атлети" })).toBeVisible();
    await expect(page.getByPlaceholder("Пошук за ім'ям або клубом...")).toBeVisible();
    await expect(page.getByRole("button", { name: "Додати атлета" })).toHaveCount(0);
  });

  test("the card/list view toggle is reflected in the URL", async ({ page }) => {
    await page.goto("/athletes");
    await page.getByRole("button", { name: "Список" }).click();
    await expect(page).toHaveURL(/view=list/);
    await page.getByRole("button", { name: "Картки" }).click();
    await expect(page).toHaveURL(/view=cards/);
  });
});

test.describe("athletes (coach, management)", () => {
  test.use({ storageState: storageStateFor("coach") });

  test("a coach can create and then delete an athlete", async ({ page }) => {
    const lastName = `E2EAthlete${Date.now()}`;
    try {
      await page.goto("/athletes?view=list");
      await page.getByRole("button", { name: "Додати атлета" }).click();

      const dialog = page.getByRole("dialog");
      await expect(dialog.getByText("Новий атлет")).toBeVisible();
      await dialog.getByPlaceholder("Іван").fill("Тест");
      await dialog.getByPlaceholder("Петренко").fill(lastName);
      await dialog.locator('input[type="date"]').fill("2010-05-15");
      await dialog.getByPlaceholder("68.5").fill("55");
      await dialog.getByRole("button", { name: "Додати" }).click();

      await expect(page.getByText("Атлета додано!", { exact: true })).toBeVisible();
      const row = page.getByRole("row", { name: new RegExp(lastName) });
      await expect(row).toBeVisible();

      // Delete it again (the second action button on the row is the trash icon).
      await row.getByRole("button").nth(1).click();
      await expect(page.getByText("Видалити спортсмена?")).toBeVisible();
      await page.getByRole("button", { name: "Видалити" }).click();
      await expect(page.getByText("Атлета видалено!", { exact: true })).toBeVisible();
      await expect(page.getByRole("row", { name: new RegExp(lastName) })).toHaveCount(0);
    } finally {
      deleteAthlete(lastName);
    }
  });

  test("the create dialog can be cancelled", async ({ page }) => {
    await page.goto("/athletes");
    await page.getByRole("button", { name: "Додати атлета" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Новий атлет")).toBeVisible();
    await dialog.getByRole("button", { name: "Скасувати" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});
