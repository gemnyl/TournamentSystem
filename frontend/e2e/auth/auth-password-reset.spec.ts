import { test, expect } from "../fixtures";
import { createVerifiedUser, getPasswordResetCode, deleteUser } from "../helpers/backend";

/**
 * Group 4 — password reset (/password-reset).
 *
 * Two stages: (1) request a 6-digit code by email, (2) enter the code + a new
 * password. A non-existent email still returns 200 and advances to stage 2 on
 * purpose (so the form can't be used to enumerate accounts).
 */

test.describe("password reset", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/password-reset");
  });

  test("stage 1 renders and the submit button needs an email", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Відновлення пароля" })).toBeVisible();
    const submit = page.getByRole("button", { name: "Надіслати код" });
    await expect(submit).toBeDisabled();
    await page.locator("#email").fill("someone@test.local");
    await expect(submit).toBeEnabled();
  });

  test("a full reset lets the user sign in with the new password", async ({ page }) => {
    const email = `e2e_reset_ok_${Date.now()}@test.local`;
    createVerifiedUser(email);
    try {
      await page.locator("#email").fill(email);
      await page.getByRole("button", { name: "Надіслати код" }).click();

      // Stage 2 appears and echoes the target email.
      await expect(page.getByText("Встановлення пароля")).toBeVisible();
      await expect(page.getByText(email)).toBeVisible();

      const code = getPasswordResetCode(email);
      await page.locator("#code").fill(code);
      await page.locator("#newPassword").fill("NewPass456!");
      await page.locator("#confirmPassword").fill("NewPass456!");
      await page.getByRole("button", { name: "Скинути пароль" }).click();
      await expect(page).toHaveURL(/\/login$/);

      // Prove the password really changed by logging in with it.
      await page.locator("#email").fill(email);
      await page.locator("#password").fill("NewPass456!");
      await page.getByRole("button", { name: "Увійти" }).click();
      await expect(page).not.toHaveURL(/\/login$/);
      await expect(page.getByText("Невірний email або пароль.", { exact: true })).toHaveCount(0);
    } finally {
      deleteUser(email);
    }
  });

  test("an unknown email still advances to stage 2 (no account enumeration)", async ({ page }) => {
    await page.locator("#email").fill(`e2e_reset_nobody_${Date.now()}@test.local`);
    await page.getByRole("button", { name: "Надіслати код" }).click();
    await expect(page.getByText("Встановлення пароля")).toBeVisible();
  });

  test("mismatched passwords are rejected in stage 2", async ({ page }) => {
    const email = `e2e_reset_mismatch_${Date.now()}@test.local`;
    createVerifiedUser(email);
    try {
      await page.locator("#email").fill(email);
      await page.getByRole("button", { name: "Надіслати код" }).click();
      await expect(page.getByText("Встановлення пароля")).toBeVisible();

      const code = getPasswordResetCode(email);
      await page.locator("#code").fill(code);
      await page.locator("#newPassword").fill("NewPass456!");
      await page.locator("#confirmPassword").fill("Different456!");
      await page.getByRole("button", { name: "Скинути пароль" }).click();
      await expect(page.getByText("Паролі не збігаються.", { exact: true })).toBeVisible();
      await expect(page).toHaveURL(/\/password-reset$/);
    } finally {
      deleteUser(email);
    }
  });

  test("the reset button stays disabled until the form is complete", async ({ page }) => {
    const email = `e2e_reset_disabled_${Date.now()}@test.local`;
    createVerifiedUser(email);
    try {
      await page.locator("#email").fill(email);
      await page.getByRole("button", { name: "Надіслати код" }).click();
      await expect(page.getByText("Встановлення пароля")).toBeVisible();

      const reset = page.getByRole("button", { name: "Скинути пароль" });
      await expect(reset).toBeDisabled();
      await page.locator("#code").fill("123456");
      await expect(reset).toBeDisabled();
      await page.locator("#newPassword").fill("NewPass456!");
      await expect(reset).toBeDisabled();
      await page.locator("#confirmPassword").fill("NewPass456!");
      await expect(reset).toBeEnabled();
    } finally {
      deleteUser(email);
    }
  });
});
