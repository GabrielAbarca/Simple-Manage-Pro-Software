// Config for the design-review screenshot run (e2e/capture/*.capture.js).
//
// Separate from playwright.config.js on purpose: the capture files don't match
// Playwright's default `*.spec.js` pattern, so `npm run test:e2e` and CI never
// pick them up. Same self-contained dev server and dummy Supabase env as the
// suite — the captures mock the backend at the network layer.
//
//   npx playwright test --config playwright.capture.config.js

import { defineConfig } from "@playwright/test";

const PORT = 5198;

export default defineConfig({
  testDir: "./e2e/capture",
  testMatch: /.*\.capture\.js/,
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    // Deterministic pixels: no HiDPI scaling, so the PNGs come out at exactly
    // the requested viewport width.
    deviceScaleFactor: 1,
  },
  projects: [
    {
      name: "desktop",
      grep: /desktop captures/,
      use: { viewport: { width: 1440, height: 900 } },
    },
    {
      name: "mobile",
      grep: /mobile captures/,
      use: {
        viewport: { width: 375, height: 812 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 60_000,
    env: {
      VITE_SUPABASE_URL: "https://demo.supabase.co",
      VITE_SUPABASE_ANON_KEY: "e2e-anon-key",
      VITE_DEMO_MODE: "true",
    },
  },
});
