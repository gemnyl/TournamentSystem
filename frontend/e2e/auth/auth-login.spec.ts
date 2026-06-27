import { test, expect } from "../fixtures";
import { CREDENTIALS } from "../helpers/roles";
import { createUnverifiedUser, deleteUser } from "../helpers/backend";

/**
 * Group 1 — login form (/login).
 *
 * The auth throttle is relaxed to 10000/min in the docker dev/E2E stack
 * (AUTH_THROTTLE_RATE), so these can run fully parallel without 429s.
 */

test.describe("login form", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
  });

  test("renders the login form", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Вхід до системи" })).toBeVisible();
    await expect(page.locator("#email")).toBeVisible();
    await expect(page.locator("#password")).toBeVisible();
    await expect(page.getByRole("button", { name: "Увійти" })).toBeVisible();
  });

  test("an invalid email is rejected at the form level", async ({ page }) => {
    await page.locator("#email").fill("not-an-email");
    await page.locator("#password").fill("whatever");
    await page.getByRole("button", { name: "Увійти" }).click();
    // Native type="email" validation blocks submit, so we never leave /login.
    await expect(page).toHaveURL(/\/login$/);
    const valid = await page
      .locator("#email")
      .evaluate((el) => (el as HTMLInputElement).validity.valid);
    expect(valid).toBe(false);
  });

  test("client-side validation requires a password", async ({ page }) => {
    await page.locator("#email").fill("someone@test.local");
    await page.getByRole("button", { name: "Увійти" }).click();
    await expect(page.getByText("Введіть пароль")).toBeVisible();
  });

  test("wrong password shows an error and stays on /login", async ({ page }) => {
    await page.locator("#email").fill(CREDENTIALS.spectator.email);
    await page.locator("#password").fill("definitely-wrong");
    await page.getByRole("button", { name: "Увійти" }).click();
    await expect(page.getByText("Невірний email або пароль.", { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("spectator signs in and lands on /tournaments", async ({ page }) => {
    await page.locator("#email").fill(CREDENTIALS.spectator.email);
    await page.locator("#password").fill(CREDENTIALS.spectator.password);
    await page.getByRole("button", { name: "Увійти" }).click();
    await expect(page).toHaveURL(/\/tournaments$/);
    await expect(page.getByRole("button", { name: /Spectator/ })).toBeVisible();
    await expect(page.getByRole("link", { name: "Увійти" })).toHaveCount(0);
  });

  test("coach signs in and is redirected to the coach dashboard", async ({ page }) => {
    await page.locator("#email").fill(CREDENTIALS.coach.email);
    await page.locator("#password").fill(CREDENTIALS.coach.password);
    await page.getByRole("button", { name: "Увійти" }).click();
    await expect(page).toHaveURL(/\/coach\/dashboard$/);
  });

  test("staff signs in and is redirected to the secretary panel", async ({ page }) => {
    await page.locator("#email").fill(CREDENTIALS.staff.email);
    await page.locator("#password").fill(CREDENTIALS.staff.password);
    await page.getByRole("button", { name: "Увійти" }).click();
    // StaffDashboardPage auto-selects the seeded tournament, appending ?tournamentId=...
    await expect(page).toHaveURL(/\/staff(\?.*)?$/);
  });

  // An inactive (unverified) account cannot authenticate via Django's default
  // ModelBackend, so the generic credentials error is shown — NOT a redirect to
  // /confirm-email. This documents the real backend behaviour.
  test("an unverified account gets the generic credentials error", async ({ page }) => {
    const email = "e2e_login_unverified@test.local";
    createUnverifiedUser(email);
    try {
      await page.locator("#email").fill(email);
      await page.locator("#password").fill("E2ePass123!");
      await page.getByRole("button", { name: "Увійти" }).click();
      await expect(page.getByText("Невірний email або пароль.", { exact: true })).toBeVisible();
      await expect(page).toHaveURL(/\/login$/);
    } finally {
      deleteUser(email);
    }
  });

  test("links lead to password reset and registration", async ({ page }) => {
    await page.getByRole("link", { name: "Забули пароль?" }).click();
    await expect(page).toHaveURL(/\/password-reset$/);

    await page.goto("/login");
    await page.getByRole("link", { name: "Зареєструватись" }).click();
    await expect(page).toHaveURL(/\/register$/);
  });
});
