import { test, expect } from "../fixtures";
import { storageStateFor } from "../helpers/roles";
import { newApiContext, createTournament, createTatami } from "../helpers/api";
import { deleteTournament } from "../helpers/backend";

/**
 * Group 16 — day dashboard (/tournaments/:tid/day).
 *
 * The page is a live monitor of every tatami in a tournament. Each card opens
 * its own WebSocket, so assertions stick to the REST-rendered first paint
 * (header, empty state, the per-tatami "free" state) rather than racing the
 * socket. Tournaments are isolated and torn down so card counts stay stable.
 */

test.describe("day dashboard (anonymous, empty)", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("a tournament without tatamis shows the empty state", async ({ page }) => {
    const title = `E2E Day Empty ${Date.now()}`;
    const api = await newApiContext("organizer");
    try {
      const tid = await createTournament(api, { title, status: "registration" });
      await page.goto(`/tournaments/${tid}/day`);

      await expect(page.getByRole("heading", { level: 1, name: "Дашборд змагань" })).toBeVisible();
      await expect(page.getByText("live-моніторинг")).toBeVisible();
      await expect(page.getByRole("link", { name: "До деталей турніру" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Оновити" })).toBeVisible();

      await expect(page.getByText("Татамі не знайдено")).toBeVisible();
      await expect(
        page.getByText("Організатор ще не додав жодного татамі для цього турніру"),
      ).toBeVisible();
      // Anonymous visitors get no management entry point.
      await expect(page.getByRole("link", { name: "Керування татамі" })).toHaveCount(0);
    } finally {
      deleteTournament(title);
      await api.dispose();
    }
  });
});

test.describe("day dashboard (organizer, cards)", () => {
  test.use({ storageState: storageStateFor("organizer") });

  test("an organizer sees a free tatami card and the management link", async ({ page }) => {
    const title = `E2E Day Card ${Date.now()}`;
    const api = await newApiContext("organizer");
    try {
      const tid = await createTournament(api, { title, status: "registration" });
      await createTatami(api, tid, 5);
      await page.goto(`/tournaments/${tid}/day`);

      await expect(page.getByRole("heading", { level: 1, name: "Дашборд змагань" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Керування татамі" })).toBeVisible();

      // The card renders from the REST list before the socket connects.
      await expect(page.getByText("Татамі 5", { exact: true })).toBeVisible();
      await expect(page.getByText("Татамі вільне")).toBeVisible();
      await expect(page.getByRole("link", { name: "Панель оператора →" })).toBeVisible();
    } finally {
      deleteTournament(title);
      await api.dispose();
    }
  });
});
