import { test, expect } from "@playwright/test";
import {
  REF,
  routeSupabase,
  sessionSeed,
  teacherFix,
  UID,
} from "./fixtures.js";

// Cross-portal links were once shipped ungated and had to be removed: they
// bounced every caller straight back, because the student portal resolves its
// subject by students.auth_user_id and no teacher or admin had such a row.
// The links are back, gated on that exact capability — so the negative cases
// below are the point of this file, not an afterthought.

async function seedSession(context) {
  await context.addInitScript(
    ([key, value]) => localStorage.setItem(key, value),
    [`sb-${REF}-auth-token`, sessionSeed()],
  );
}

/** Teacher console fixtures for an admin who also has a students row. */
const adminWhoIsAlsoAStudent = {
  ...teacherFix,
  profiles: [{ id: UID, name: "Demo Account", role: "admin" }],
  students: [
    { id: 1, auth_user_id: UID, first_name: "Yendry", last_name: "Rojas" },
    ...teacherFix.students,
  ],
};

test.describe("teacher console portal links", () => {
  test("an admin with a students row sees both cross-portal links", async ({
    page,
    context,
  }) => {
    await routeSupabase(context, adminWhoIsAlsoAStudent);
    await seedSession(context);

    await page.goto("/teacher.html");
    await expect(page.locator("#admin-console-link")).toBeVisible();
    await expect(page.locator("#student-portal-link")).toBeVisible();
  });

  test("a plain teacher sees neither — an ungated link would bounce", async ({
    page,
    context,
  }) => {
    // teacherFix's profile is role 'teacher' and its students rows have no
    // auth_user_id, so neither target would accept this caller.
    await routeSupabase(context, teacherFix);
    await seedSession(context);

    await page.goto("/teacher.html");
    await page.waitForFunction(
      () =>
        document.getElementById("teacher-name")?.textContent?.includes("Sofía"),
      { timeout: 15_000 },
    );

    await expect(page.locator("#admin-console-link")).toBeHidden();
    await expect(page.locator("#student-portal-link")).toBeHidden();
  });

  test("the student-portal link actually reaches the student portal", async ({
    page,
    context,
  }) => {
    await routeSupabase(context, adminWhoIsAlsoAStudent);
    await seedSession(context);

    await page.goto("/teacher.html");
    await page.locator("#student-portal-link").click();
    // The real check is that it stays there rather than bouncing back.
    await page.waitForURL((url) => url.pathname === "/", { timeout: 15_000 });
    await page.waitForTimeout(1500);
    expect(new URL(page.url()).pathname).toBe("/");
  });
});

test.describe("student portal portal links", () => {
  test("an admin sees the console links", async ({ page, context }) => {
    await routeSupabase(context, adminWhoIsAlsoAStudent);
    await seedSession(context);

    await page.goto("/");
    await expect(page.locator("#admin-console-link")).toBeVisible();
    await expect(page.locator("#teacher-portal-link")).toBeVisible();
  });

  test("a plain student sees no console links", async ({ page, context }) => {
    await routeSupabase(context, {
      profiles: [{ id: UID, name: "Yendry", role: "student" }],
      students: [
        { id: 1, auth_user_id: UID, first_name: "Yendry", class_id: 21 },
      ],
    });
    await seedSession(context);

    await page.goto("/");
    await page.waitForSelector("#logout-btn");
    await expect(page.locator("#admin-console-link")).toBeHidden();
    // Previously ungated: a student saw this and got bounced on click.
    await expect(page.locator("#teacher-portal-link")).toBeHidden();
  });
});
