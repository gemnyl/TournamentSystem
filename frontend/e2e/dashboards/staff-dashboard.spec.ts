import { test, expect } from "../fixtures";
import { storageStateFor } from "../helpers/roles";

/**
 * Group 18 — secretary / staff dashboard (/staff).
 *
 * The page lists only tournaments where the user is a staff member
 * (?staff_member=me) and auto-selects the first one. The seed staff user is
 * assigned to the seed tournament, so the panel opens on it without interaction.
 * The admin-only tabs (role requests, credit limits) must stay hidden for a
 * plain staff role. The Radix Tabs render role="tab"; counts in the labels are
 * volatile, so triggers are matched by a name regex.
 */

test.describe("staff dashboard (staff)", () => {
  test.use({ storageState: storageStateFor("staff") });

  test("the panel auto-selects the assigned tournament and shows staff tabs", async ({ page }) => {
    await page.goto("/staff");

    await expect(
      page.getByRole("heading", { level: 1, name: "Управління явкою та зважуванням" }),
    ).toBeVisible();
    // "Панель секретаря" is also a header nav link, so scope to the page body.
    await expect(page.getByRole("main").getByText("Панель секретаря")).toBeVisible();
    // The seed staff member is attached to this tournament, so it preselects.
    await expect(page.getByText("E2E Seed Tournament")).toBeVisible();

    await expect(page.getByRole("tab", { name: /Реєстрації/ })).toBeVisible();
    await expect(page.getByRole("tab", { name: /Категорії змагань/ })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Фінанси" })).toBeVisible();

    // Admin-only management tabs must not appear for a plain staff role.
    await expect(page.getByRole("tab", { name: /Заявки на ролі/ })).toHaveCount(0);
    await expect(page.getByRole("tab", { name: /Кредитні ліміти/ })).toHaveCount(0);
  });

  test("the categories tab lists the seeded category", async ({ page }) => {
    await page.goto("/staff");
    await page.getByRole("tab", { name: /Категорії змагань/ }).click();
    await expect(page.getByText("Куміте Ю16 -60кг")).toBeVisible();
  });
});
