import { test, expect } from "@playwright/test";
import {
  REF,
  SUPA,
  consoleFix,
  routeSupabase,
  seedLang,
  sessionSeed,
} from "./fixtures.js";

// The overview's setup checklist: the whole first screen of an empty
// school, then a strip above the figures until every step is done.

const year = {
  id: 1,
  name: "2026",
  is_active: true,
  start_date: "2026-02-01",
  end_date: "2026-12-15",
};
const partly = {
  ...consoleFix,
  school_years: [year],
  grading_periods: [
    { id: 1, school_year_id: 1, name: "I", period_order: 1, weight: 50 },
    { id: 2, school_year_id: 1, name: "II", period_order: 2, weight: 50 },
  ],
  classes: [
    {
      id: 21,
      school_year_id: 1,
      grade_level_id: 1,
      section: "1",
      display_name: "7-1",
    },
  ],
  subjects: [{ id: 31, name: "Matemáticas" }],
  teachers: [
    { id: 71, first_name: "Sofía", last_name: "Ramírez", status: "active" },
  ],
};
const complete = {
  ...partly,
  teachers: [{ ...partly.teachers[0], auth_user_id: "login-71" }],
  class_subject_teachers: [
    { id: 11, school_year_id: 1, class_id: 21, subject_id: 31, teacher_id: 71 },
  ],
  students: [
    {
      id: 101,
      first_name: "Ana",
      last_name: "García",
      status: "active",
      class_id: 21,
    },
  ],
};

async function openOverview(page, context, fix, lang) {
  const writes = await routeSupabase(context, fix);
  if (lang) await seedLang(context, lang);
  await context.addInitScript(
    ([key, value]) => localStorage.setItem(key, value),
    [`sb-${REF}-auth-token`, sessionSeed()],
  );
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/admin.html");
  await page.waitForFunction(() =>
    document.getElementById("admin-name")?.textContent?.includes("Gabriel"),
  );
  return { writes, errors };
}

const checklist = (page) => page.locator("#overview-setup .setup-checklist");

test("an empty school gets the checklist instead of the figures", async ({
  page,
  context,
}) => {
  const { writes, errors } = await openOverview(page, context, {
    profiles: consoleFix.profiles,
  });
  await expect(checklist(page)).toContainText("0 of 8 steps done");
  await expect(page.locator("#overview-stats")).toBeHidden();
  await expect(page.locator("#setup-hide")).toHaveCount(0);

  await page.click('[data-setup-step="year"]');
  await expect(page.locator("#view-yearperiods")).toHaveClass(/active/);
  await expect(page.locator("#modal-overlay")).toHaveClass(/active/);
  expect(errors).toEqual([]);
  expect(writes).toEqual([]);
});

test("a partly set-up school sees what is left above its figures", async ({
  page,
  context,
}) => {
  await openOverview(page, context, partly);
  await expect(checklist(page)).toContainText("5 of 8 steps done");
  await expect(page.locator("#overview-stats")).toBeVisible();

  await expect(page.locator(".setup-step.is-done")).toHaveCount(5);
  const open = await page
    .locator("[data-setup-step]")
    .evaluateAll((els) => els.map((el) => el.dataset.setupStep));
  expect(open).toEqual(["assignments", "students", "logins"]);
  await expect(page.locator('[data-setup-step="logins"]')).toHaveText(
    "Create teacher logins",
  );
  // The first step left is the one to do next.
  const next = page.locator('[data-setup-step="assignments"]');
  await expect(next).toHaveClass(/btn-primary/);
  await expect(next).toHaveText("Go to Assignments");
  await next.click();
  await expect(page.locator("#view-assignments")).toHaveClass(/active/);
});

test("periods off 100% keep their step open", async ({ page, context }) => {
  await openOverview(page, context, {
    ...partly,
    grading_periods: [partly.grading_periods[0]],
  });
  await expect(page.locator('[data-setup-step="periods"]')).toBeVisible();
});

