import { test, expect } from "@playwright/test";
import { REF, studentFix, routeSupabase, sessionSeed } from "./fixtures.js";

/**
 * Account settings — the change-password control.
 *
 * The e2e suite runs in demo mode, where the shared account's password is
 * public by design and must not be movable. The live path is covered by
 * auth.updatePassword's own demo gate and is verified by hand against a real
 * project (see docs/ACCOUNT_RECOVERY.md).
 */
test("change password is offered but locked in demo mode, and writes nothing", async ({
  page,
  context,
}) => {
  const writes = await routeSupabase(context, studentFix);
  await context.addInitScript(
    ([key, value]) => localStorage.setItem(key, value),
    [`sb-${REF}-auth-token`, sessionSeed()],
  );

  await page.goto("/student.html");
  await page.click('aside .sidebar a[data-page="settings"]');

  const button = page.locator("#settings-change-password");
  await expect(button).toBeVisible();
  await expect(button).toBeDisabled();

  // The form exists in the markup but must stay closed behind the locked button.
  await expect(page.locator("#settings-password-form")).toBeHidden();

  expect(writes).toEqual([]);
});

test("settings links out to the privacy policy and terms", async ({
  page,
  context,
}) => {
  await routeSupabase(context, studentFix);
  await context.addInitScript(
    ([key, value]) => localStorage.setItem(key, value),
    [`sb-${REF}-auth-token`, sessionSeed()],
  );

  await page.goto("/student.html");
  await page.click('aside .sidebar a[data-page="settings"]');
  await page.click('.settings-rail-item[data-section="moreinfo"]');

  await expect(
    page.locator('.settings-links a[href="/privacy.html"]'),
  ).toBeVisible();
  await expect(
    page.locator('.settings-links a[href="/terms.html"]'),
  ).toBeVisible();
});
