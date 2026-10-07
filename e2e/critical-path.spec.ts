import { test, expect } from "@playwright/test";

test.describe("Critical path: login and app shell", () => {
  test("unauthenticated user is shown login page", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/);
    // A fresh instance (as in CI) asks to set it up; one with accounts to
    // sign in. Either way: a heading and the button that submits the form.
    await expect(
      page.getByRole("heading", { name: /welcome back|set up moatline/i })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^(sign in|create the account)$/i })
    ).toBeVisible();
  });

  test("login form has email and password fields", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByPlaceholder(/email/i)).toBeVisible();
    await expect(page.getByPlaceholder(/password/i)).toBeVisible();
  });
});
