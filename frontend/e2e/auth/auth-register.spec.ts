import { test, expect } from "../fixtures";
import type { Page } from "@playwright/test";
import { CREDENTIALS } from "../helpers/roles";
import { deleteUser } from "../helpers/backend";

/**
 * Group 2 — registration form (/register).
 */

interface RegFields {
  first?: string;
  last?: string;
  phone?: string;
  birth?: string;
  gender?: "Чоловік" | "Жінка";
  email?: string;
  password?: string;
  confirm?: string;
  privacy?: boolean;
}

async function fillRegisterForm(page: Page, f: RegFields): Promise<void> {
  if (f.first !== undefined) await page.locator("#first_name").fill(f.first);
  if (f.last !== undefined) await page.locator("#last_name").fill(f.last);
  if (f.phone !== undefined) await page.locator("#phone").fill(f.phone);
  if (f.birth !== undefined) await page.locator("#birth_date").fill(f.birth);
  if (f.gender !== undefined) {
    await page.getByRole("combobox").click();
    await page.getByRole("option", { name: f.gender }).click();
  }
  if (f.email !== undefined) await page.locator("#email").fill(f.email);
  if (f.password !== undefined) await page.locator("#password").fill(f.password);
  if (f.confirm !== undefined) await page.locator("#password_confirm").fill(f.confirm);
  if (f.privacy) await page.locator("#accept_privacy").check();
}

const VALID: RegFields = {
  first: "Тарас",
  last: "Шевченко",
  phone: "+380991234567",
  birth: "2000-01-01",
  gender: "Чоловік",
  password: "E2ePass123!",
  confirm: "E2ePass123!",
  privacy: true,
};

test.describe("registration form", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/register");
  });

  test("renders all fields", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Реєстрація профілю" })).toBeVisible();
    for (const id of ["#first_name", "#last_name", "#phone", "#birth_date", "#email", "#password", "#password_confirm"]) {
      await expect(page.locator(id)).toBeVisible();
    }
    await expect(page.getByRole("button", { name: "Зареєструватись" })).toBeVisible();
  });

  test("empty submit surfaces required-field errors", async ({ page }) => {
    await page.getByRole("button", { name: "Зареєструватись" }).click();
    await expect(page.getByText("Введіть ім'я")).toBeVisible();
    await expect(page.getByText("Введіть прізвище")).toBeVisible();
    await expect(page.getByText("Ви повинні погодитись з обробкою персональних даних")).toBeVisible();
  });

  test("mismatched passwords are rejected", async ({ page }) => {
    await fillRegisterForm(page, {
      ...VALID,
      email: "e2e_reg_mismatch@test.local",
      confirm: "Different123!",
    });
    await page.getByRole("button", { name: "Зареєструватись" }).click();
    await expect(page.getByText("Паролі не збігаються")).toBeVisible();
    await expect(page).toHaveURL(/\/register$/);
  });

  test("missing privacy consent blocks submission", async ({ page }) => {
    await fillRegisterForm(page, { ...VALID, email: "e2e_reg_noprivacy@test.local", privacy: false });
    await page.getByRole("button", { name: "Зареєструватись" }).click();
    await expect(page.getByText("Ви повинні погодитись з обробкою персональних даних")).toBeVisible();
  });

  test("a duplicate email is rejected by the server", async ({ page }) => {
    await fillRegisterForm(page, { ...VALID, email: CREDENTIALS.spectator.email });
    await page.getByRole("button", { name: "Зареєструватись" }).click();
    await expect(page.getByText("Помилка запиту", { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/register$/);
  });

  test("a valid submission creates the account and routes to email confirmation", async ({ page }) => {
    const email = `e2e_reg_${Date.now()}@test.local`;
    try {
      await fillRegisterForm(page, { ...VALID, email });
      await page.getByRole("button", { name: "Зареєструватись" }).click();
      await expect(page).toHaveURL(/\/confirm-email$/);
      await expect(page.getByText(email)).toBeVisible();
    } finally {
      deleteUser(email);
    }
  });
});
