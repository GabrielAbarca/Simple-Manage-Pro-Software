import { describe, it, expect } from "vitest";
import { refFromUrl, assertExpectedRef } from "../src/js/projectRef.ts";

describe("refFromUrl", () => {
  it("reads the project ref out of a Supabase URL", () => {
    expect(refFromUrl("https://abcd1234.supabase.co")).toBe("abcd1234");
    expect(refFromUrl("https://abcd1234.supabase.co/")).toBe("abcd1234");
    expect(refFromUrl("https://wklxkntdnzshyrijvnjj.supabase.co")).toBe(
      "wklxkntdnzshyrijvnjj",
    );
  });

  it("ignores path, port, and query", () => {
    expect(refFromUrl("https://demo.supabase.co:443/rest/v1?x=1")).toBe("demo");
  });

  it("returns null for anything it cannot parse", () => {
    expect(refFromUrl("not-a-url")).toBeNull();
    expect(refFromUrl("")).toBeNull();
    expect(refFromUrl("   ")).toBeNull();
    expect(refFromUrl(undefined)).toBeNull();
    expect(refFromUrl(null)).toBeNull();
    expect(refFromUrl(42)).toBeNull();
  });
});

describe("assertExpectedRef", () => {
  it("does nothing when no expectation is configured", () => {
    // The default everywhere: dev, CI, and any deployment that hasn't opted in.
    expect(() =>
      assertExpectedRef("https://anything.supabase.co", undefined),
    ).not.toThrow();
    expect(() =>
      assertExpectedRef("https://anything.supabase.co", ""),
    ).not.toThrow();
    expect(() =>
      assertExpectedRef("https://anything.supabase.co", "   "),
    ).not.toThrow();
  });

  it("passes when the URL points at the expected project", () => {
    expect(() =>
      assertExpectedRef("https://abcd1234.supabase.co", "abcd1234"),
    ).not.toThrow();
    // Whitespace in the env var shouldn't cause a false alarm.
    expect(() =>
      assertExpectedRef("https://abcd1234.supabase.co", " abcd1234 "),
    ).not.toThrow();
  });

  it("throws when a build is aimed at the wrong project", () => {
    expect(() =>
      assertExpectedRef("https://school-project.supabase.co", "demo-project"),
    ).toThrow(/project mismatch/i);
  });

  it("names both projects so the mistake is obvious", () => {
    let message = "";
    try {
      assertExpectedRef("https://school-project.supabase.co", "demo-project");
    } catch (err) {
      message = err.message;
    }
    expect(message).toContain("demo-project");
    expect(message).toContain("school-project");
  });

  it("throws when the URL is unreadable but an expectation is set", () => {
    expect(() => assertExpectedRef("garbage", "demo-project")).toThrow(
      /project mismatch/i,
    );
  });
});
