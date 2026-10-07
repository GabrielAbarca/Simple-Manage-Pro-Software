import { test, expect } from "@playwright/test";
import {
  REF,
  consoleFix,
  teacherFix,
  routeSupabase,
  sessionSeed,
} from "./fixtures.js";

// Weights that do not total 100% can be built up one item at a time, but
// never pushed over 100%, and an incomplete set cannot be used: an admin
// scheme cannot become the default or be applied to a gradebook, and a
// gradebook cannot post grades.

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

const toast = (page) => page.locator("#toast-container .toast-error").last();

test.describe("admin component schemes", () => {
  const fix = {
    ...consoleFix,
    grade_component_templates: [
      { id: 8, name: "Incompleta", subject_id: null, is_default: false },
    ],
    grade_component_template_items: [
      {
        id: 81,
        template_id: 8,
        name: "Examen",
        weight: 60,
        item_order: 1,
        kind: "assignments",
      },
    ],
  };

  async function openSchemes(page, context, overrides = {}) {
    const writes = await routeSupabase(context, { ...fix, ...overrides });
    await signIn(context);
    const errors = trackErrors(page);
    await page.goto("/admin.html");
    await page.waitForFunction(() =>
      document.getElementById("admin-name")?.textContent?.includes("Gabriel"),
    );
    await page.click('.sidebar a[data-page="subjects"]');
    await expect(
      page.locator('#templates-body button[title="Edit components"]'),
    ).toBeVisible();
    return { writes, errors };
  }

  test("a component that would push the total over 100% is refused", async ({
    page,
    context,
  }) => {
    const { writes, errors } = await openSchemes(page, context);
    await page.click('#templates-body button[title="Edit components"]');
    await page.click("#template-items-footer >> text=Add component");
    await page.fill("#modal-field-name", "Proyecto");
    await page.fill("#modal-field-weight", "50");
    await page.click("#modal-submit");
    await expect(page.locator(".field-error")).toContainText(
      "Components would total 110%, over 100%.",
    );
    await expect(page.locator("#template-items-body")).not.toContainText(
      "Proyecto",
    );

    await page.fill("#modal-field-weight", "40");
    await page.click("#modal-submit");
    await expect(page.locator("#template-items-body")).toContainText(
      "Total: 100%",
    );
    expect(errors).toEqual([]);
    expect(writes).toEqual([]);
  });

  test("a component's delete confirmation opens above the components", async ({
    page,
    context,
  }) => {
    const { writes } = await openSchemes(page, context);
    await page.click('#templates-body button[title="Edit components"]');
    await page.click('#template-items-body button[title="Delete"]');
    await page.click("#confirm-delete");
    await expect(page.locator("#template-items-body")).toContainText(
      "No components yet.",
    );
    expect(writes).toEqual([]);
  });

  test("editing a component in place counts its weight once", async ({
    page,
    context,
  }) => {
    await openSchemes(page, context);
    await page.click('#templates-body button[title="Edit components"]');
    await page.click('#template-items-body button[title="Edit"]');
    await page.fill("#modal-field-weight", "100");
    await page.click("#modal-submit");
    await expect(page.locator("#template-items-body")).toContainText(
      "Total: 100%",
    );
  });

  test("a scheme already over 100% can still be brought down", async ({
    page,
    context,
  }) => {
    await openSchemes(page, context, {
      grade_component_template_items: [
        { id: 81, template_id: 8, name: "Examen", weight: 80, item_order: 1 },
        { id: 82, template_id: 8, name: "Tareas", weight: 80, item_order: 2 },
      ],
    });
    await page.click('#templates-body button[title="Edit components"]');
    const examen = page.locator("#template-items-body tr", {
      hasText: "Examen",
    });
    await examen.locator('button[title="Edit"]').click();
    await page.fill("#modal-field-weight", "40");
    await page.click("#modal-submit");
    await expect(page.locator("#template-items-body")).toContainText(
      "Total: 120%",
    );
    // Raising it again would make the overshoot worse.
    await examen.locator('button[title="Edit"]').click();
    await page.fill("#modal-field-weight", "50");
    await page.click("#modal-submit");
    await expect(page.locator(".field-error")).toContainText(
      "Components would total 130%, over 100%.",
    );
  });

  test("taking the default scheme off 100% warns that teachers cannot apply it", async ({
    page,
    context,
  }) => {
    await openSchemes(page, context, {
      grade_component_templates: [
        { id: 8, name: "Plan", subject_id: null, is_default: true },
      ],
      grade_component_template_items: [
        { id: 81, template_id: 8, name: "Examen", weight: 50, item_order: 1 },
        { id: 82, template_id: 8, name: "Tareas", weight: 50, item_order: 2 },
      ],
    });
    await page.click('#templates-body button[title="Edit components"]');
    await page
      .locator("#template-items-body tr", { hasText: "Tareas" })
      .locator('button[title="Delete"]')
      .click();
    await page.click("#confirm-delete");
    await expect(toast(page)).toContainText(
      "This is the default scheme and now totals 50%.",
    );
  });

  test("the MEP preset is refused when it would overshoot", async ({
    page,
    context,
  }) => {
    await openSchemes(page, context);
    await page.click('#templates-body button[title="Edit components"]');
    await page.click("#template-items-footer >> text=Load MEP preset");
    await expect(toast(page)).toContainText(
      "The MEP preset would bring this scheme to 160%.",
    );
    await expect(page.locator("#template-items-body")).not.toContainText(
      "Cotidiano",
    );
  });

  test("an incomplete scheme cannot become the default", async ({
    page,
    context,
  }) => {
    await openSchemes(page, context);
    await page.click('#templates-body button[title="Set as default"]');
    await expect(toast(page)).toContainText(
      "A scheme must total 100% to be the default. This one totals 60%.",
    );
    await expect(page.locator("#templates-body")).not.toContainText("Default");
  });
});

