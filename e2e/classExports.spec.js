import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  REF,
  TODAY,
  teacherFix,
  routeSupabase,
  sessionSeed,
} from "./fixtures.js";

const assignment = (id, name, max) => ({
  id,
  class_subject_teacher_id: 11,
  grading_period_id: 1,
  name,
  max_score: max,
  due_date: "2026-06-10",
  created_at: "2026-06-01T00:00:00Z",
  category_id: null,
  note: null,
});

const fix = {
  ...teacherFix,
  assignments: [
    assignment(61, "Quiz 1, parte A", 20),
    assignment(62, "Proyecto", 10),
  ],
  assignment_grades: [
    { id: 1, assignment_id: 61, student_id: 101, score: 18, note: null },
    { id: 2, assignment_id: 61, student_id: 102, score: 12, note: null },
    { id: 3, assignment_id: 62, student_id: 101, score: 9, note: null },
  ],
  student_period_grades: [
    {
      student_id: 101,
      class_subject_teacher_id: 11,
      grading_period_id: 1,
      period_score: 90,
      graded_count: 2,
      total_assignments: 2,
    },
    {
      student_id: 102,
      class_subject_teacher_id: 11,
      grading_period_id: 1,
      period_score: 60,
      graded_count: 1,
      total_assignments: 2,
    },
  ],
  student_grades: [
    {
      id: 1,
      student_id: 101,
      class_subject_teacher_id: 11,
      grading_period_id: 1,
      score: 91,
      notes: null,
      submitted_at: "2026-08-30T12:00:00Z",
    },
  ],
  attendance: [
    ...teacherFix.attendance,
    {
      id: 811,
      student_id: 101,
      class_id: 21,
      class_subject_teacher_id: 11,
      date: "2026-09-01",
      status: "absent",
    },
    {
      id: 812,
      student_id: 102,
      class_id: 21,
      class_subject_teacher_id: 11,
      date: "2026-09-01",
      status: "absent",
    },
    {
      id: 813,
      student_id: 101,
      class_id: 21,
      class_subject_teacher_id: 11,
      date: "2026-09-02",
      status: "late",
    },
  ],
};

async function openClassTab(page, context, tab) {
  const writes = await routeSupabase(context, fix);
  await context.addInitScript(
    ([key, value]) => localStorage.setItem(key, value),
    [`sb-${REF}-auth-token`, sessionSeed()],
  );
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/teacher.html");
  await page.waitForFunction(
    () =>
      document.getElementById("teacher-name")?.textContent?.includes("Sofía"),
    { timeout: 10_000 },
  );
  await page.click('aside a[data-page="myclasses"]');
  await page.locator(".class-card", { hasText: "Mathematics" }).click();
  await page.locator(`.class-subtab[data-tab="${tab}"]`).click();
  return { writes, errors };
}

async function download(page, format) {
  if (format) await page.selectOption("#modal-field-format", format);
  const [file] = await Promise.all([
    page.waitForEvent("download"),
    page.click("#modal-submit"),
  ]);
  return file;
}

const csvLines = async (file) =>
  readFileSync(await file.path(), "utf8")
    .slice(1)
    .trim()
    .split("\r\n");

test("the gradebook exports each student's scores for the period", async ({
  page,
  context,
}) => {
  const { writes, errors } = await openClassTab(page, context, "gradebook");
  await expect(page.locator("#gradebook-grid tbody tr")).toHaveCount(2);

  await page.click("#btn-export-gradebook");
  await expect(page.locator("#modal-title")).toHaveText("Export gradebook");
  await expect(page.locator("#modal-form .field-help")).toContainText(
    "Period 1",
  );
  await expect(page.locator("#modal-form .field-help")).toContainText(
    "2 active students",
  );
  // Picking a format is not an edit worth a discard warning.
  await page.selectOption("#modal-field-format", "csv");
  await page.click("#modal-cancel");
  await expect(page.locator("#modal-overlay")).not.toHaveClass(/active/);
  await expect(page.locator("#confirm-overlay")).not.toHaveClass(/active/);

  await page.click("#btn-export-gradebook");
  const csv = await download(page, "csv");
  expect(csv.suggestedFilename()).toMatch(
    /^gradebook - Mathematics - 7th Grade — Section A - Period 1 - \d{4}-\d{2}-\d{2}\.csv$/,
  );
  expect(await csvLines(csv)).toEqual([
    'Last name,First name,"Quiz 1, parte A (out of 20)",Proyecto (out of 10),Period score,Graded,Posted grade',
    "García,Ana,18,9,90,2,91",
    "Martínez,Luis,12,,60,1,",
  ]);

  await page.click("#btn-export-gradebook");
  const xlsx = await download(page);
  expect(xlsx.suggestedFilename()).toMatch(/Period 1 - [\d-]+\.xlsx$/);
  const bytes = readFileSync(await xlsx.path());
  expect(bytes.subarray(0, 2).toString()).toBe("PK");
  const text = bytes.toString("utf8");
  expect(text).toContain('<sheet name="Period 1"');
  expect(text).toContain("Quiz 1, parte A (out of 20)");

  expect(errors).toEqual([]);
  expect(writes).toEqual([]);
});

