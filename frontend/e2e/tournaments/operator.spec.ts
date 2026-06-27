import { test, expect } from "../fixtures";
import { storageStateFor } from "../helpers/roles";
import { newApiContext, createTournament, createTatami } from "../helpers/api";
import { deleteTournament } from "../helpers/backend";

/**
 * Group 14 — judge operator panel (/operator/tournament/:tid/tatami/:n).
 *
 * The route is gated to judges and organizers. The panel header and category
 * sidebar render from REST immediately; the "Live" badge flips on once the
 * tatami WebSocket snapshot lands, so it carries a generous timeout. Access
 * control has two server-driven branches: a completed tournament shows a
 * closed screen, and a judge who is not assigned to the mat is locked out
 * (the lock only resolves after the WS snapshot reveals the assignment).
 */

test.describe("operator panel (organizer)", () => {
  test.use({ storageState: storageStateFor("organizer") });

  test("the organizer drives an active tatami panel", async ({ page }) => {
    const title = `E2E Operator Active ${Date.now()}`;
    const api = await newApiContext("organizer");
    try {
      const tid = await createTournament(api, { title, status: "active" });
      await createTatami(api, tid, 2);
      await page.goto(`/operator/tournament/${tid}/tatami/2`);

      await expect(page.getByText(title)).toBeVisible();
      await expect(page.getByText("Татамі №2")).toBeVisible();
      await expect(page.getByRole("button", { name: "Глядацьке табло" })).toBeVisible();
      await expect(page.getByText("Категорії татамі")).toBeVisible();
      await expect(page.getByText("Немає призначених категорій")).toBeVisible();
      // The mat socket promotes the connection badge from Offline → Live.
      await expect(page.getByText("Live", { exact: true })).toBeVisible({ timeout: 15000 });
    } finally {
      deleteTournament(title);
      await api.dispose();
    }
  });

  test("a completed tournament closes the panel", async ({ page }) => {
    const title = `E2E Operator Done ${Date.now()}`;
    const api = await newApiContext("organizer");
    try {
      const tid = await createTournament(api, { title, status: "completed" });
      await page.goto(`/operator/tournament/${tid}/tatami/1`);

      await expect(page.getByRole("heading", { name: "Турнір завершено" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Повернутися до турніру" })).toBeVisible();
    } finally {
      deleteTournament(title);
      await api.dispose();
    }
  });
});

test.describe("operator panel (judge, access control)", () => {
  test.use({ storageState: storageStateFor("judge") });

  test("an unassigned judge is locked out of the mat", async ({ page }) => {
    const title = `E2E Operator Lock ${Date.now()}`;
    const api = await newApiContext("organizer");
    try {
      const tid = await createTournament(api, { title, status: "active" });
      // Created without an assigned_judge, so the seed judge has no access.
      await createTatami(api, tid, 7);
      await page.goto(`/operator/tournament/${tid}/tatami/7`);

      // The lock only triggers after the WS snapshot reveals assigned_judge.
      await expect(page.getByRole("heading", { name: "Доступ обмежено!" })).toBeVisible({
        timeout: 15000,
      });
      await expect(page.getByText(/Татамі №7/)).toBeVisible();
    } finally {
      deleteTournament(title);
      await api.dispose();
    }
  });
});
