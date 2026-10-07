import { test, expect } from "@playwright/test";
import { REF, consoleFix, routeSupabase, sessionSeed } from "./fixtures.js";

const fix = {
  ...consoleFix,
  students: [
    {
      id: 101,
      first_name: "Ana",
      last_name: "García",
      status: "active",
      enrollment_number: "S-1",
    },
    {
      id: 102,
      first_name: "Pedro",
      last_name: "García",
      status: "active",
      enrollment_number: "S-2",
    },
  ],
  guardians: [
    {
      id: 501,
      first_name: "María",
      last_name: "Rojas",
      relationship: "Madre",
      national_id: "1-1111-1111",
      phone: "8888-1111",
    },
    {
      id: 502,
      first_name: "Carlos",
      last_name: "García",
      relationship: "Padre",
    },
  ],
  student_guardians: [
    { id: 1, student_id: 101, guardian_id: 501, is_primary: true },
    { id: 2, student_id: 102, guardian_id: 502, is_primary: true },
  ],
};

async function openConsole(page, context, fixture = fix) {
  const writes = await routeSupabase(context, fixture);
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
  await page.click('.sidebar a[data-page="students"]');
  return { writes, errors };
}

const guardiansButton = (page, firstName) =>
  page
    .locator("#students-body tr", { hasText: firstName })
    .locator('button[title="Guardians"]');
const panel = (page) => page.locator('#guardians-overlay [role="dialog"]');
const rows = (page) => page.locator("#guardians-rows tr");
const row = (page, name) =>
  page.locator("#guardians-rows tr", { hasText: name });

test("a student's guardians can be added, linked, edited and removed with zero writes", async ({
  page,
  context,
}) => {
  const { writes, errors } = await openConsole(page, context);
  await guardiansButton(page, "Ana").click();
  await expect(page.locator("#guardians-overlay")).toHaveClass(/active/);
  await expect(page.locator("#guardians-title")).toHaveText(
    "Guardians — Ana García",
  );
  await expect(rows(page)).toHaveCount(1);
  await expect(row(page, "María Rojas")).toContainText("Primary");
  await expect(row(page, "María Rojas")).toContainText("1-1111-1111");

  // A new guardian, refused while their ID belongs to someone on file.
  await page.click("#guardians-add");
  await page.fill("#modal-field-first_name", "Lucía");
  await page.fill("#modal-field-last_name", "Mora");
  await page.fill("#modal-field-relationship", "Tía");
  await page.fill("#modal-field-national_id", "1-1111-1111");
  await page.click("#modal-submit");
  await expect(page.locator(".field-error")).toHaveText(
    "This ID number is already on file for María Rojas. Use Link existing instead.",
  );
  await page.fill("#modal-field-national_id", "2-2222-2222");
  await page.click("#modal-submit");
  await expect(row(page, "Lucía Mora")).toContainText("Tía");
  await expect(row(page, "Lucía Mora")).not.toContainText("Primary");

  // Making her the primary contact moves the badge.
  await row(page, "Lucía Mora")
    .locator('button[title="Make primary contact"]')
    .click();
  await expect(row(page, "Lucía Mora")).toContainText("Primary");
  await expect(row(page, "María Rojas")).not.toContainText("Primary");
  // The row was redrawn under the button; focus stays in the dialog.
  await expect(panel(page)).toBeFocused();

  // A sibling's father can be linked; he is then shared by two students.
  await page.click("#guardians-link");
  await page.selectOption("#modal-field-guardian_id", "502");
  await page.click("#modal-submit");
  await expect(rows(page)).toHaveCount(3);
  await expect(row(page, "Carlos García")).toContainText("Padre");

  // Editing a shared guardian says the change reaches both students.
  await row(page, "Carlos García").locator('button[title="Edit"]').click();
  await expect(page.locator("#modal-form .field-help")).toHaveText(
    "Changes apply to every student this guardian is linked to.",
  );
  await page.fill("#modal-field-phone", "8888-2222");
  await page.click("#modal-submit");
  await expect(row(page, "Carlos García")).toContainText("8888-2222");
  await expect(panel(page)).toBeFocused();

  // Editing a guardian of this student alone carries no such note.
  await row(page, "María Rojas").locator('button[title="Edit"]').click();
  await expect(page.locator("#modal-field-first_name")).toHaveValue("María");
  await expect(page.locator("#modal-form .field-help")).toHaveCount(0);
  await page.click("#modal-cancel");

  // Removing a shared guardian keeps their record for the sibling.
  await row(page, "Carlos García")
    .locator('button[title="Remove from this student"]')
    .click();
  await expect(page.locator("#confirm-message")).toContainText(
    "Their record stays on file.",
  );
  await expect(page.locator("#confirm-delete")).toHaveText(
    "Remove from this student",
  );
  await page.click("#confirm-delete");
  await expect(rows(page)).toHaveCount(2);

  // Removing the primary contact, who has no other student, hands the
  // role on and deletes her record.
  await row(page, "Lucía Mora")
    .locator('button[title="Remove from this student"]')
    .click();
  await expect(page.locator("#confirm-title")).toHaveText("Remove guardian?");
  await expect(page.locator("#confirm-message")).toContainText(
    "their record is deleted",
  );
  await expect(page.locator("#confirm-delete")).toHaveText("Remove and delete");
  await page.click("#confirm-delete");
  await expect(rows(page)).toHaveCount(1);
  await expect(row(page, "María Rojas")).toContainText("Primary");

  await page.click("#guardians-link");
  const options = page.locator("#modal-field-guardian_id option");
  await expect(options.filter({ hasText: "García, Carlos" })).toHaveCount(1);
  await expect(options.filter({ hasText: "Mora" })).toHaveCount(0);
  await page.click("#modal-cancel");

  // The sibling still has Carlos, with the edited phone.
  await page.click("#guardians-close");
  await guardiansButton(page, "Pedro").click();
  await expect(page.locator("#guardians-title")).toHaveText(
    "Guardians — Pedro García",
  );
  await expect(rows(page)).toHaveCount(1);
  await expect(row(page, "Carlos García")).toContainText("8888-2222");

  expect(errors).toEqual([]);
  expect(writes).toEqual([]);
});

