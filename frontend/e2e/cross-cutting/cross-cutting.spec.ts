import { request } from "@playwright/test";
import { test, expect } from "../fixtures";
import { storageStateFor, csrfTokenFor } from "../helpers/roles";
import { newApiContext, createTournament } from "../helpers/api";
import { deleteTournament } from "../helpers/backend";

/**
 * Group 23 — cross-cutting concerns.
 *
 * Access control (auth + RBAC redirects), CSRF enforcement on session-auth
 * writes, XSS-safe rendering of user content, responsive navigation, and the
 * document language. These checks span the whole app rather than a single page.
 */

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost";

test.describe("cross-cutting (anonymous)", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("a guest hitting a protected route is sent to login", async ({ page }) => {
    await page.goto("/coach/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });

  test("session-authenticated writes are rejected without a CSRF token", async () => {
    // A valid session cookie but NO X-CSRFToken header: DRF must reject the write.
    const ctx = await request.newContext({
      baseURL: BASE_URL,
      storageState: storageStateFor("organizer"),
    });
    try {
      const res = await ctx.post("/api/tournaments/", {
        data: { title: "CSRF should fail", sport_type: "Карате", location: "Київ" },
      });
      expect(res.status()).toBe(403);
    } finally {
      await ctx.dispose();
    }
  });

  test("the same write succeeds once the CSRF token is supplied", async () => {
    // Control for the test above: the only difference is the CSRF header.
    const ctx = await request.newContext({
      baseURL: BASE_URL,
      storageState: storageStateFor("organizer"),
      extraHTTPHeaders: { "X-CSRFToken": csrfTokenFor("organizer") },
    });
    try {
      const res = await ctx.post("/api/tournaments/", {
        data: {
          title: "CSRF ok but invalid payload",
          sport_type: "Карате",
          location: "Київ",
        },
      });
      // Past CSRF: the request is processed (and fails validation), never 403.
      expect(res.status()).not.toBe(403);
    } finally {
      await ctx.dispose();
    }
  });

  test("a malicious tournament title is rendered as inert text", async ({ page }) => {
    const title = `E2E XSS <img src=x onerror=alert(1)> ${Date.now()}`;
    const api = await newApiContext("organizer");
    let tid = 0;
    // Any dialog (e.g. an executed alert) fails the test.
    page.on("dialog", async (d) => {
      await d.dismiss();
      throw new Error(`Unexpected dialog: ${d.message()}`);
    });
    try {
      tid = await createTournament(api, { title, status: "registration" });
      await page.goto(`/tournaments/${tid}`);
      // The heading is present and no script executed.
      await expect(page.getByRole("heading", { level: 1, name: /E2E XSS/ })).toBeVisible();
    } finally {
      if (tid) await api.delete(`/api/tournaments/${tid}/`);
      await api.dispose();
    }
  });

  test("the document language is Ukrainian", async ({ page }) => {
    await page.goto("/tournaments");
    await expect(page.locator("html")).toHaveAttribute("lang", "uk");
  });
});

test.describe("cross-cutting (rbac)", () => {
  test.use({ storageState: storageStateFor("coach") });

  test("a coach is bounced from the secretary panel to tournaments", async ({ page }) => {
    await page.goto("/staff");
    await expect(page).toHaveURL(/\/tournaments$/);
    await expect(page.getByRole("heading", { name: "Турніри" })).toBeVisible();
  });
});

test.describe("cross-cutting (responsive)", () => {
  test.use({ storageState: { cookies: [], origins: [] }, viewport: { width: 375, height: 812 } });

  test("the mobile header exposes a burger menu with navigation", async ({ page }) => {
    await page.goto("/tournaments");

    const burger = page.locator("button.md\\:hidden");
    await expect(burger).toBeVisible();

    // The slide-down panel is the only direct md:hidden child of the header.
    const panel = page.locator("header > div.md\\:hidden");
    await expect(panel).toHaveCount(0);

    await burger.click();
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("link", { name: "Турніри" })).toBeVisible();
    await expect(panel.getByRole("link", { name: "Рейтинги" })).toBeVisible();
  });
});