test("attendance exports totals per student or every record", async ({
  page,
  context,
}) => {
  const { writes, errors } = await openClassTab(page, context, "attendance");
  await page.waitForSelector(".attendance-status-btn");

  await page.click("#btn-export-attendance");
  await expect(page.locator("#modal-title")).toHaveText("Export attendance");
  await expect(page.locator("#modal-field-content")).toHaveValue("summary");
  const summary = await download(page, "csv");
  expect(summary.suggestedFilename()).toMatch(
    /^attendance - Mathematics - 7th Grade — Section A - \d{4}-\d{2}-\d{2}\.csv$/,
  );
  expect(await csvLines(summary)).toEqual([
    "Last name,First name,Present,Absent,Late,Excused,Absences + lates",
    "García,Ana,1,1,1,0,2",
    "Martínez,Luis,0,1,0,0,1",
  ]);

  await page.click("#btn-export-attendance");
  await page.selectOption("#modal-field-content", "log");
  const log = await download(page, "csv");
  expect(await csvLines(log)).toEqual([
    "Date,Last name,First name,Status",
    "2026-09-01,García,Ana,Absent",
    "2026-09-01,Martínez,Luis,Absent",
    "2026-09-02,García,Ana,Late",
    `${TODAY},García,Ana,Present`,
  ]);

  expect(errors).toEqual([]);
  expect(writes).toEqual([]);
});

/**
 * Hold the first request to a REST table whose URL contains `marker`.
 * @returns {Promise<() => void>} the release
 */
async function hold(page, table, marker) {
  /** @type {() => void} */
  let release = () => {};
  const held = new Promise((resolve) => (release = resolve));
  let first = true;
  await page.route(`**/rest/v1/${table}*`, async (route) => {
    if (first && route.request().url().includes(marker)) {
      first = false;
      await held;
    }
    await route.fallback();
  });
  return release;
}

test("the gradebook export never saves a class the screen is not showing", async ({
  page,
  context,
}) => {
  const { writes, errors } = await openClassTab(page, context, "gradebook");
  await expect(page.locator("#gradebook-grid tbody tr")).toHaveCount(2);

  // Spanish's gradebook is still loading when the teacher clicks Export, so
  // the Mathematics gradebook loaded before must not be what gets saved.
  const release = await hold(
    page,
    "assignments",
    "class_subject_teacher_id=eq.12",
  );
  await page.click('aside a[data-page="myclasses"]');
  await page.locator(".class-card", { hasText: "Spanish" }).click();
  await page.locator('.class-subtab[data-tab="gradebook"]').click();
  await page.click("#btn-export-gradebook");
  await expect(page.locator("#toast-container")).toContainText(
    "The gradebook for this period has not loaded yet.",
  );
  await expect(page.locator("#modal-overlay")).not.toHaveClass(/active/);

  release();
  await expect(page.locator("#gradebook-grid")).toContainText(
    "No assignments yet for this period.",
  );
  await page.click("#btn-export-gradebook");
  const csv = await download(page, "csv");
  expect(csv.suggestedFilename()).toMatch(/^gradebook - Spanish - /);
  expect(await csvLines(csv)).toEqual([
    "Last name,First name,Period score,Graded,Posted grade",
    "García,Ana,,0,",
    "Martínez,Luis,,0,",
  ]);

  expect(errors).toEqual([]);
  expect(writes).toEqual([]);
});

test("cancelling an export while it reads downloads nothing", async ({
  page,
  context,
}) => {
  const { writes, errors } = await openClassTab(page, context, "attendance");
  await page.waitForSelector(".attendance-status-btn");
  const release = await hold(page, "attendance", "offset=");
  let downloads = 0;
  page.on("download", () => downloads++);

  await page.click("#btn-export-attendance");
  await page.click("#modal-submit");
  await page.click("#modal-cancel");
  await expect(page.locator("#modal-overlay")).not.toHaveClass(/active/);

  // A dialog opened meanwhile works, and the export finishing leaves it open.
  await page.click("#btn-export-attendance");
  await expect(page.locator("#modal-submit")).toBeEnabled();
  const answered = page.waitForResponse((r) => r.url().includes("offset="));
  release();
  await answered;
  await page.evaluate(() => new Promise((r) => setTimeout(r, 300)));
  expect(downloads).toBe(0);
  await expect(page.locator("#modal-overlay")).toHaveClass(/active/);

  expect(errors).toEqual([]);
  expect(writes).toEqual([]);
});