test.describe("teacher gradebook weights", () => {
  async function openGradebook(page, context, overrides = {}) {
    const writes = await routeSupabase(context, {
      ...teacherFix,
      ...overrides,
    });
    await signIn(context);
    const errors = trackErrors(page);
    await page.goto("/teacher.html");
    await page.waitForFunction(
      () =>
        document.getElementById("teacher-name")?.textContent?.includes("Sofía"),
      { timeout: 10_000 },
    );
    await page.click('aside a[data-page="myclasses"]');
    await page.waitForSelector(".class-card");
    await page.locator(".class-card").first().click();
    await page.locator('.class-subtab[data-tab="gradebook"]').click();
    await page.waitForSelector("#gradebook-period");
    await expect(page.locator("#gradebook-grid .skeleton-block")).toHaveCount(
      0,
    );
    return { writes, errors };
  }

  const examsAt70 = {
    grade_categories: [
      {
        id: 1,
        class_subject_teacher_id: 11,
        name: "Exámenes",
        weight: 70,
        kind: "assignments",
      },
    ],
  };

  test("a category that would push the total over 100% is refused", async ({
    page,
    context,
  }) => {
    const { writes, errors } = await openGradebook(page, context, examsAt70);
    await page.click("#btn-categories");
    await expect(page.locator("#categories-total")).toContainText(
      "they must total 100% before grades can be posted",
    );
    await page.click("#categories-add");
    await page.fill("#modal-field-name", "Tareas");
    await page.fill("#modal-field-weight", "40");
    await page.click("#modal-submit");
    await expect(page.locator(".field-error")).toContainText(
      "Categories would total 110%, over 100%.",
    );
    await page.fill("#modal-field-weight", "30");
    await page.click("#modal-submit");
    await expect(page.locator("#categories-body")).toContainText("Tareas");
    await expect(page.locator("#categories-total")).toContainText(
      "Total: 100%",
    );
    await expect(page.locator("#categories-total")).not.toContainText(
      "must total",
    );
    expect(errors).toEqual([]);
    expect(writes).toEqual([]);
  });

  test("a negative category weight is refused", async ({ page, context }) => {
    await openGradebook(page, context);
    await page.click("#btn-categories");
    await page.click("#categories-add");
    await page.fill("#modal-field-name", "Bono");
    await page.fill("#modal-field-weight", "-50");
    await page.click("#modal-submit");
    await expect(page.locator(".field-error")).toContainText(
      "Enter a percentage between 0 and 100.",
    );
  });

  test("a gradebook already over 100% can still be brought down", async ({
    page,
    context,
  }) => {
    await openGradebook(page, context, {
      grade_categories: [
        { id: 1, class_subject_teacher_id: 11, name: "Exámenes", weight: 80 },
        { id: 2, class_subject_teacher_id: 11, name: "Tareas", weight: 80 },
      ],
    });
    await page.click("#btn-categories");
    await page
      .locator(".manage-item", { hasText: "Exámenes" })
      .locator('button[title="Edit"]')
      .click();
    await page.fill("#modal-field-weight", "40");
    await page.click("#modal-submit");
    await expect(page.locator("#categories-total")).toContainText(
      "Total: 120%",
    );
  });

  for (const [label, categories] of [
    [
      "categories at 100%",
      [
        { id: 1, class_subject_teacher_id: 11, name: "Exámenes", weight: 60 },
        { id: 2, class_subject_teacher_id: 11, name: "Tareas", weight: 40 },
      ],
    ],
    ["no categories", []],
  ]) {
    test(`grades can be posted with ${label}`, async ({ page, context }) => {
      await openGradebook(page, context, { grade_categories: categories });
      await page.click("#btn-post-grades");
      await expect(page.locator("#post-grades-overlay")).toHaveClass(/active/);
    });
  }

  test("grades cannot be posted while the categories are off 100%", async ({
    page,
    context,
  }) => {
    await openGradebook(page, context, examsAt70);
    await page.click("#btn-post-grades");
    await expect(toast(page)).toContainText(
      "This gradebook's categories total 70%.",
    );
    await expect(page.locator("#post-grades-overlay")).not.toHaveClass(
      /active/,
    );
  });

  test("a scheme that would overshoot the categories is not applied", async ({
    page,
    context,
  }) => {
    await openGradebook(page, context, examsAt70);
    await page.click("#btn-categories");
    await expect(page.locator("#categories-apply-template")).toHaveText(
      /Apply MEP template/,
    );
    await page.click("#categories-apply-template");
    await expect(page.locator("#modal-title")).toHaveText(
      "Apply a component scheme",
    );
    await page.click("#modal-submit");
    await expect(toast(page)).toContainText(
      "Applying it would bring the categories to 170%.",
    );
    await expect(page.locator("#categories-body")).not.toContainText(
      "Cotidiano",
    );
  });

  test("an incomplete scheme is not applied", async ({ page, context }) => {
    await openGradebook(page, context, {
      grade_component_template_items:
        teacherFix.grade_component_template_items.slice(0, 2),
    });
    await page.click("#btn-categories");
    await page.click("#categories-apply-template");
    await page.click("#modal-submit");
    await expect(toast(page)).toContainText('"Plantilla MEP" totals');
    await expect(page.locator("#categories-body")).not.toContainText(
      "Cotidiano",
    );
  });
});
