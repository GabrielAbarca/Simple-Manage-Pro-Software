import { describe, it, expect } from "vitest";
import {
  required,
  email,
  phone,
  integer,
  numeric,
  min,
  atMost,
  maxLen,
  percent,
  dateWithin,
  endAfterStart,
  endNotBeforeStart,
  notFuture,
  unique,
  password,
  runRules,
} from "../src/js/validate.js";

/** Every rule returns null (pass) or a { key, vars } descriptor (fail). */
const keyOf = (result) => result?.key ?? null;

describe("required", () => {
  const rule = required();
  it("rejects empty, blank and missing values", () => {
    expect(keyOf(rule("", {}))).toBe("validation.required");
    expect(keyOf(rule("   ", {}))).toBe("validation.required");
    expect(keyOf(rule(null, {}))).toBe("validation.required");
  });
  it("accepts any real value", () => {
    expect(rule("x", {})).toBeNull();
    expect(rule("0", {})).toBeNull();
  });
});

describe("email", () => {
  const rule = email();
  it("accepts a well-formed address", () => {
    expect(rule("director@escuela.cr", {})).toBeNull();
    expect(rule("  spaced@example.com  ", {})).toBeNull();
  });
  it("rejects malformed addresses", () => {
    ["plainstring", "no@dot", "@example.com", "a b@example.com"].forEach((v) =>
      expect(keyOf(rule(v, {}))).toBe("validation.email"),
    );
  });
  it("treats blank as acceptable (the field is optional)", () => {
    expect(rule("", {})).toBeNull();
  });
});

describe("phone", () => {
  const rule = phone();
  it("accepts digits, spaces, + and -", () => {
    ["8888-8888", "+506 8888 8888", "22334455"].forEach((v) =>
      expect(rule(v, {})).toBeNull(),
    );
  });
  it("rejects letters and other punctuation", () => {
    ["call me", "8888-CALL", "(506) 8888", "8888.8888"].forEach((v) =>
      expect(keyOf(rule(v, {}))).toBe("validation.phone"),
    );
  });
  it("rejects punctuation with no digits at all", () => {
    expect(keyOf(rule("+ - ", {}))).toBe("validation.phone");
  });
  it("treats blank as acceptable", () => {
    expect(rule("", {})).toBeNull();
  });
});

describe("integer / numeric", () => {
  it("rejects letters in an integer field", () => {
    expect(keyOf(integer()("abc", {}))).toBe("validation.integer");
    expect(keyOf(integer()("1.5", {}))).toBe("validation.integer");
    expect(keyOf(integer()("2e3", {}))).toBe("validation.integer");
  });
  it("accepts whole numbers", () => {
    expect(integer()("7", {})).toBeNull();
    expect(integer()("-3", {})).toBeNull();
  });
  it("accepts decimals in a numeric field but not letters", () => {
    expect(numeric()("33.34", {})).toBeNull();
    expect(keyOf(numeric()("thirty", {}))).toBe("validation.number");
  });
});

describe("min / atMost", () => {
  it("enforces a floor", () => {
    expect(keyOf(min(1)("0", {}))).toBe("validation.min");
    expect(min(1)("1", {})).toBeNull();
  });
  it("enforces a static ceiling", () => {
    expect(keyOf(atMost(30)("31", {}))).toBe("validation.max");
    expect(atMost(30)("30", {})).toBeNull();
  });
  it("resolves the ceiling from sibling values", () => {
    // A section's capacity may not exceed its selected room's capacity.
    const rooms = { 5: 25, 6: 40 };
    const rule = atMost(
      (values) => rooms[values.room_id],
      "validation.capacityRoom",
      (n, cap) => ({ capacity: n, roomCapacity: cap }),
    );
    const failure = rule("30", { room_id: 5 });
    expect(keyOf(failure)).toBe("validation.capacityRoom");
    expect(failure.vars).toEqual({ capacity: 30, roomCapacity: 25 });
    // Same capacity is fine in the bigger room.
    expect(rule("30", { room_id: 6 })).toBeNull();
  });
  it("skips the ceiling when no room is selected or it has no capacity", () => {
    const rule = atMost((values) => values.roomCap);
    expect(rule("999", { roomCap: null })).toBeNull();
    expect(rule("999", {})).toBeNull();
  });
});

describe("maxLen", () => {
  const rule = maxLen(5);
  it("rejects a value longer than the limit", () => {
    expect(keyOf(rule("abcdef", {}))).toBe("validation.maxLength");
  });
  it("reports the limit so the message can name it", () => {
    expect(rule("abcdef", {}).vars).toEqual({ max: 5 });
  });
  it("accepts a value exactly at the limit", () => {
    expect(rule("abcde", {})).toBeNull();
  });
  it("measures the trimmed value, matching what gets stored", () => {
    expect(rule("  abcde  ", {})).toBeNull();
  });
  it("stays silent on blanks — only required() speaks for those", () => {
    expect(rule("", {})).toBeNull();
    expect(rule(null, {})).toBeNull();
  });
});

describe("percent", () => {
  const rule = percent();
  it("accepts 0 through 100", () => {
    ["0", "33.34", "100"].forEach((v) => expect(rule(v, {})).toBeNull());
  });
  it("rejects out-of-range and non-numeric values", () => {
    ["-1", "101", "abc"].forEach((v) =>
      expect(keyOf(rule(v, {}))).toBe("validation.percent"),
    );
  });
});

