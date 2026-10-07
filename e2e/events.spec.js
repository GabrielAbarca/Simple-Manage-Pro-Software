import { test, expect } from "@playwright/test";
import {
  REF,
  consoleFix,
  studentFix,
  routeSupabase,
  sessionSeed,
} from "./fixtures.js";

function trackErrors(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

async function signIn(context) {
  await context.addInitScript(
    ([key, value]) => localStorage.setItem(key, value),
    [`sb-${REF}-auth-token`, sessionSeed()],
  );
}

test("the admin console adds, edits and deletes events with zero writes", async ({
  page,
  context,
}) => {
  const writes = await routeSupabase(context, {
    ...consoleFix,
    events: [
      {
        id: 1,
        title: "Feria científica",
        start_date: "2026-08-14",
        end_date: null,
        type: "activity",
      },
    ],
  });
  await signIn(context);
  const errors = trackErrors(page);
  await page.goto("/admin.html");
  await page.waitForFunction(() =>
    document.getElementById("admin-name")?.textContent?.includes("Gabriel"),
  );
  await page.click('.sidebar a[data-page="events"]');
  const body = page.locator("#events-body");
  await expect(body).toContainText("Feria científica");
  await expect(body).toContainText("Activity");

  await page.click("#btn-add-event");
  await page.fill("#modal-field-title", "Semana de exámenes");
  await page.selectOption("#modal-field-type", "exam_period");
  await page.fill("#modal-field-start_date", "2026-11-02");
  await page.fill("#modal-field-end_date", "2026-11-01");
  await page.click("#modal-submit");
  // The end may not come before the start.
  await expect(page.locator(".field-error")).toBeVisible();
  await page.fill("#modal-field-end_date", "2026-11-06");
  await page.fill("#modal-field-description", "Pruebas del segundo periodo");
  await page.click("#modal-submit");
  const exams = body.locator("tr", { hasText: "Semana de exámenes" });
  await expect(exams).toContainText("Exams");

  await body
    .locator("tr", { hasText: "Feria científica" })
    .locator('button[title="Edit"]')
    .click();
  await page.fill("#modal-field-title", "Feria científica 2026");
  // The same day as the start is a valid end, and reads as a one-day event.
  await page.fill("#modal-field-end_date", "2026-08-14");
  await page.click("#modal-submit");
  const feria = body.locator("tr", { hasText: "Feria científica 2026" });
  await expect(feria).toContainText("Activity");
  await expect(feria).not.toContainText("→");

  await exams.locator('button[title="Delete"]').click();
  await page.click("#confirm-delete");
  await expect(body).not.toContainText("Semana de exámenes");

  expect(errors).toEqual([]);
  expect(writes).toEqual([]);
});

test("event text reaches the student portal as text, not markup", async ({
  page,
  context,
}) => {
  await routeSupabase(context, {
    ...studentFix,
    events: [
      {
        id: 9,
        title: '<img src=x onerror="window.__xss=1">Assembly',
        description: "<b>bold?</b>",
        start_date: "2099-01-10",
        end_date: null,
        type: "general",
      },
    ],
  });
  await signIn(context);
  await page.goto("/");
  await expect(page.locator("#upcoming-events-card")).toContainText(
    "<img src=x",
  );
  await page.click('aside a[data-page="events"]');
  const card = page.locator("#events-timeline .event-card");
  await expect(card.locator("h3")).toContainText("<img src=x");
  await expect(card.locator("p").first()).toHaveText("<b>bold?</b>");
  await expect(page.locator("#events-timeline img")).toHaveCount(0);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
});
