import { test, expect } from "../fixtures";
import { newApiContext, createTournament, createTatami } from "../helpers/api";
import { deleteTournament } from "../helpers/backend";

/**
 * Group 21 — public scoreboard (/scoreboard/tournament/:tid/tatami/:n).
 *
 * The board is fully public and renders outside the app shell. With no active
 * match it falls back to the WKF "waiting" screen, which is what every
 * assertion here targets. The ?spectator=true variant swaps the header for a
 * "back to monitoring" link. A real (idle) tatami is created so the WS snapshot
 * resolves cleanly instead of erroring on a missing mat.
 */

test.describe("scoreboard (anonymous, idle)", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("the projector view waits for a match", async ({ page }) => {
    const title = `E2E Scoreboard ${Date.now()}`;
    const api = await newApiContext("organizer");
    try {
      const tid = await createTournament(api, { title, status: "registration" });
      await createTatami(api, tid, 3);
      await page.goto(`/scoreboard/tournament/${tid}/tatami/3`);

      await expect(page.getByText("WAITING FOR MATCH")).toBeVisible();
      await expect(page.getByText("TATAMI 3", { exact: true })).toBeVisible();
      await expect(page.getByText("Tatami 3", { exact: true })).toBeVisible();
      // Projector mode keeps the category header, not the monitoring back-link.
      await expect(page.getByRole("link", { name: "Назад до моніторингу" })).toHaveCount(0);
    } finally {
      deleteTournament(title);
      await api.dispose();
    }
  });

  test("the spectator view shows a back-to-monitoring link", async ({ page }) => {
    const title = `E2E Scoreboard Spec ${Date.now()}`;
    const api = await newApiContext("organizer");
    try {
      const tid = await createTournament(api, { title, status: "registration" });
      await createTatami(api, tid, 4);
      await page.goto(`/scoreboard/tournament/${tid}/tatami/4?spectator=true`);

      await expect(page.getByText("WAITING FOR MATCH")).toBeVisible();
      await expect(page.getByRole("link", { name: "Назад до моніторингу" })).toBeVisible();
    } finally {
      deleteTournament(title);
      await api.dispose();
    }
  });
});
