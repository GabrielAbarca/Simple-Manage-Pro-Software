import { test, expect } from "@playwright/test";
import {
  REF,
  SUPA,
  studentFix,
  routeSupabase,
  sessionSeed,
} from "./fixtures.js";

/**
 * Error and offline states.
 *
 * The failure these guard against is quiet: a failed query rendered as an
 * empty state tells a student whose connection dropped "No grades recorded
 * yet". That reads as data loss, and during a demo it reads as a
 * broken product.
 */

/** Sign in and route Supabase, the way the student-portal specs do. */
async function asStudent(context) {
  const writes = await routeSupabase(context, studentFix);
  await context.addInitScript(
    ([key, value]) => localStorage.setItem(key, value),
    [`sb-${REF}-auth-token`, sessionSeed()],
  );
  return writes;
}

test.describe("failed queries", () => {
  test("a failing section shows an error with a retry, not an empty state", async ({
    page,
    context,
  }) => {
    const writes = await asStudent(context);

    // Registered after routeSupabase so it wins: Playwright matches routes in
    // reverse registration order.
    await context.route(`${SUPA}/rest/v1/student_grades**`, (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ message: "simulated outage" }),
      }),
    );

    await page.goto("/");
    await page.click('aside .sidebar a[data-page="grades"]');

    const gradesView = page.locator("#view-grades");
    await expect(gradesView.locator(".load-error")).toBeVisible();
    await expect(gradesView.locator("[data-retry]")).toBeVisible();

    // The empty-state copy must not be what the user sees when a query failed.
    await expect(gradesView).not.toContainText("No grades recorded yet");

    expect(writes).toEqual([]);
  });

  test("retry reloads the section once the backend recovers", async ({
    page,
    context,
  }) => {
    const writes = await asStudent(context);

    await context.route(`${SUPA}/rest/v1/student_grades**`, (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ message: "simulated outage" }),
      }),
    );

    await page.goto("/");
    await page.click('aside .sidebar a[data-page="grades"]');

    const gradesView = page.locator("#view-grades");
    await expect(gradesView.locator(".load-error")).toBeVisible();

    // Backend comes back; the fixture route underneath serves real rows again.
    await context.unroute(`${SUPA}/rest/v1/student_grades**`);
    await gradesView.locator("[data-retry]").click();

    await expect(gradesView.locator(".load-error")).toBeHidden();
    await expect(gradesView.locator("#grades-body tr")).not.toHaveCount(0);

    expect(writes).toEqual([]);
  });

  test("one failing section does not take down the rest of the portal", async ({
    page,
    context,
  }) => {
    await asStudent(context);

    await context.route(`${SUPA}/rest/v1/events**`, (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ message: "simulated outage" }),
      }),
    );

    await page.goto("/");
    await page.click('aside .sidebar a[data-page="events"]');
    await expect(page.locator("#view-events .load-error")).toBeVisible();

    // Attendance is a separate query and must still render.
    await page.click('aside .sidebar a[data-page="attendance"]');
    await expect(page.locator("#view-attendance .load-error")).toBeHidden();
  });
});

test.describe("offline notice", () => {
  test("appears when the connection drops and clears when it returns", async ({
    page,
    context,
  }) => {
    await asStudent(context);
    await page.goto("/");

    const banner = page.locator('[role="status"]', {
      hasText: /offline|conexión/i,
    });
    await expect(banner).toHaveCount(0);

    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await expect(banner).toBeVisible();

    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(banner).toHaveCount(0);
  });

  test("can be dismissed and comes back on the next drop", async ({
    page,
    context,
  }) => {
    await asStudent(context);
    await page.goto("/");

    const banner = page.locator('[role="status"]', {
      hasText: /offline|conexión/i,
    });

    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await expect(banner).toBeVisible();

    await banner.locator('button[aria-label="Dismiss"]').click();
    await expect(banner).toHaveCount(0);

    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await expect(banner).toBeVisible();
  });
});
