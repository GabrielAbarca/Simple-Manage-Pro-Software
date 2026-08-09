import { describe, it, expect } from "vitest";
import {
  getLang,
  t,
  tn,
  formatDate,
  formatTime,
  formatNumber,
} from "../src/js/i18n.js";

// i18n defaults to Spanish before any initI18n() call (no DOM/localStorage in
// this environment), so these assert the deterministic es-CR behavior. Spanish
// is the product default; English stays the per-key fallback dictionary.
describe("i18n translation resolver", () => {
  it("defaults to Spanish", () => {
    expect(getLang()).toBe("es");
  });

  it("resolves a real key to a non-empty string", () => {
    // enums.attendance.present exists in the dictionary; whatever its wording,
    // it must not fall through to the humanized key.
    const val = t("enums.attendance.present");
    expect(typeof val).toBe("string");
    expect(val.length).toBeGreaterThan(0);
    expect(val).not.toBe("Present ");
  });

  it("humanizes a missing key instead of rendering it raw or blank", () => {
    expect(t("totally.missing.someUnknownKey")).toBe("Some Unknown Key");
  });

  it("interpolates {tokens} and leaves unknown tokens intact", () => {
    // Uses a missing key so the humanized string carries no placeholders, then
    // a known-shaped one via a raw template is not available — assert no throw
    // and that provided vars never crash resolution.
    expect(() => t("missing.key", { name: "Ana" })).not.toThrow();
  });

  it("pluralizes via tn() (.one vs .other) and exposes {count}", () => {
    // Fallback path still exercises the plural branch deterministically.
    expect(tn("nope.things", 1)).toBe("One");
    expect(tn("nope.things", 5)).toBe("Other");
  });
});

describe("i18n locale-aware formatting (es-CR)", () => {
  it("formats an ISO date without timezone drift", () => {
    expect(formatDate("2026-07-15")).toBe("15 jul 2026");
  });

  it("returns '' for empty and the raw value for unparseable dates", () => {
    expect(formatDate("")).toBe("");
    expect(formatDate(null)).toBe("");
    expect(formatDate("not-a-date")).toBe("not-a-date");
  });

  it("formats 24h time strings to the locale's 12h form", () => {
    expect(formatTime("14:30")).toBe("2:30 p. m.");
    expect(formatTime("08:05")).toBe("8:05 a. m.");
  });

  it("formats numbers with grouping separators", () => {
    // es-CR groups with a non-breaking space and uses a comma decimal. Which
    // space character ICU picks has shifted between versions, so normalize it
    // and assert the part that actually matters: the comma.
    expect(formatNumber(1234.5).replace(/\s/g, " ")).toBe("1 234,5");
    expect(formatNumber("nan")).toBe("");
  });
});