test("a hidden checklist stays hidden but can be brought back", async ({
  page,
  context,
}) => {
  await openOverview(page, context, partly);
  await page.click("#setup-hide");
  const show = page.locator("#setup-show");
  await expect(show).toHaveText("Show the setup checklist (3 left)");
  await expect(show).toBeFocused();
  await expect(page.locator(".setup-checklist")).toHaveCount(0);
  await page.reload();
  await page.waitForFunction(() =>
    document.getElementById("admin-name")?.textContent?.includes("Gabriel"),
  );
  await expect(page.locator("#stat-teachers")).toHaveText("1");
  await expect(page.locator(".setup-checklist")).toHaveCount(0);
  await page.locator("#setup-show").click();
  await expect(checklist(page)).toContainText("5 of 8 steps done");
});

test("an untouched school ignores a stored hide", async ({ page, context }) => {
  await context.addInitScript(() =>
    localStorage.setItem("smp-setup-checklist-hidden:none", "1"),
  );
  await openOverview(page, context, { profiles: consoleFix.profiles });
  await expect(checklist(page)).toBeVisible();
});

test("a year that exists but is not active sends the director to activate it", async ({
  page,
  context,
}) => {
  await openOverview(page, context, {
    ...consoleFix,
    school_years: [{ ...year, is_active: false }],
  });
  const step = page.locator('[data-setup-step="year"]');
  await expect(step).toHaveText("Go to Year & Periods");
  await expect(checklist(page)).toContainText(
    "A school year exists but none is active",
  );
  await step.click();
  await expect(page.locator("#view-yearperiods")).toHaveClass(/active/);
  await expect(page.locator("#modal-overlay")).not.toHaveClass(/active/);
  await expect(page.locator("#view-yearperiods h1")).toBeFocused();
});

test("students outside a section, and teachers without a login, keep their steps open", async ({
  page,
  context,
}) => {
  await openOverview(page, context, {
    ...complete,
    teachers: [
      ...complete.teachers,
      { id: 72, first_name: "Diego", last_name: "Soto", status: "active" },
    ],
    class_subject_teachers: [
      ...complete.class_subject_teachers,
      {
        id: 12,
        school_year_id: 1,
        class_id: 21,
        subject_id: 31,
        teacher_id: 72,
      },
    ],
    students: [{ ...complete.students[0], class_id: null }],
  });
  await expect(page.locator("[data-setup-step]")).toHaveCount(2);
  const open = await page
    .locator("[data-setup-step]")
    .evaluateAll((els) => els.map((el) => el.dataset.setupStep));
  expect(open).toEqual(["students", "logins"]);
});

test("the checklist reads in Spanish", async ({ page, context }) => {
  await openOverview(page, context, partly, "es");
  await expect(checklist(page)).toContainText("Configuremos su colegio");
  await expect(checklist(page)).toContainText("5 de 8 pasos listos");
  await expect(page.locator('[data-setup-step="assignments"]')).toHaveText(
    "Ir a Asignaciones",
  );
});

test("a failed checklist read leaves the figures in place", async ({
  page,
  context,
}) => {
  await routeSupabase(context, partly);
  await context.route(`${SUPA}/rest/v1/grading_periods**`, (route) =>
    route.fulfill({ status: 500, body: "{}" }),
  );
  await context.addInitScript(
    ([key, value]) => localStorage.setItem(key, value),
    [`sb-${REF}-auth-token`, sessionSeed()],
  );
  await page.goto("/admin.html");
  await expect(page.locator("#stat-teachers")).toHaveText("1");
  await expect(page.locator("#overview-setup")).toBeHidden();
});

test("a fully set-up school does not see the checklist", async ({
  page,
  context,
}) => {
  await openOverview(page, context, complete);
  await expect(page.locator("#stat-enrollment")).toHaveText("1");
  await expect(page.locator("#overview-setup")).toBeHidden();
});
