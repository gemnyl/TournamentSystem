import { test, expect } from "../fixtures";

/**
 * Group 19 — billing / Monobank acquiring sandbox (/billing/mock-pay).
 *
 * The mock checkout is a public, layout-free page that reads ?invoiceId and
 * ?amount from the URL and renders the simulated gateway. Its two actions return
 * to the coach dashboard; for an anonymous visitor the cancel action therefore
 * lands on /login (the coach dashboard is gated). The "pay" action is not
 * exercised here because it posts to a real invoice sync endpoint.
 */

test.describe("monobank sandbox checkout (anonymous)", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("the sandbox renders the invoice, amount and both actions", async ({ page }) => {
    await page.goto("/billing/mock-pay?invoiceId=mock-999999&amount=1500");

    await expect(page.getByText("Monobank Acquiring Sandbox")).toBeVisible();
    await expect(page.getByText("Симуляція платіжного шлюзу Monobank Checkout")).toBeVisible();
    await expect(page.getByText("mock-999999")).toBeVisible();
    await expect(page.getByText("1500 UAH")).toBeVisible();
    await expect(page.getByText(/Жодні реальні кошти не списуються/)).toBeVisible();

    await expect(page.getByRole("button", { name: "Симулювати успішну оплату" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Скасувати платіж" })).toBeVisible();
  });

  test("cancelling returns toward the coach dashboard (login for a guest)", async ({ page }) => {
    await page.goto("/billing/mock-pay?invoiceId=mock-1&amount=500");
    await page.getByRole("button", { name: "Скасувати платіж" }).click();
    // The coach dashboard is gated, so an anonymous cancel resolves to /login.
    await expect(page).toHaveURL(/\/login/);
  });
});