test("a student without guardians says so, and the first one linked is primary", async ({
  page,
  context,
}) => {
  const { writes, errors } = await openConsole(page, context, {
    ...fix,
    student_guardians: [],
  });
  await guardiansButton(page, "Ana").click();
  await expect(page.locator("#guardians-body")).toContainText(
    "No guardians on file for this student yet.",
  );
  await page.click("#guardians-link");
  await page.selectOption("#modal-field-guardian_id", "501");
  await page.click("#modal-submit");
  await expect(row(page, "María Rojas")).toContainText("Primary");

  expect(errors).toEqual([]);
  expect(writes).toEqual([]);
});

test("a slow answer for one student never lands in another student's list", async ({
  page,
  context,
}) => {
  const { writes, errors } = await openConsole(page, context);
  /** @type {() => void} */
  let release = () => {};
  const held = new Promise((resolve) => (release = resolve));
  await page.route("**/rest/v1/student_guardians*", async (route) => {
    if (route.request().url().includes("student_id=eq.101")) await held;
    await route.fallback();
  });

  await guardiansButton(page, "Ana").click();
  await expect(page.locator("#guardians-body")).toContainText("Loading");
  await page.click("#guardians-close");

  await guardiansButton(page, "Pedro").click();
  await expect(page.locator("#guardians-title")).toHaveText(
    "Guardians — Pedro García",
  );
  await expect(row(page, "Carlos García")).toBeVisible();

  const anasGuardians = page.waitForResponse(
    (r) => r.url().includes("/rest/v1/guardians") && r.url().includes("501"),
  );
  release();
  await anasGuardians;
  await page.evaluate(() => new Promise((r) => setTimeout(r, 50)));

  await expect(page.locator("#guardians-title")).toHaveText(
    "Guardians — Pedro García",
  );
  await expect(rows(page)).toHaveCount(1);
  await expect(row(page, "María Rojas")).toHaveCount(0);

  expect(errors).toEqual([]);
  expect(writes).toEqual([]);
});

/**
 * Hold the first request whose URL contains `marker` until released.
 * @returns {Promise<() => void>} the release
 */
async function hold(page, path, marker) {
  /** @type {() => void} */
  let release = () => {};
  const held = new Promise((resolve) => (release = resolve));
  let first = true;
  await page.route(`**/rest/v1/${path}*`, async (route) => {
    if (first && route.request().url().includes(marker)) {
      first = false;
      await held;
    }
    await route.fallback();
  });
  return release;
}

test("a dialog asked for one student never opens over another's", async ({
  page,
  context,
}) => {
  const { writes, errors } = await openConsole(page, context);
  const releaseGuardians = await hold(page, "guardians", "order=last_name");
  const releaseLinks = await hold(
    page,
    "student_guardians",
    "guardian_id=eq.501",
  );

  // Add guardian and Remove are clicked for Ana while their reads are
  // slow, then the admin moves on to Pedro.
  await guardiansButton(page, "Ana").click();
  await expect(rows(page)).toHaveCount(1);
  await page.click("#guardians-add");
  await row(page, "María Rojas")
    .locator('button[title="Remove from this student"]')
    .click();
  await page.click("#guardians-close");
  await guardiansButton(page, "Pedro").click();
  await expect(row(page, "Carlos García")).toBeVisible();

  const answered = Promise.all([
    page.waitForResponse((r) => r.url().includes("order=last_name")),
    page.waitForResponse((r) => r.url().includes("guardian_id=eq.501")),
  ]);
  releaseGuardians();
  releaseLinks();
  await answered;
  await page.evaluate(() => new Promise((r) => setTimeout(r, 50)));

  await expect(page.locator("#modal-overlay")).not.toHaveClass(/active/);
  await expect(page.locator("#confirm-overlay")).not.toHaveClass(/active/);
  await expect(page.locator("#guardians-title")).toHaveText(
    "Guardians — Pedro García",
  );
  await expect(rows(page)).toHaveCount(1);

  expect(errors).toEqual([]);
  expect(writes).toEqual([]);
});
