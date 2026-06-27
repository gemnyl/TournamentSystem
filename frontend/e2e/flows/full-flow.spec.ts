import { test, expect } from "../fixtures";
import { storageStateFor } from "../helpers/roles";
import {
  newApiContext,
  createTournament,
  createCategory,
  registerAthlete,
  generateBracket,
  createTatami,
  listAthleteIds,
} from "../helpers/api";
import { deleteTournament, markCategoryPaid } from "../helpers/backend";

/**
 * Group 22 — full end-to-end golden path.
 *
 * One isolated tournament is carried through its whole life: the tedious data
 * setup (category, athlete registrations, bracket, mat) is done over the API as
 * the owning roles, then the organizer drives the start transition through the
 * UI. Every milestone is verified on a real page: the generated bracket, the live
 * day dashboard, and the public scoreboard. This stitches the operator / day /
 * bracket / scoreboard surfaces into a single flow.
 *
 * The tournament starts in "registration" (not draft) so its registration window
 * is genuinely open — draft + future window would reject the API registrations.
 */

test.describe("tournament golden path (organizer)", () => {
  test.use({ storageState: storageStateFor("organizer") });

  test("a tournament goes from draft to a live, bracketed, mat-ready event", async ({ page }) => {
    const title = `E2E Full Flow ${Date.now()}`;
    const orgApi = await newApiContext("organizer");
    const coachApi = await newApiContext("coach");
    try {
      // Registration is open so the API registrations below are accepted.
      const tid = await createTournament(orgApi, { title, status: "registration" });

      // 1. Build a payable, bracketed category over the API.
      const cid = await createCategory(orgApi, tid, { name: "Фінальна категорія" });
      const athletes = await listAthleteIds(coachApi);
      await registerAthlete(coachApi, cid, athletes[0]);
      await registerAthlete(coachApi, cid, athletes[1]);
      markCategoryPaid(cid);
      await generateBracket(orgApi, cid);

      // 2. Start the tournament through the UI (registration → active).
      await page.goto(`/tournaments/${tid}`);
      await page.getByRole("button", { name: "Розпочати" }).click();
      await expect(page.getByText("Турнір розпочато", { exact: true })).toBeVisible();

      // 3. Add a mat for the live surfaces.
      await createTatami(orgApi, tid, 6);

      // 4. The generated bracket renders its rounds.
      await page.goto(`/categories/${cid}/bracket`);
      await expect(page.getByRole("heading", { level: 1, name: "Фінальна категорія" })).toBeVisible();
      await expect(page.getByText("Сітку ще не згенеровано")).toHaveCount(0);
      await expect(page.getByText(/боїв/)).toBeVisible();

      // 5. The day dashboard shows the new mat as free.
      await page.goto(`/tournaments/${tid}/day`);
      await expect(page.getByRole("heading", { level: 1, name: "Дашборд змагань" })).toBeVisible();
      await expect(page.getByText("Татамі 6", { exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: "Панель оператора →" })).toBeVisible();

      // 6. The public scoreboard waits for a match on that mat.
      await page.goto(`/scoreboard/tournament/${tid}/tatami/6`);
      await expect(page.getByText("WAITING FOR MATCH")).toBeVisible();
      await expect(page.getByText("TATAMI 6", { exact: true })).toBeVisible();
    } finally {
      deleteTournament(title);
      await orgApi.dispose();
      await coachApi.dispose();
    }
  });
});
