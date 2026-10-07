import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { REF, consoleFix, routeSupabase, sessionSeed } from "./fixtures.js";

const fix = {
  ...consoleFix,
  classes: [
    {
      id: 21,
      school_year_id: 1,
      grade_level_id: 1,
      section: "1",
      display_name: "7-1",
    },
  ],
  students: [
    {
      id: 101,
      first_name: "Ana",
      last_name: "García, Rojas",
      enrollment_number: "2026-001",
      national_id: "1-1111-1111",
      date_of_birth: "2012-05-03",
      gender: "F",
      class_id: 21,
      status: "active",
    },
    {
      id: 102,
      first_name: "=cmd",
      last_name: "Mora",
      enrollment_number: "2026-002",
      date_of_birth: "2013-02-01",
      status: "inactive",
    },
    {
      id: 103,
      first_name: "Luis",
      last_name: "Vargas",
      enrollment_number: "2025-090",
      // A section from an earlier school year.
      class_id: 99,
      status: "active",
    },
  ],
};

async function openStudents(page, context) {
  const writes = await routeSupabase(context, fix);
  await context.addInitScript(
    ([key, value]) => localStorage.setItem(key, value),
    [`sb-${REF}-auth-token`, sessionSeed()],
  );
  await page.goto("/admin.html");
  await page.waitForFunction(() =>
    document.getElementById("admin-name")?.textContent?.includes("Gabriel"),
  );
  await page.click('.sidebar a[data-page="students"]');
  await expect(page.locator("#students-body tr")).toHaveCount(3);
  return writes;
}

async function exportAs(page, format) {
  await page.click("#btn-export-students");
  await page.selectOption("#modal-field-format", format);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.click("#modal-submit"),
  ]);
  return download;
}

test("the students table exports to CSV as shown, safely", async ({
  page,
  context,
}) => {
  const writes = await openStudents(page, context);
  await page.click("#btn-export-students");
  await expect(page.locator(".field-help")).toContainText("Rows to export: 3");
  await expect(page.locator(".field-help")).toContainText(
    "The file holds personal data",
  );
  // Picking a format is not an edit worth a discard warning.
  await page.selectOption("#modal-field-format", "csv");
  await page.click("#modal-cancel");
  await expect(page.locator("#modal-overlay")).not.toHaveClass(/active/);
  await expect(page.locator("#confirm-overlay")).not.toHaveClass(/active/);

  const download = await exportAs(page, "csv");
  expect(download.suggestedFilename()).toMatch(
    /^students-\d{4}-\d{2}-\d{2}\.csv$/,
  );
  const csv = readFileSync(await download.path(), "utf8");
  expect(csv.startsWith("﻿")).toBe(true);
  const lines = csv.slice(1).trim().split("\r\n");
  expect(lines[0]).toBe(
    "Enrollment #,Last name,First name,National ID,Date of birth,Gender,Section,Status,Email,Phone",
  );
  expect(lines).toContain(
    '2026-001,"García, Rojas",Ana,1-1111-1111,2012-05-03,Female,7-1,Active,,',
  );
  // A cell a spreadsheet would run as a formula is neutralised.
  expect(lines).toContain("2026-002,Mora,'=cmd,,2013-02-01,,,Inactive,,");
  // A section the console cannot name is left empty, not filled with "—".
  expect(lines).toContain("2025-090,Vargas,Luis,,,,,Active,,");
  expect(writes).toEqual([]);
});

test("the export follows the table's filter and defaults to Excel", async ({
  page,
  context,
}) => {
  await openStudents(page, context);
  await page.selectOption("#students-filter", "21");
  await expect(page.locator("#students-body tr")).toHaveCount(1);

  await page.click("#btn-export-students");
  await expect(page.locator(".field-help")).toContainText("Rows to export: 1");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.click("#modal-submit"),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.xlsx$/);
  const bytes = readFileSync(await download.path());
  expect(bytes.subarray(0, 2).toString()).toBe("PK");
  const sheet = bytes.toString("utf8");
  expect(sheet).toContain("García, Rojas");
  expect(sheet).not.toContain("Mora");
  // The date of birth is a real date in the reader's date format.
  expect(sheet).toContain('<c r="E2" s="2"><v>41032</v></c>');
});
