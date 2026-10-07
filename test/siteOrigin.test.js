import { describe, it, expect } from "vitest";
import { siteOrigin } from "../vite.config.js";

describe("siteOrigin", () => {
  it("uses the project's production domain on a production build", () => {
    expect(
      siteOrigin({
        VERCEL_ENV: "production",
        VERCEL_PROJECT_PRODUCTION_URL: "pilot.simplemanagepro.com",
        VERCEL_BRANCH_URL: "smp-pilot-git-main.vercel.app",
        VERCEL_URL: "smp-pilot-abc123.vercel.app",
      }),
    ).toBe("https://pilot.simplemanagepro.com");
  });

  it("uses the branch URL on a preview build", () => {
    expect(
      siteOrigin({
        VERCEL_ENV: "preview",
        VERCEL_PROJECT_PRODUCTION_URL: "demo.simplemanagepro.com",
        VERCEL_BRANCH_URL: "demo-git-feat-x.vercel.app",
        VERCEL_URL: "demo-abc123.vercel.app",
      }),
    ).toBe("https://demo-git-feat-x.vercel.app");
  });

  it("falls back to the deployment URL when there is no branch URL", () => {
    expect(
      siteOrigin({
        VERCEL_ENV: "preview",
        VERCEL_URL: "demo-abc123.vercel.app",
      }),
    ).toBe("https://demo-abc123.vercel.app");
  });

  it("keeps the demo domain outside Vercel", () => {
    expect(siteOrigin({})).toBe("https://demo.simplemanagepro.com");
  });
});
