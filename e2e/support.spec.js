import { test, expect } from "@playwright/test";
import {
  REF,
  consoleFix,
  routeSupabase,
  seedLang,
  sessionSeed,
} from "./fixtures.js";

const MAILTO = "mailto:contact@gzelaya.com";

test("the login page shows a support contact without signing in", async ({
  page,
}) => {
  await page.goto("/login.html");
  await expect(page.locator(`.auth-support a[href="${MAILTO}"]`)).toBeVisible();
});

test("the admin top bar links to support", async ({ page, context }) => {
  await routeSupabase(context, consoleFix);
  await page.goto("/login.html");
  await page.evaluate(
    ([key, value]) => localStorage.setItem(key, value),
    [`sb-${REF}-auth-token`, sessionSeed()],
  );

  await page.goto("/admin.html");
  const link = page.locator(`.right .top a.top-support[href="${MAILTO}"]`);
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute("aria-label", "Email support");
});

test("the admin support link leaves the theme toggle and photo at full size", async ({
  page,
  context,
}) => {
  await routeSupabase(context, consoleFix);
  await seedLang(context, "es");
  await page.goto("/login.html");
  await page.evaluate(
    ([key, value]) => localStorage.setItem(key, value),
    [`sb-${REF}-auth-token`, sessionSeed()],
  );

  await page.goto("/admin.html");
  await expect(page.locator(".right .top .top-support")).toBeVisible();

  const m = await page.evaluate(() => {
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const box = (sel) => document.querySelector(sel).getBoundingClientRect();
    return {
      rem,
      top: box(".right .top"),
      support: box(".right .top .top-support"),
      toggle: box(".right .top .theme-toggler"),
      photo: box(".right .top .profile-photo"),
    };
  });

  expect(m.toggle.width).toBeCloseTo(4.6 * m.rem, 0);
  expect(m.photo.width).toBeCloseTo(m.photo.height, 0);
  expect(m.support.left).toBeGreaterThanOrEqual(m.top.left);
  expect(m.support.right).toBeLessThanOrEqual(m.toggle.left);
  expect(m.toggle.right).toBeLessThanOrEqual(m.photo.left);
});
