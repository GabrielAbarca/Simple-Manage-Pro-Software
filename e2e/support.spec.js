import { test, expect } from "@playwright/test";
import { REF, consoleFix, routeSupabase, sessionSeed } from "./fixtures.js";

const MAILTO = "mailto:contact@gzelaya.com";

test("the login page shows a support contact without signing in", async ({
  page,
}) => {
  await page.goto("/login.html");
  await expect(page.locator(`.auth-support a[href="${MAILTO}"]`)).toBeVisible();
});

test("the admin top bar links to support", async ({ page, context }) => {
  await routeSupabase(context, consoleFix);
  await page.goto("/login.html");
  await page.evaluate(
    ([key, value]) => localStorage.setItem(key, value),
    [`sb-${REF}-auth-token`, sessionSeed()],
  );

  await page.goto("/admin.html");
  const link = page.locator(`.right .top a.top-support[href="${MAILTO}"]`);
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute("aria-label", "Email support");
});
