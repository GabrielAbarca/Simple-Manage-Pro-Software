import { describe, it, expect } from "vitest";
import { resolveTypeahead } from "../src/js/controls/typeahead.js";
import {
  toIso,
  fromIso,
  dateFieldOrder,
  firstDayOfWeek,
  parseDisplay,
  formatDisplay,
  monthGrid,
  withinRange,
} from "../src/js/controls/dateUtils.js";

// The DOM halves of these components are covered by Playwright. What is
// tested here is the logic that is easy to get subtly wrong and impossible
// to eyeball: typeahead cycling, locale-dependent date order, month-grid
// arithmetic across month and year boundaries, and DST-safe ISO handling.

const rows = (...labels) =>
  labels.map((l) =>
    typeof l === "string"
      ? { kind: "option", label: l }
      : {
          kind: l.group ? "group" : "option",
          label: l.label,
          disabled: l.disabled,
        },
  );

describe("select typeahead", () => {
  const list = rows(
    "All students",
    "Biology",
    "Bulgarian",
    "Chemistry",
    "Mathematics",
  );

  it("matches a prefix from the current position", () => {
    expect(resolveTypeahead(list, "ch", 0)).toBe(3);
  });

  it("is case-insensitive", () => {
    expect(resolveTypeahead(list, "MATH", 0)).toBe(4);
  });

  it("cycles through same-letter options on repeated presses", () => {
    // Native selects do this: pressing "b" twice reaches the SECOND B option.
    const first = resolveTypeahead(list, "b", -1);
    expect(first).toBe(1);
    expect(resolveTypeahead(list, "bb", first)).toBe(2);
    // and wraps back round
    expect(resolveTypeahead(list, "bbb", 2)).toBe(1);
  });

  it("distinguishes a repeated letter from a real prefix", () => {
    // "bu" is a prefix, not a cycle — it must not land on "Biology".
    expect(resolveTypeahead(list, "bu", 0)).toBe(2);
  });

  it("skips group headings and disabled options", () => {
    const withGroup = rows(
      { group: true, label: "Sciences" },
      { label: "Biology", disabled: true },
      "Botany",
    );
    expect(resolveTypeahead(withGroup, "b", -1)).toBe(2);
  });

  it("returns -1 when nothing matches or the buffer is empty", () => {
    expect(resolveTypeahead(list, "zz", 0)).toBe(-1);
    expect(resolveTypeahead(list, "", 0)).toBe(-1);
  });
});

describe("iso conversion", () => {
  it("round-trips through local midnight", () => {
    expect(toIso(fromIso("2026-09-01"))).toBe("2026-09-01");
  });

  it("does not shift the day west of Greenwich", () => {
    // new Date("2026-09-01") parses as UTC and lands on Aug 31 in the
    // Americas — which is where this app is used.
    const d = fromIso("2026-09-01");
    expect(d.getDate()).toBe(1);
    expect(d.getMonth()).toBe(8);
  });

  it("rejects anything that is not a full ISO date", () => {
    expect(fromIso("")).toBeNull();
    expect(fromIso("2026-9-1")).toBeNull();
    expect(fromIso("nonsense")).toBeNull();
  });
});

describe("locale awareness", () => {
  it("reads day-first for Costa Rican Spanish and month-first for US English", () => {
    expect(dateFieldOrder("es-CR")).toEqual(["day", "month", "year"]);
    expect(dateFieldOrder("en-US")).toEqual(["month", "day", "year"]);
  });

  it("starts the week on Monday in Spanish and Sunday in English", () => {
    expect(firstDayOfWeek("es-CR")).toBe(1);
    expect(firstDayOfWeek("en-US")).toBe(0);
  });

  it("formats the same date differently per locale", () => {
    expect(formatDisplay("2026-09-01", "es-CR")).toBe("01/09/2026");
    expect(formatDisplay("2026-09-01", "en-US")).toBe("09/01/2026");
  });
});

describe("parsing what a human typed", () => {
  it("reads the locale's own order", () => {
    expect(parseDisplay("01/09/2026", "es-CR")).toBe("2026-09-01");
    expect(parseDisplay("09/01/2026", "en-US")).toBe("2026-09-01");
  });

  it("accepts ISO whatever the locale — this is the path page.fill() takes", () => {
    expect(parseDisplay("2026-09-01", "es-CR")).toBe("2026-09-01");
    expect(parseDisplay("2026-09-01", "en-US")).toBe("2026-09-01");
  });

  it("tolerates single digits and any common separator", () => {
    expect(parseDisplay("1-9-2026", "es-CR")).toBe("2026-09-01");
    expect(parseDisplay("1.9.2026", "es-CR")).toBe("2026-09-01");
    expect(parseDisplay("1 9 2026", "es-CR")).toBe("2026-09-01");
  });

  it("expands a two-digit year", () => {
    expect(parseDisplay("01/09/26", "es-CR")).toBe("2026-09-01");
  });

  it("returns null rather than a wrong date for impossible input", () => {
    // Date would roll 31 February into March; that must not happen silently.
    expect(parseDisplay("31/02/2026", "es-CR")).toBeNull();
    expect(parseDisplay("45/01/2026", "es-CR")).toBeNull();
    expect(parseDisplay("nope", "es-CR")).toBeNull();
    expect(parseDisplay("1/2", "es-CR")).toBeNull();
  });

  it("treats blank as cleared, not as an error", () => {
    expect(parseDisplay("", "es-CR")).toBe("");
    expect(parseDisplay("   ", "es-CR")).toBe("");
  });
});

describe("month grid", () => {
  it("is always six full weeks so the popover never changes height", () => {
    for (const m of [0, 1, 5, 11]) {
      expect(monthGrid(2026, m, 0)).toHaveLength(42);
    }
  });

  it("starts on the configured first day of the week", () => {
    // September 2026 begins on a Tuesday.
    const sun = monthGrid(2026, 8, 0);
    const mon = monthGrid(2026, 8, 1);
    expect(fromIso(sun[0].iso).getDay()).toBe(0);
    expect(fromIso(mon[0].iso).getDay()).toBe(1);
  });

  it("marks the leading and trailing days as outside the month", () => {
    const cells = monthGrid(2026, 8, 0);
    expect(cells[0].outside).toBe(true);
    expect(cells.find((c) => c.iso === "2026-09-01").outside).toBe(false);
    expect(cells.at(-1).outside).toBe(true);
  });

  it("crosses a year boundary correctly", () => {
    const dec = monthGrid(2026, 11, 0);
    expect(dec.some((c) => c.iso.startsWith("2027-01"))).toBe(true);
    const jan = monthGrid(2026, 0, 0);
    expect(jan.some((c) => c.iso.startsWith("2025-12"))).toBe(true);
  });

  it("handles a leap February", () => {
    const feb = monthGrid(2028, 1, 1);
    expect(feb.some((c) => c.iso === "2028-02-29")).toBe(true);
  });
});

describe("min/max range", () => {
  it("allows anything when neither bound is set", () => {
    expect(withinRange("2026-09-01", "", "")).toBe(true);
  });

  it("honours each bound inclusively", () => {
    expect(withinRange("2026-09-01", "2026-09-01", "")).toBe(true);
    expect(withinRange("2026-08-31", "2026-09-01", "")).toBe(false);
    expect(withinRange("2026-09-01", "", "2026-09-01")).toBe(true);
    expect(withinRange("2026-09-02", "", "2026-09-01")).toBe(false);
  });
});
