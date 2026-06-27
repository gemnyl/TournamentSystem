import { test, expect } from "../fixtures";
import type { Page } from "@playwright/test";
import { storageStateFor, CREDENTIALS, E2E_PASSWORD } from "../helpers/roles";
import { createVerifiedUser, createCompleteUser, deleteUser } from "../helpers/backend";

/**
 * Group 7 — profile page (/profile): personal data, security, role requests.
 *
 * Read-only / client-only checks run against the shared spectator seed. Every
 * test that mutates server state (profile save, password change, role request)
 * uses a throwaway user signed in through the UI, so the shared storageState
 * sessions are never invalidated and the data is cleaned up afterwards.
 */

async function signIn(page: Page, email: string, password = E2E_PASSWORD): Promise<void> {
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Увійти" }).click();
  // Wait for the post-login landing before the test navigates elsewhere,
  // otherwise an early goto() aborts the in-flight login request.
  await expect(page).toHaveURL(/\/tournaments$/);
}

test.describe("profile (spectator, read-only)", () => {
  test.use({ storageState: storageStateFor("spectator") });

  test("renders the header and the three tabs", async ({ page }) => {
    await page.goto("/profile");
    await expect(page.getByText(CREDENTIALS.spectator.email)).toBeVisible();
    await expect(page.getByRole("button", { name: "Мій профіль" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Безпека" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Верифікація ролей" })).toBeVisible();
  });

  test("the security tab rejects mismatched new passwords client-side", async ({ page }) => {
    await page.goto("/profile");
    await page.getByRole("button", { name: "Безпека" }).click();
    await page.locator("#old_password").fill("whatever-current");
    await page.locator("#new_password").fill("NewPass111!");
    await page.locator("#confirm_password").fill("NewPass222!");
    await page.getByRole("button", { name: "Змінити пароль" }).click();
    await expect(page.getByText("Нові паролі не збігаються.", { exact: true })).toBeVisible();
  });

  test("the roles tab shows the current role and a request form", async ({ page }) => {
    await page.goto("/profile");
    await page.getByRole("button", { name: "Верифікація ролей" }).click();
    await expect(page.getByText("Поточний статус ролі")).toBeVisible();
    await expect(page.getByText("Подати заявку на верифікацію")).toBeVisible();
  });
});

test.describe("profile (mutations, isolated users)", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("an incomplete profile is forced to /profile with a completion notice", async ({ page }) => {
    const email = `e2e_profile_incomplete_${Date.now()}@test.local`;
    createVerifiedUser(email); // no phone / birth date
    try {
      await signIn(page, email);
      // A guarded route bounces an incomplete profile to /profile.
      await page.goto("/athletes");
      await expect(page).toHaveURL(/\/profile$/);
      await expect(page.getByText("Завершення реєстрації")).toBeVisible();
    } finally {
      deleteUser(email);
    }
  });

  test("saving the profile persists across a reload", async ({ page }) => {
    const email = `e2e_profile_save_${Date.now()}@test.local`;
    createCompleteUser(email);
    try {
      await signIn(page, email);
      await page.goto("/profile");
      await page.locator("#phone").fill("+380990000000");
      await page.getByRole("button", { name: "Зберегти зміни" }).click();
      await expect(page.getByText("Профіль оновлено", { exact: true })).toBeVisible();

      await page.reload();
      await expect(page.locator("#phone")).toHaveValue("+380990000000");
    } finally {
      deleteUser(email);
    }
  });

  test("a user can change their password", async ({ page }) => {
    const email = `e2e_profile_pwd_${Date.now()}@test.local`;
    createCompleteUser(email);
    try {
      await signIn(page, email);
      await page.goto("/profile");
      await page.getByRole("button", { name: "Безпека" }).click();
      await page.locator("#old_password").fill(E2E_PASSWORD);
      await page.locator("#new_password").fill("Changed999!");
      await page.locator("#confirm_password").fill("Changed999!");
      await page.getByRole("button", { name: "Змінити пароль" }).click();
      await expect(page.getByText("Пароль змінено", { exact: true })).toBeVisible();
    } finally {
      deleteUser(email);
    }
  });

  test("a spectator can submit a coach role request", async ({ page }) => {
    const email = `e2e_profile_role_${Date.now()}@test.local`;
    createCompleteUser(email);
    try {
      await signIn(page, email);
      await page.goto("/profile");
      await page.getByRole("button", { name: "Верифікація ролей" }).click();

      await page.locator("#requested_role").click();
      // Radix Select renders options in a portal — wait for the listbox to open.
      await expect(page.getByRole("listbox")).toBeVisible();
      await page.getByRole("option", { name: "Тренер" }).click();
      // The club field is conditionally rendered after "Тренер" is selected.
      await expect(page.locator("#req_club")).toBeVisible();
      await page.locator("#req_club").fill("E2E Тестовий клуб");
      await page.getByRole("button", { name: "Надіслати заявку на верифікацію" }).click();

      await expect(page.getByText("Запит надіслано", { exact: true })).toBeVisible();
      await expect(page.getByText("Заявка на верифікацію очікує перевірки")).toBeVisible();
    } finally {
      deleteUser(email);
    }
  });
});
