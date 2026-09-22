import { test, expect } from "@playwright/test";
import {
  REF,
  teacherFix,
  routeSupabase,
  seedLang,
  sessionSeed,
} from "./fixtures.js";

// Fail the test if any uncaught error reaches the page.
function trackErrors(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

async function openTeacherConsole(page, context, lang) {
  const writes = await routeSupabase(context, teacherFix);
  // routeSupabase seeds English; a later seed wins, which is how the Spanish
  // pass below gets the console in Spanish before the first paint.
  if (lang) await seedLang(context, lang);
  await context.addInitScript(
    ([key, value]) => localStorage.setItem(key, value),
    [`sb-${REF}-auth-token`, sessionSeed()],
  );
  const errors = trackErrors(page);
  await page.goto("/teacher.html");
  await page.waitForFunction(
    () =>
      document.getElementById("teacher-name")?.textContent?.includes("Sofía"),
    { timeout: 10_000 },
  );
  return { writes, errors };
}

async function openRoster(page) {
  await page.click('aside a[data-page="myclasses"]');
  await page.waitForSelector(".class-card");
  await page.locator(".class-card", { hasText: "Mathematics" }).click();
  await page.locator('.class-subtab[data-tab="roster"]').click();
  await page.waitForSelector(".roster-row .roster-row-cells");
}

test.describe("conducta", () => {
  test("the roster carries a conducta column with the computed mark", async ({
    page,
    context,
  }) => {
    const { writes, errors } = await openTeacherConsole(page, context);
    await openRoster(page);

    // Ana sorts first (García before Martínez). Her conducta is the view's
    // 87.5; Luis sits at 65, below the MEP floor.
    const rows = page.locator(".roster-row .roster-row-cells");
    await expect(rows.nth(0)).toContainText("87.5");
    await expect(rows.nth(1)).toContainText("65");

    // Below the floor must read as failing, and it must band against the
    // conduct mark rather than the subject pass mark.
    await expect(rows.nth(1).locator("b.score-low")).toHaveCount(1);

    expect(errors).toEqual([]);
    expect(writes).toEqual([]);
  });

  test("the drawer shows the period's conducta and each record's points", async ({
    page,
    context,
  }) => {
    const { writes, errors } = await openTeacherConsole(page, context);
    await openRoster(page);
    await page.locator(".roster-row .roster-row-cells").first().click();
    await page.waitForSelector("#drawer-body .drawer-section");

    const body = page.locator("#drawer-body");
    await expect(body).toContainText("Conducta");
    await expect(body).toContainText("87.5");
    await expect(body).toContainText("Not posted");
    // The record that produced the deduction says what it cost.
    await expect(body).toContainText("Tardiness");
    await expect(body).toContainText("−12.5 conducta");
    // The retired Resolved/Open badge must be gone for good.
    await expect(body).not.toContainText("Resolved");
    await expect(body).not.toContainText("Open");

    expect(errors).toEqual([]);
    expect(writes).toEqual([]);
  });

  test("the incident form previews the conducta the points would produce", async ({
    page,
    context,
  }) => {
    const { writes, errors } = await openTeacherConsole(page, context);
    await openRoster(page);
    await page.locator(".roster-row .roster-row-cells").first().click();
    await page.waitForSelector('[data-action="add-discipline"]');
    await page.click('[data-action="add-discipline"]');
    await page.waitForSelector("#modal-field-conduct_points");

    const help = page.locator(
      "#modal-field-conduct_points ~ .field-help, .field-group:has(#modal-field-conduct_points) .field-help",
    );
    // Ana stands at 87.5 with nothing entered yet.
    await expect(help.first()).toContainText("from 87.5 to 87.5");

    await page.fill("#modal-field-conduct_points", "7.5");
    await expect(help.first()).toContainText("from 87.5 to 80");

    // A deduction larger than what is left clamps at 0, never negative.
    await page.fill("#modal-field-conduct_points", "200");
    await expect(help.first()).toContainText("to 0");

    // The form offers the reason, the severity (labelled as record-only) and
    // no Resolved control at all.
    const form = page.locator("#modal-form");
    await expect(form).toContainText("Reason");
    await expect(form).toContainText("does not affect the grade");
    await expect(page.locator("#modal-field-resolved")).toHaveCount(0);
    await expect(page.locator("#modal-field-resolution")).toHaveCount(0);

    expect(errors).toEqual([]);
    expect(writes).toEqual([]);
  });

  test("filing a deduction moves the conducta, with zero writes", async ({
    page,
    context,
  }) => {
    const { writes, errors } = await openTeacherConsole(page, context);
    await openRoster(page);
    await page.locator(".roster-row .roster-row-cells").first().click();
    await page.waitForSelector('[data-action="add-discipline"]');
    await page.click('[data-action="add-discipline"]');
    await page.waitForSelector("#modal-field-conduct_points");

    // The form defaults to today, which sits outside the fixture's period —
    // date it inside so the deduction actually lands in this period's mark.
    await page.fill("#modal-field-date", "2026-07-15");
    await page.fill("#modal-field-type", "Disruption");
    await page.fill("#modal-field-conduct_points", "7.5");
    await page.click("#modal-submit");

    // The drawer reloads on save: 87.5 − 7.5 = 80.
    await expect(page.locator("#drawer-body")).toContainText("80");
    await expect(page.locator("#drawer-body")).toContainText("Disruption");

    expect(errors).toEqual([]);
    // Demo mode: the deduction is an overlay delta and never left the browser.
    expect(writes).toEqual([]);
  });

  test("posting freezes the period's conducta against a later deduction", async ({
    page,
    context,
  }) => {
    const { writes, errors } = await openTeacherConsole(page, context);
    await openRoster(page);

    await page.click("#btn-post-conduct");
    await page.waitForSelector(".pc-score");

    // The panel pre-fills from the computed mark.
    const first = page.locator(".pc-score").first();
    await expect(first).toHaveValue("87.5");
    await page.click("#pc-save");
    await expect(page.locator("#post-conduct-overlay")).not.toHaveClass(
      /active/,
    );

    // Now file a deduction after posting.
    await page.locator(".roster-row .roster-row-cells").first().click();
    await page.waitForSelector('[data-action="add-discipline"]');
    await page.click('[data-action="add-discipline"]');
    await page.waitForSelector("#modal-field-conduct_points");
    await page.fill("#modal-field-date", "2026-07-20");
    await page.fill("#modal-field-type", "Late filing");
    await page.fill("#modal-field-conduct_points", "40");
    await page.click("#modal-submit");

    // The computed mark moved; the posted one is what was frozen.
    const body = page.locator("#drawer-body");
    await expect(body).toContainText("47.5");
    await expect(body).toContainText("Posted: 87.5");

    expect(errors).toEqual([]);
    expect(writes).toEqual([]);
  });

  test("a deduction dated outside every period does not move the mark", async ({
    page,
    context,
  }) => {
    // The view attaches a record to a period by its date, so one filed with a
    // date no period covers is recorded but scores nothing. The drawer's
    // incident count comes from the view for exactly this reason.
    const { writes, errors } = await openTeacherConsole(page, context);
    await openRoster(page);
    await page.locator(".roster-row .roster-row-cells").first().click();
    await page.waitForSelector('[data-action="add-discipline"]');
    await page.click('[data-action="add-discipline"]');
    await page.waitForSelector("#modal-field-conduct_points");

    await page.fill("#modal-field-date", "2027-01-15");
    await page.fill("#modal-field-type", "Out of period");
    await page.fill("#modal-field-conduct_points", "50");
    await page.click("#modal-submit");

    const body = page.locator("#drawer-body");
    await expect(body).toContainText("Out of period");
    await expect(body).toContainText("87.5");

    expect(errors).toEqual([]);
    expect(writes).toEqual([]);
  });

  test("aplazado por conducta reads correctly in Spanish", async ({
    page,
    context,
  }) => {
    const { writes, errors } = await openTeacherConsole(page, context, "es");
    await openRoster(page);
    // Luis is below the floor.
    await page.locator(".roster-row .roster-row-cells").nth(1).click();
    await page.waitForSelector("#drawer-body .drawer-section");

    const body = page.locator("#drawer-body");
    await expect(body).toContainText("Aplazado por conducta");
    await expect(body).toContainText("Sin publicar");

    expect(errors).toEqual([]);
    expect(writes).toEqual([]);
  });
});
