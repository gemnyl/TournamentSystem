import { test, expect } from "../fixtures";
import { createUnverifiedUser, deleteUser } from "../helpers/backend";

/**
 * Group 5 — Google sign-in.
 *
 * The real Google button is an OAuth iframe we can't drive in CI, so the UI
 * test only asserts the section renders. The backend endpoint trusts the
 * decoded id-token payload (it does not re-verify against Google), so the
 * happy path is exercised directly at the API: a first-time login provisions
 * an active, verified spectator, and logging in over a pre-existing
 * unverified account flips it to verified/active.
 *
 * Note: each call uses a fresh `request` context. The endpoint opens a session
 * on success, after which DRF would enforce CSRF on a *second* call reusing the
 * same cookies — so we never reuse a context once it is authenticated.
 */

test.describe("google sign-in", () => {
  test("the login page renders the Google sign-in section", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByText("або увійти за допомогою")).toBeVisible();
  });

  test("a first-time login provisions a verified spectator", async ({ request }) => {
    const email = `e2e_google_new_${Date.now()}@test.local`;
    try {
      const res = await request.post("/api/auth/google-login/", {
        data: { token: "fake-id-token", email, first_name: "Гугл", last_name: "Користувач" },
      });
      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      expect(body.email).toBe(email);
      expect(body.role).toBe("spectator");
      expect(body.email_verified).toBe(true);
    } finally {
      deleteUser(email);
    }
  });

  test("logging in activates a pre-existing unverified account", async ({ request }) => {
    const email = `e2e_google_reactivate_${Date.now()}@test.local`;
    createUnverifiedUser(email); // inactive, email_verified=false
    try {
      const res = await request.post("/api/auth/google-login/", {
        data: { token: "fake-id-token", email },
      });
      expect(res.ok()).toBeTruthy();
      expect((await res.json()).email_verified).toBe(true);
    } finally {
      deleteUser(email);
    }
  });

  test("the endpoint rejects a request without a token or email", async ({ request }) => {
    const noToken = await request.post("/api/auth/google-login/", {
      data: { email: "e2e_google_notoken@test.local" },
    });
    expect(noToken.status()).toBe(400);

    const noEmail = await request.post("/api/auth/google-login/", {
      data: { token: "fake-id-token" },
    });
    expect(noEmail.status()).toBe(400);
  });
});
