import { test, expect } from "./fixtures";
import { type Role, storageStateFor } from "./helpers/roles";

/**
 * Infrastructure smoke tests: prove that global-setup seeding, per-role
 * storageState, the nginx proxy, and baseline data are all wired correctly.
 */

test.describe("public access (unauthenticated)", () => {
  test("tournaments list is reachable and shows the login button", async ({ page }) => {
    await page.goto("/tournaments");
    await expect(page.getByRole("link", { name: "Турніри" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Увійти" })).toBeVisible();
  });

  test("root redirects to /tournaments", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/tournaments$/);
  });

  test("baseline seed tournament is visible", async ({ page, seedIds }) => {
    const res = await page.request.get(`/api/tournaments/${seedIds.tournament}/`);
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as { title: string };
    expect(body.title).toBe("E2E Seed Tournament");
  });
});

const ROLES_WITH_NAME: { role: Role; firstName: string }[] = [
  { role: "admin", firstName: "Admin" },
  { role: "organizer", firstName: "Organizer" },
  { role: "coach", firstName: "Coach" },
  { role: "judge", firstName: "Judge" },
  { role: "staff", firstName: "Staff" },
  { role: "spectator", firstName: "Spectator" },
];

for (const { role, firstName } of ROLES_WITH_NAME) {
  test.describe(`authenticated as ${role}`, () => {
    test.use({ storageState: storageStateFor(role) });

    test(`header shows the ${role} user and no login button`, async ({ page }) => {
      await page.goto("/tournaments");
      await expect(page.getByRole("link", { name: "Увійти" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: new RegExp(firstName) })).toBeVisible();
    });
  });
}
