import { test, expect } from "../fixtures";
import {
  newApiContext,
  createTournament,
  createCategory,
  registerAthlete,
  generateBracket,
  listAthleteIds,
} from "../helpers/api";
import { deleteTournament, markCategoryPaid } from "../helpers/backend";

/**
 * Group 12 — bracket view (/categories/:id/bracket).
 *
 * The page is public, so assertions run anonymously. Each test builds its own
 * isolated category: one without a bracket (empty state) and one with a fully
 * generated single-elimination bracket (two confirmed athletes via the API).
 */

test.describe("bracket view (anonymous)", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("an ungenerated category shows the empty state", async ({ page }) => {
    const title = `E2E Bracket Empty ${Date.now()}`;
    const api = await newApiContext("organizer");
    try {
      const tid = await createTournament(api, { title, status: "registration" });
      const cid = await createCategory(api, tid, { name: "Порожня сітка" });
      await page.goto(`/categories/${cid}/bracket`);
      await expect(page.getByRole("heading", { level: 1, name: "Порожня сітка" })).toBeVisible();
      await expect(page.getByText("Сітку ще не згенеровано")).toBeVisible();
      await expect(page.getByRole("link", { name: "До категорії" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Оновити" })).toBeVisible();
    } finally {
      deleteTournament(title);
      await api.dispose();
    }
  });

  test("a generated bracket renders the rounds", async ({ page }) => {
    const title = `E2E Bracket Render ${Date.now()}`;
    const orgApi = await newApiContext("organizer");
    const coachApi = await newApiContext("coach");
    try {
      const tid = await createTournament(orgApi, { title, status: "registration" });
      const cid = await createCategory(orgApi, tid, { name: "Сітка з боями" });
      const athletes = await listAthleteIds(coachApi);
      await registerAthlete(coachApi, cid, athletes[0]);
      await registerAthlete(coachApi, cid, athletes[1]);
      // Bracket generation requires confirmed AND paid registrations.
      markCategoryPaid(cid);
      await generateBracket(orgApi, cid);

      await page.goto(`/categories/${cid}/bracket`);
      await expect(page.getByRole("heading", { level: 1, name: "Сітка з боями" })).toBeVisible();
      await expect(page.getByText("Сітку ще не згенеровано")).toHaveCount(0);
      await expect(page.getByText("Показувати технічні бої (BYE/TBD)")).toBeVisible();
      // The header summary line reports the match count once a bracket exists.
      await expect(page.getByText(/боїв/)).toBeVisible();
    } finally {
      deleteTournament(title);
      await orgApi.dispose();
      await coachApi.dispose();
    }
  });
});
