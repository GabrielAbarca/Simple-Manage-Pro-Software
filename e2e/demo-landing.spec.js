import { test, expect } from "@playwright/test";
import { REF, routeSupabase, seedLang, sessionSeed, UID } from "./fixtures.js";

// The demo is the product's shop window and a director is the buyer, so where
// it lands and which language it opens in are the first two things it says.
// Both used to say the wrong thing: the tour started on one student's
// dashboard, in English.

// The demo account is an admin that ALSO has a students row — that is what
// lets one login tour all three portals. Both facts matter to these specs.
const adminFix = {
  profiles: [{ id: UID, name: "Demo Account", role: "admin" }],
  students: [{ id: 1, auth_user_id: UID, first_name: "Yendry" }],
  school_years: [{ id: 1, name: "2026", is_active: true }],
};

// Submitting the login form is not exercised here: the harness answers every
// non-GET with 403 to guarantee the demo never writes, so POST /auth/v1/token
// cannot succeed. Both the post-sign-in and already-signed-in paths call the
// same redirectToPortal(), so seeding a session covers the routing without
// weakening that guarantee.
test.describe("demo first impression", () => {
  test("an admin lands on the admin console, not the student portal", async ({
    page,
    context,
  }) => {
    await routeSupabase(context, adminFix);
    await context.addInitScript(
      ([key, value]) => localStorage.setItem(key, value),
      [`sb-${REF}-auth-token`, sessionSeed()],
    );

    // Already signed in: visiting the login page re-runs the same redirect.
    await page.goto("/login.html");
    await page.waitForURL("**/admin.html", { timeout: 15_000 });
    expect(new URL(page.url()).pathname).toBe("/admin.html");
  });

  test("a student-only account still lands on the student portal", async ({
    page,
    context,
  }) => {
    // Guards against over-correcting: role routing has to keep working for
    // everyone else, not just redirect the whole world to /admin.
    await routeSupabase(context, {
      profiles: [{ id: UID, name: "Yendry", role: "student" }],
      students: [{ id: 1, auth_user_id: UID, first_name: "Yendry" }],
    });
    await context.addInitScript(
      ([key, value]) => localStorage.setItem(key, value),
      [`sb-${REF}-auth-token`, sessionSeed()],
    );

    await page.goto("/login.html");
    await page.waitForURL((url) => url.pathname === "/", { timeout: 15_000 });
  });
});

test.describe("default language", () => {
  // No seedLang() here on purpose — these assert the real default a first-time
  // visitor gets. The login page has no i18n storage key at all, so it is the
  // one surface that can only ever show the default.
  test("a first visit opens in Spanish", async ({ page, context }) => {
    await context.route("https://demo.supabase.co/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "[]",
      }),
    );

    await page.goto("/login.html");
    await page.waitForSelector("#auth-form");

    await expect(page.locator("html")).toHaveAttribute("lang", "es");
    await expect(page.locator("#btn-text")).toHaveText("Iniciar sesión");
  });

  test("an English browser still opens in Spanish", async ({ browser }) => {
    // navigator.language deliberately no longer decides: a director on an
    // English laptop must still see the Costa Rican product in Spanish.
    const context = await browser.newContext({ locale: "en-US" });
    const page = await context.newPage();
    await context.route("https://demo.supabase.co/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "[]",
      }),
    );

    await page.goto("/login.html");
    await page.waitForSelector("#auth-form");
    await expect(page.locator("html")).toHaveAttribute("lang", "es");

    await context.close();
  });

  test("a stored English choice still wins for that view", async ({
    page,
    context,
  }) => {
    // The default must not trample someone who has already chosen English.
    await routeSupabase(context, {
      profiles: [{ id: UID, name: "Yendry", role: "student" }],
      students: [{ id: 1, auth_user_id: UID, first_name: "Yendry" }],
    });
    await seedLang(context, "en");
    await context.addInitScript(
      ([key, value]) => localStorage.setItem(key, value),
      [`sb-${REF}-auth-token`, sessionSeed()],
    );

    await page.goto("/");
    await expect(
      page.locator('[data-i18n="student.nav.dashboard"]'),
    ).toHaveText("Dashboard");
  });
});
