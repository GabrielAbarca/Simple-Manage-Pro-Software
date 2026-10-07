import { test, expect } from "@playwright/test";
import {
  REF,
  UID,
  consoleFix,
  routeSupabase,
  sessionSeed,
} from "./fixtures.js";

// Moving a record out of a signed-in status turns its login off, and back
// on again; in the demo that is simulated and nothing reaches the backend.

const LOGIN = "00000000-0000-4000-8000-0000000000aa";

const fix = {
  ...consoleFix,
  students: [
    {
      id: 101,
      first_name: "Ana",
      last_name: "García",
      status: "active",
      enrollment_number: "S-1",
      auth_user_id: LOGIN,
    },
    {
      id: 102,
      first_name: "Luis",
      last_name: "Martínez",
      status: "active",
      enrollment_number: "S-2",
    },
    {
      id: 103,
      first_name: "María",
      last_name: "Rojas",
      status: "inactive",
      enrollment_number: "S-3",
      auth_user_id: LOGIN,
    },
  ],
  teachers: [
    {
      id: 71,
      first_name: "Sofía",
      last_name: "Ramírez",
      status: "active",
      auth_user_id: LOGIN,
    },
    {
      id: 72,
      first_name: "Gabriel",
      last_name: "Director",
      status: "active",
      auth_user_id: UID,
    },
  ],
};

async function openConsole(page, context, tab) {
  const writes = await routeSupabase(context, fix);
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
  await page.click(`.sidebar a[data-page="${tab}"]`);
  return { writes, errors };
}

const row = (page, body, name) =>
  page.locator(`#${body} tr`, { hasText: name });
const lastToast = (page) => page.locator("#toast-container .toast").last();

test("deactivating a student with a login asks first and deactivates it", async ({
  page,
  context,
}) => {
  const { writes, errors } = await openConsole(page, context, "students");
  await row(page, "students-body", "García")
    .locator('button[title="Deactivate"]')
    .click();
  await expect(page.locator("#confirm-title")).toHaveText(
    "Deactivate student?",
  );
  await expect(page.locator("#confirm-message")).toHaveText(
    "Deactivate Ana García? Their sign-in will be deactivated too.",
  );
  await page.click("#confirm-delete");
  await expect(lastToast(page)).toHaveText(
    "Saved. Their sign-in would be deactivated too (demo — no real change).",
  );
  await expect(row(page, "students-body", "García")).toContainText("Inactive");
  expect(errors).toEqual([]);
  expect(writes).toEqual([]);
});

test("deactivating a student without a login just saves", async ({
  page,
  context,
}) => {
  await openConsole(page, context, "students");
  await row(page, "students-body", "Martínez")
    .locator('button[title="Deactivate"]')
    .click();
  await expect(page.locator("#confirm-overlay")).not.toHaveClass(/active/);
  await expect(lastToast(page)).toHaveText("Saved.");
});

test("reactivating a student restores their login", async ({
  page,
  context,
}) => {
  const { writes } = await openConsole(page, context, "students");
  await row(page, "students-body", "Rojas")
    .locator('button[title="Reactivate"]')
    .click();
  await expect(page.locator("#confirm-title")).toHaveText(
    "Reactivate student?",
  );
  await page.click("#confirm-delete");
  await expect(lastToast(page)).toHaveText(
    "Saved. Their sign-in would be restored too (demo — no real change).",
  );
  expect(writes).toEqual([]);
});

test("a teacher set to inactive loses their login, on leave keeps it", async ({
  page,
  context,
}) => {
  const { writes } = await openConsole(page, context, "teachers");
  const edit = () =>
    row(page, "teachers-body", "Ramírez")
      .locator('button[title="Edit"]')
      .click();

  await edit();
  await page.selectOption("#modal-field-status", "on_leave");
  await page.click("#modal-submit");
  await expect(lastToast(page)).toHaveText("Saved.");

  await edit();
  await page.selectOption("#modal-field-status", "inactive");
  await page.click("#modal-submit");
  await expect(lastToast(page)).toHaveText(
    "Saved. Their sign-in would be deactivated too (demo — no real change).",
  );
  expect(writes).toEqual([]);
});

test("deactivating the signed-in admin's own teacher record keeps their login", async ({
  page,
  context,
}) => {
  const { writes } = await openConsole(page, context, "teachers");
  await row(page, "teachers-body", "Director")
    .locator('button[title="Edit"]')
    .click();
  await page.selectOption("#modal-field-status", "inactive");
  await page.click("#modal-submit");
  await expect(page.locator("#confirm-title")).toHaveText(
    "Sign-in not changed",
  );
  await expect(page.locator("#confirm-message")).toContainText(
    "belongs to an administrator",
  );
  expect(writes).toEqual([]);
});
