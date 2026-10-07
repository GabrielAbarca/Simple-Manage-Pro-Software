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

async function openClass(page) {
  await page.click('aside a[data-page="myclasses"]');
  await page.waitForSelector(".class-card");
  await page.locator(".class-card", { hasText: "Mathematics" }).click();
}

async function showRoster(page) {
  await page.locator('.class-subtab[data-tab="roster"]').click();
  await page.waitForSelector(".roster-row .roster-row-cells");
}

async function openRoster(page) {
  await openClass(page);
  await showRoster(page);
}

async function showConductTab(page) {
  await page.locator('.class-subtab[data-tab="conduct"]').click();
  await page.waitForSelector("#conduct-grid table");
}

async function openConductTab(page) {
  await openClass(page);
  await showConductTab(page);
}

/** The By student row for one student, found by their "Last, First" name. */
function studentRow(page, name) {
  return page.locator("#conduct-grid tbody tr", { hasText: name });
}

/** File a record for Ana from her row in the Conduct tab's By student table. */
async function fileForAna(page, { date, reason, points }) {
  await page.click('[data-action="add-record"][data-student="101"]');
  await page.waitForSelector("#modal-field-conduct_points");
  await page.fill("#modal-field-date", date);
  await page.fill("#modal-field-type", reason);
  await page.fill("#modal-field-conduct_points", points);
  await page.click("#modal-submit");
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

  test("the drawer keeps the conducta summary without a discipline list", async ({
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
    // Records are filed and listed in the Conduct tab now, not here.
    await expect(body).not.toContainText("Tardiness");
    await expect(page.locator('[data-action="add-discipline"]')).toHaveCount(0);

    expect(errors).toEqual([]);
    expect(writes).toEqual([]);
  });

  test("the Conduct tab shows each student's conducta and their records", async ({
    page,
    context,
  }) => {
    const { writes, errors } = await openTeacherConsole(page, context);
    await openConductTab(page);

    const ana = studentRow(page, "García, Ana");
    await expect(ana).toContainText("87.5");
    await expect(ana.locator("td").nth(2)).toHaveText("1");
    // Luis sits below the conduct floor and says so.
    await expect(studentRow(page, "Martínez, Luis")).toContainText("Below 70");

    // Expanding Ana lists the record behind her deduction.
    await page.click('[data-action="toggle-student"][data-student="101"]');
    const detail = page.locator("#conduct-grid .conduct-detail");
    await expect(detail).toContainText("Tardiness");
    await expect(detail).toContainText("−12.5");

    // The All records view carries the same record, with whose it is.
    await page.click("#btn-conduct-records");
    await expect(page.locator("#btn-conduct-records")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const all = page.locator("#conduct-grid table");
    await expect(all).toContainText("García, Ana");
    await expect(all).toContainText("Tardiness");

    expect(errors).toEqual([]);
    expect(writes).toEqual([]);
  });

  test("the incident form previews the conducta the points would produce", async ({
    page,
    context,
  }) => {
    const { writes, errors } = await openTeacherConsole(page, context);
    await openConductTab(page);
    await page.click('[data-action="add-record"][data-student="101"]');
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
    await openConductTab(page);

    // The form defaults to today, which sits outside the fixture's period —
    // date it inside so the deduction actually lands in this period's mark.
    await fileForAna(page, {
      date: "2026-07-15",
      reason: "Disruption",
      points: "7.5",
    });

    // The tab reloads on save: 87.5 − 7.5 = 80.
    const ana = studentRow(page, "García, Ana");
    await expect(ana).toContainText("80");
    await expect(ana.locator("td").nth(2)).toHaveText("2");
    await page.click('[data-action="toggle-student"][data-student="101"]');
    await expect(page.locator("#conduct-grid .conduct-detail")).toContainText(
      "Disruption",
    );

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

    // Now file a deduction after posting, from the Conduct tab.
    await showConductTab(page);
    await fileForAna(page, {
      date: "2026-07-20",
      reason: "Late filing",
      points: "40",
    });
    await expect(studentRow(page, "García, Ana")).toContainText("47.5");

    // The computed mark moved; the posted one is what was frozen.
    await showRoster(page);
    await page.locator(".roster-row .roster-row-cells").first().click();
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
    // date no period covers is recorded but scores nothing, and the tab,
    // which lists one period at a time, does not show it either.
    const { writes, errors } = await openTeacherConsole(page, context);
    await openConductTab(page);

    await fileForAna(page, {
      date: "2027-01-15",
      reason: "Out of period",
      points: "50",
    });

    const ana = studentRow(page, "García, Ana");
    await expect(ana).toContainText("87.5");
    await expect(ana.locator("td").nth(2)).toHaveText("1");
    await page.click("#btn-conduct-records");
    await expect(page.locator("#conduct-grid table")).not.toContainText(
      "Out of period",
    );

    expect(errors).toEqual([]);
    expect(writes).toEqual([]);
  });

  test("the toolbar's Add record asks which student first", async ({
    page,
    context,
  }) => {
    const { writes, errors } = await openTeacherConsole(page, context);
    await openConductTab(page);

    await page.click("#btn-conduct-add");
    await page.waitForSelector("#modal-field-student_id");
    await page.selectOption("#modal-field-student_id", {
      label: "Martínez, Luis",
    });

    // The preview starts from the picked student's own conducta.
    const help = page.locator(
      ".field-group:has(#modal-field-conduct_points) .field-help",
    );
    await expect(help.first()).toContainText("from 65");

    await page.fill("#modal-field-date", "2026-07-15");
    await page.fill("#modal-field-type", "Phone in class");
    await page.fill("#modal-field-conduct_points", "5");
    await page.click("#modal-submit");

    const luis = studentRow(page, "Martínez, Luis");
    await expect(luis.locator("td").nth(2)).toHaveText("1");
    await page.click('[data-action="toggle-student"][data-student="102"]');
    await expect(page.locator("#conduct-grid .conduct-detail")).toContainText(
      "Phone in class",
    );

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
