import { test, expect } from "../fixtures";
import { storageStateFor } from "../helpers/roles";
import { createCompleteUser, deleteUser } from "../helpers/backend";

/**
 * Group 6 — logout, session persistence, and RBAC route guards.
 *
 * ProtectedRoute sends anonymous users to /login and role-mismatched users to
 * /tournaments. Logout uses its own throwaway user (logging out destroys the
 * server-side session, which would invalidate the shared role storageState if
 * we reused it across parallel workers).
 */

const ANON = { cookies: [], origins: [] };

test.describe("RBAC route guards (anonymous)", () => {
  test.use({ storageState: ANON });

  test("/profile redirects an anonymous visitor to /login", async ({ page }) => {
    await page.goto("/profile");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("/athletes redirects an anonymous visitor to /login", async ({ page }) => {
    await page.goto("/athletes");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("the header shows a login button when signed out", async ({ page }) => {
    await page.goto("/tournaments");
    await expect(page.getByRole("link", { name: "Увійти" })).toBeVisible();
  });
});

test.describe("RBAC route guards (spectator)", () => {
  test.use({ storageState: storageStateFor("spectator") });

  test("a spectator is bounced from the coach dashboard to /tournaments", async ({ page }) => {
    await page.goto("/coach/dashboard");
    await expect(page).toHaveURL(/\/tournaments$/);
  });

  test("a spectator is bounced from the secretary panel to /tournaments", async ({ page }) => {
    await page.goto("/staff");
    await expect(page).toHaveURL(/\/tournaments$/);
  });

  test("a spectator can reach /athletes", async ({ page }) => {
    await page.goto("/athletes");
    await expect(page).toHaveURL(/\/athletes$/);
  });

  test("the session survives a full page reload", async ({ page }) => {
    await page.goto("/tournaments");
    await expect(page.getByRole("button", { name: /Spectator/ })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: /Spectator/ })).toBeVisible();
    await expect(page.getByRole("link", { name: "Увійти" })).toHaveCount(0);
  });
});

test.describe("RBAC route guards (coach)", () => {
  test.use({ storageState: storageStateFor("coach") });

  test("a coach is bounced from the secretary panel to /tournaments", async ({ page }) => {
    await page.goto("/staff");
    await expect(page).toHaveURL(/\/tournaments$/);
  });

  test("a coach can reach the coach dashboard", async ({ page }) => {
    await page.goto("/coach/dashboard");
    await expect(page).toHaveURL(/\/coach\/dashboard$/);
  });
});

test.describe("logout", () => {
  test.use({ storageState: ANON });

  test("signing out clears the session and returns to /login", async ({ page }) => {
    const email = `e2e_logout_${Date.now()}@test.local`;
    createCompleteUser(email);
    try {
      // Fresh, isolated session via the UI.
      await page.goto("/login");
      await page.locator("#email").fill(email);
      await page.locator("#password").fill("E2ePass123!");
      await page.getByRole("button", { name: "Увійти" }).click();
      await expect(page).toHaveURL(/\/tournaments$/);

      // Open the account dropdown and sign out.
      await page.getByRole("button", { name: /E2E Session/ }).click();
      await page.getByRole("menuitem", { name: "Вийти" }).click();
      await expect(page).toHaveURL(/\/login$/);

      // The session is gone: a guarded route now bounces back to /login.
      await page.goto("/profile");
      await expect(page).toHaveURL(/\/login$/);
    } finally {
      deleteUser(email);
    }
  });
});
