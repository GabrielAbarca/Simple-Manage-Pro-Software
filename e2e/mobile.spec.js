import { test, expect } from "@playwright/test";
import {
  REF,
  studentFix,
  teacherFix,
  consoleFix,
  routeSupabase,
  sessionSeed,
} from "./fixtures.js";

async function noOverflow(page) {
  const scrollWidth = await page.evaluate(
    () => document.documentElement.scrollWidth,
  );
  return scrollWidth <= page.viewportSize().width;
}

async function seedSession(context) {
  await context.addInitScript(
    ([key, value]) => localStorage.setItem(key, value),
    [`sb-${REF}-auth-token`, sessionSeed()],
  );
}

test.describe("mobile — student portal", () => {
  test("fits the viewport and the nav drawer opens and closes", async ({
    page,
    context,
  }) => {
    await routeSupabase(context, studentFix);
    await seedSession(context);

    await page.goto("/");
    await page.waitForFunction(
      () =>
        document.getElementById("welcome-name")?.textContent?.includes("Ana"),
      { timeout: 10_000 },
    );
    expect(await noOverflow(page)).toBe(true);

    await page.click("#menu-btn");
    await expect(page.locator(".container > aside")).toBeVisible();
    const logout = page.locator("#logout-btn");
    await logout.scrollIntoViewIfNeeded();
    await expect(logout).toBeVisible();

    await page.click("#close-btn");
    await expect(page.locator(".container > aside")).toBeHidden();
    expect(await noOverflow(page)).toBe(true);
  });
});

test.describe("mobile — teacher console", () => {
  test("fits the viewport and drawer navigation closes the menu", async ({
    page,
    context,
  }) => {
    await routeSupabase(context, teacherFix);
    await seedSession(context);

    await page.goto("/teacher.html");
    await page.waitForFunction(
      () =>
        document.getElementById("teacher-name")?.textContent?.includes("Sofía"),
      { timeout: 10_000 },
    );
    expect(await noOverflow(page)).toBe(true);

    await page.click("#menu-btn");
    await expect(page.locator(".container > aside")).toBeVisible();
    await page.click('.container > aside a[data-page="myclasses"]');
    await expect(page.locator(".container > aside")).toBeHidden();

    await page.waitForSelector(".myclasses-grid");
    expect(await noOverflow(page)).toBe(true);
  });

  // The enhanced <select> keeps the OS control on touch and takes the custom
  // overlay out. The overlay's job is to draw the value, so on this branch the
  // native has to draw its own — it once kept the `color: transparent` meant
  // for the desktop overlay and the gradebook's period filter rendered as an
  // empty box on every phone.
  test("the gradebook period filter shows its value on touch", async ({
    page,
    context,
  }) => {
    await routeSupabase(context, teacherFix);
    await seedSession(context);

    await page.goto("/teacher.html");
    await page.waitForFunction(
      () =>
        document.getElementById("teacher-name")?.textContent?.includes("Sofía"),
      { timeout: 10_000 },
    );
    await page.evaluate(() =>
      document.querySelector('aside a[data-page="myclasses"]')?.click(),
    );
    await page.waitForSelector(".class-card");
    await page.locator(".class-card").first().click();
    await page.locator('.class-subtab[data-tab="gradebook"]').click();
    // initControls() enhances new selects via a MutationObserver batched
    // through requestAnimationFrame (see controls/index.js), so the native
    // element can exist a tick before enhanceSelect() actually wraps it —
    // wait for the enhancement marker itself, not just the raw element.
    await page.waitForFunction(
      () =>
        document.querySelector("#gradebook-period")?.dataset.smpEnhanced ===
        "true",
    );

    const control = await page.evaluate(() => {
      const native = document.querySelector("#gradebook-period");
      const trigger = document.querySelector("#gradebook-period-trigger");
      const cs = getComputedStyle(native);
      const box = native.getBoundingClientRect();
      return {
        coarse: matchMedia("(pointer: coarse)").matches,
        enhanced: !!native.closest(".smp-select"),
        color: cs.color,
        pointerEvents: cs.pointerEvents,
        width: box.width,
        height: box.height,
        overlayDisplay: trigger ? getComputedStyle(trigger).display : "absent",
        selected: native.selectedOptions[0]?.textContent?.trim(),
      };
    });

    expect(control.coarse).toBe(true);
    expect(control.enhanced).toBe(true);
    // The OS control is the whole UI here, so it has to paint and take taps.
    expect(control.color).not.toMatch(/rgba\(\s*0,\s*0,\s*0,\s*0\s*\)/);
    expect(control.pointerEvents).not.toBe("none");
    expect(control.width).toBeGreaterThan(0);
    expect(control.height).toBeGreaterThan(0);
    expect(control.overlayDisplay).toBe("none");
    expect(control.selected).toBeTruthy();
  });
});

test.describe("mobile — admin console", () => {
  test("fits the viewport and drawer navigation closes the menu", async ({
    page,
    context,
  }) => {
    await routeSupabase(context, consoleFix);
    await seedSession(context);

    await page.goto("/admin.html");
    await page.waitForFunction(
      () =>
        document.getElementById("admin-name")?.textContent?.includes("Gabriel"),
      { timeout: 10_000 },
    );
    expect(await noOverflow(page)).toBe(true);

    await page.click("#menu-btn");
    await expect(page.locator(".container > aside")).toBeVisible();
    await page.click('.container > aside a[data-page="students"]');
    await expect(page.locator(".container > aside")).toBeHidden();

    await expect(page.locator("#view-students")).toHaveClass(/active/);
    expect(await noOverflow(page)).toBe(true);
  });
});
