import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";

const root = new URL("../", import.meta.url);
const vercel = JSON.parse(readFileSync(new URL("vercel.json", root), "utf8"));
const siteHeaders = Object.fromEntries(
  vercel.headers
    .find((h) => h.source === "/(.*)")
    .headers.map((h) => [h.key, h.value]),
);

function parseCsp(value) {
  return new Map(
    value
      .split(";")
      .map((d) => d.trim().split(/\s+/))
      .filter((parts) => parts[0])
      .map(([name, ...sources]) => [name, sources]),
  );
}

const csp = parseCsp(siteHeaders["Content-Security-Policy"]);
const pages = readdirSync(root).filter((f) => f.endsWith(".html"));

function inlineScripts(html) {
  return [
    ...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g),
  ].map((m) => m[1]);
}

describe("security headers", () => {
  it("covers every HTML entry point", () => {
    expect(pages).toEqual(
      expect.arrayContaining([
        "index.html",
        "login.html",
        "teacher.html",
        "admin.html",
        "privacy.html",
        "terms.html",
        "404.html",
      ]),
    );
  });

  it.each(pages)("allows each inline script in %s by hash", (page) => {
    const html = readFileSync(new URL(page, root), "utf8");
    for (const body of inlineScripts(html)) {
      const hash = createHash("sha256")
        .update(body.replace(/\r\n?/g, "\n"), "utf8")
        .digest("base64");
      expect(csp.get("script-src")).toContain(`'sha256-${hash}'`);
    }
  });

  it("never allows inline or eval'd script", () => {
    const scriptSrc = csp.get("script-src") ?? [];
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain("'unsafe-eval'");
  });

  it("lets the app reach its Supabase project", () => {
    expect(csp.get("connect-src")).toContain("https://*.supabase.co");
  });

  it("forbids framing and plugin content", () => {
    expect(csp.get("frame-ancestors")).toEqual(["'none'"]);
    expect(csp.get("object-src")).toEqual(["'none'"]);
    expect(siteHeaders["X-Frame-Options"]).toBe("DENY");
  });

  it("sets the baseline hardening headers", () => {
    expect(siteHeaders["X-Content-Type-Options"]).toBe("nosniff");
    expect(siteHeaders["Referrer-Policy"]).toBe(
      "strict-origin-when-cross-origin",
    );
    expect(siteHeaders["Permissions-Policy"]).toMatch(/camera=\(\)/);
    expect(siteHeaders["Strict-Transport-Security"]).toMatch(/max-age=\d+/);
  });
});
