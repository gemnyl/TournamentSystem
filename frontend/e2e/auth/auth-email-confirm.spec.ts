import { test, expect } from "../fixtures";
import { createUnverifiedUser, deleteUser } from "../helpers/backend";

/**
 * Group 3 — email confirmation (/confirm-email).
 *
 * Navigated directly (no router state), so the email field is shown and we
 * type both the address and the 6-digit code. Unverified users + known codes
 * are seeded straight into the DB to avoid the throttled /register/ endpoint.
 */

test.describe("email confirmation", () => {
  test("activates the account with a correct code and lands on /profile", async ({ page }) => {
    const email = `e2e_confirm_ok_${Date.now()}@test.local`;
    const code = createUnverifiedUser(email);
    try {
      await page.goto("/confirm-email");
      await page.locator("#email").fill(email);
      await page.locator("#code").fill(code);
      await page.getByRole("button", { name: "Підтвердити" }).click();
      await expect(page).toHaveURL(/\/profile$/);
    } finally {
      deleteUser(email);
    }
  });

  test("a wrong code is rejected", async ({ page }) => {
    const email = `e2e_confirm_bad_${Date.now()}@test.local`;
    createUnverifiedUser(email);
    try {
      await page.goto("/confirm-email");
      await page.locator("#email").fill(email);
      await page.locator("#code").fill("000000");
      await page.getByRole("button", { name: "Підтвердити" }).click();
      await expect(page.getByText("Невірний код підтвердження.", { exact: true })).toBeVisible();
      await expect(page).toHaveURL(/\/confirm-email$/);
    } finally {
      deleteUser(email);
    }
  });

  test("submitting without an email is blocked client-side", async ({ page }) => {
    await page.goto("/confirm-email");
    await page.locator("#code").fill("123456");
    await page.getByRole("button", { name: "Підтвердити" }).click();
    await expect(page.getByText("Будь ласка, введіть ваш email.", { exact: true })).toBeVisible();
  });

  test("the confirm button is disabled until the code is six digits", async ({ page }) => {
    await page.goto("/confirm-email");
    await page.locator("#email").fill("someone@test.local");
    const confirm = page.getByRole("button", { name: "Підтвердити" });
    await expect(confirm).toBeDisabled();
    await page.locator("#code").fill("123");
    await expect(confirm).toBeDisabled();
    await page.locator("#code").fill("123456");
    await expect(confirm).toBeEnabled();
  });

  test("the resend button is disabled during the initial countdown", async ({ page }) => {
    await page.goto("/confirm-email");
    await expect(page.getByRole("button", { name: /Надіслати повторно через \d+ сек/ })).toBeDisabled();
  });
});
