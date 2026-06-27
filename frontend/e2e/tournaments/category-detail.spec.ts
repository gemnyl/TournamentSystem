import { test, expect } from "../fixtures";
import { storageStateFor } from "../helpers/roles";
import {
  newApiContext,
  createTournament,
  createCategory,
  registerAthlete,
  listAthleteIds,
} from "../helpers/api";
import { deleteTournament, markCategoryPaid } from "../helpers/backend";

/**
 * Group 11 — category detail page (/categories/:id).
 *
 * Read-only assertions use the shared seed category. The bracket-generation
 * flow builds an isolated tournament + broad category, registers two of the
 * coach's athletes via the API (auto-confirmed because weigh-in is off), then
 * drives the generate-bracket dialog in the UI as the owning organizer.
 */

test.describe("category detail (anonymous, read-only)", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("renders the seed category header and tabs", async ({ page, seedIds }) => {
    await page.goto(`/categories/${seedIds.category}`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Куміте Ю16 -60кг" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /Реєстрації/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Результати" })).toBeVisible();
  });

  test("an anonymous visitor sees no management controls", async ({ page, seedIds }) => {
    await page.goto(`/categories/${seedIds.category}`);
    await expect(page.getByRole("button", { name: "Зареєструвати атлета" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Згенерувати сітку" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Вилучити категорію" })).toHaveCount(0);
  });
});

test.describe("category detail (organizer, management)", () => {
  test.use({ storageState: storageStateFor("organizer") });

  test("an empty category shows the empty state and a register control", async ({ page }) => {
    const title = `E2E Empty Cat ${Date.now()}`;
    const api = await newApiContext("organizer");
    try {
      const tid = await createTournament(api, { title, status: "registration" });
      const cid = await createCategory(api, tid);
      await page.goto(`/categories/${cid}`);
      await expect(page.getByText("Реєстрацій поки немає")).toBeVisible();
      await expect(page.getByRole("button", { name: "Зареєструвати атлета" })).toBeVisible();
    } finally {
      deleteTournament(title);
      await api.dispose();
    }
  });

  test("a bracket is generated once two athletes are confirmed", async ({ page }) => {
    const title = `E2E Bracket Gen ${Date.now()}`;
    const orgApi = await newApiContext("organizer");
    const coachApi = await newApiContext("coach");
    try {
      const tid = await createTournament(orgApi, { title, status: "registration" });
      const cid = await createCategory(orgApi, tid);
      const athletes = await listAthleteIds(coachApi);
      await registerAthlete(coachApi, cid, athletes[0]);
      await registerAthlete(coachApi, cid, athletes[1]);
      // Bracket generation requires confirmed AND paid registrations.
      markCategoryPaid(cid);

      await page.goto(`/categories/${cid}`);
      await page.getByRole("button", { name: "Згенерувати сітку" }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByText("Згенерувати сітку змагань")).toBeVisible();
      await dialog.getByRole("button", { name: "Згенерувати" }).click();

      await expect(page.getByText("Сітку згенеровано!", { exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: "Переглянути сітку" })).toBeVisible();
    } finally {
      deleteTournament(title);
      await orgApi.dispose();
      await coachApi.dispose();
    }
  });

  test("a category can be deleted", async ({ page }) => {
    const title = `E2E Del Cat ${Date.now()}`;
    const api = await newApiContext("organizer");
    try {
      const tid = await createTournament(api, { title, status: "registration" });
      const cid = await createCategory(api, tid, { name: "Категорія на видалення" });
      await page.goto(`/categories/${cid}`);
      await page.getByRole("button", { name: "Вилучити категорію" }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByRole("heading", { name: "Вилучити категорію" })).toBeVisible();
      await dialog.getByRole("button", { name: "Вилучити" }).click();
      // onDeleteCat redirects to the parent tournament via window.location.
      await expect(page).toHaveURL(new RegExp(`/tournaments/${tid}$`));
    } finally {
      deleteTournament(title);
      await api.dispose();
    }
  });
});