describe("dateWithin", () => {
  const rule = dateWithin("2025-09-01", "2026-06-30", {
    start: "Sep 1, 2025",
    end: "Jun 30, 2026",
  });
  it("accepts dates inside the range, boundaries included", () => {
    ["2025-09-01", "2026-01-15", "2026-06-30"].forEach((v) =>
      expect(rule(v, {})).toBeNull(),
    );
  });
  it("rejects dates outside it and reports the formatted bounds", () => {
    const failure = rule("2026-08-15", {});
    expect(keyOf(failure)).toBe("validation.dateWithin");
    expect(failure.vars).toEqual({ start: "Sep 1, 2025", end: "Jun 30, 2026" });
    expect(keyOf(rule("2025-08-31", {}))).toBe("validation.dateWithin");
  });
});

describe("endNotBeforeStart", () => {
  const rule = endNotBeforeStart("start_date");
  it("allows the same day and a later day", () => {
    expect(rule("2026-09-15", { start_date: "2026-09-15" })).toBeNull();
    expect(rule("2026-09-16", { start_date: "2026-09-15" })).toBeNull();
  });
  it("rejects an end before the start", () => {
    expect(keyOf(rule("2026-09-14", { start_date: "2026-09-15" }))).toBe(
      "validation.endBeforeStart",
    );
  });
  it("passes when either date is missing", () => {
    expect(rule("", { start_date: "2026-09-15" })).toBeNull();
    expect(rule("2026-09-14", {})).toBeNull();
  });
});

describe("endAfterStart", () => {
  const rule = endAfterStart("start_date");
  it("requires the end to be strictly later", () => {
    expect(keyOf(rule("2026-01-01", { start_date: "2026-01-01" }))).toBe(
      "validation.endAfterStart",
    );
    expect(keyOf(rule("2025-12-31", { start_date: "2026-01-01" }))).toBe(
      "validation.endAfterStart",
    );
    expect(rule("2026-01-02", { start_date: "2026-01-01" })).toBeNull();
  });
  it("stays quiet until both dates are present", () => {
    expect(rule("", { start_date: "2026-01-01" })).toBeNull();
    expect(rule("2026-01-01", {})).toBeNull();
  });
});

describe("notFuture", () => {
  const rule = notFuture("2026-07-26");
  it("rejects a date after today", () => {
    expect(keyOf(rule("2026-07-27", {}))).toBe("validation.futureDate");
  });
  it("accepts today and earlier", () => {
    expect(rule("2026-07-26", {})).toBeNull();
    expect(rule("2010-03-04", {})).toBeNull();
  });
});

describe("unique", () => {
  it("rejects a value already taken", () => {
    const rule = unique(["S-001", "S-002"]);
    const failure = rule("S-002", {});
    expect(keyOf(failure)).toBe("validation.unique");
    expect(failure.vars).toEqual({ value: "S-002" });
  });
  it("compares case-insensitively and ignores surrounding space", () => {
    const rule = unique(["MATH7"]);
    expect(keyOf(rule("  math7 ", {}))).toBe("validation.unique");
  });
  it("excludes the row's own current value so an edit can keep it", () => {
    const rule = unique(["S-001", "S-002"], { current: "S-002" });
    expect(rule("S-002", {})).toBeNull();
    expect(keyOf(rule("S-001", {}))).toBe("validation.unique");
  });
  it("supports a custom message key", () => {
    const rule = unique(["S-001"], {
      messageKey: "validation.enrollmentTaken",
    });
    expect(keyOf(rule("S-001", {}))).toBe("validation.enrollmentTaken");
  });
  it("ignores blank and missing existing values", () => {
    const rule = unique([null, "", "  "]);
    expect(rule("anything", {})).toBeNull();
    expect(rule("", {})).toBeNull();
  });
});

describe("password", () => {
  it("enforces the minimum length", () => {
    expect(keyOf(password()("short", {}))).toBe("validation.password");
    expect(password()("longenough", {})).toBeNull();
  });
});

describe("runRules", () => {
  it("collects one message per failing field", () => {
    const errors = runRules(
      {
        name: [required()],
        email: [email()],
        weight: [percent()],
      },
      { name: "", email: "nope", weight: "50" },
    );
    expect(Object.keys(errors).sort()).toEqual(["email", "name"]);
    expect(errors.name.key).toBe("validation.required");
    expect(errors.email.key).toBe("validation.email");
  });

  it("stops at the first failure for a field (cheapest rule first)", () => {
    // Blank hits required(); the integer rule would also fire on "" if the
    // rules were not short-circuited and blank-tolerant.
    const errors = runRules(
      { order: [required(), integer(), min(1)] },
      {
        order: "",
      },
    );
    expect(errors.order.key).toBe("validation.required");
  });

  it("returns an empty object when everything passes", () => {
    const errors = runRules(
      { name: [required()], phone: [phone()] },
      { name: "7th Grade", phone: "" },
    );
    expect(errors).toEqual({});
  });

  it("tolerates missing values and empty rule sets", () => {
    expect(runRules({ a: [] }, {})).toEqual({});
    expect(runRules({}, {})).toEqual({});
    expect(runRules(null, null)).toEqual({});
  });

  it("passes sibling values to cross-field rules", () => {
    const errors = runRules(
      { end_date: [endAfterStart("start_date")] },
      { start_date: "2026-05-01", end_date: "2026-04-01" },
    );
    expect(errors.end_date.key).toBe("validation.endAfterStart");
  });
});
