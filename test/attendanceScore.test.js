import { describe, it, expect } from "vitest";
import {
  LATES_PER_ABSENCE,
  attendanceRate,
} from "../src/js/attendanceScore.js";

/** n rows of one status, the shape attendanceRate reads. */
const rows = (n, status) => Array.from({ length: n }, () => ({ status }));

describe("attendanceRate", () => {
  it("is 100 when every counted day was attended", () => {
    expect(attendanceRate(rows(20, "present"))).toBe(100);
  });

  it("counts an absence against the rate", () => {
    // 18 of 20 days attended.
    expect(attendanceRate([...rows(18, "present"), ...rows(2, "absent")])).toBe(
      90,
    );
  });

  describe("three tardías make one ausencia", () => {
    it("costs nothing below the threshold", () => {
      // floor(2/3) = 0 absences, so all 10 days still count as attended.
      expect(attendanceRate([...rows(8, "present"), ...rows(2, "late")])).toBe(
        100,
      );
    });

    it("costs exactly one day at the threshold", () => {
      // floor(3/3) = 1 → 10 of 11 days. Lates stay in the denominator.
      expect(attendanceRate([...rows(8, "present"), ...rows(3, "late")])).toBe(
        (10 / 11) * 100,
      );
    });

    it("does not round up a partial group", () => {
      // floor(4/3) is still 1, not 2.
      expect(attendanceRate([...rows(8, "present"), ...rows(4, "late")])).toBe(
        (11 / 12) * 100,
      );
    });

    it("exposes the threshold it uses", () => {
      expect(LATES_PER_ABSENCE).toBe(3);
    });
  });

  describe("excused absences", () => {
    it("leaves them out of both sides rather than counting them attended", () => {
      // 10 present + 2 excused: the excused days vanish, so 10/10, not 12/12.
      const withExcused = attendanceRate([
        ...rows(10, "present"),
        ...rows(2, "excused"),
      ]);
      expect(withExcused).toBe(100);
    });

    it("changes the rate versus counting them as attended", () => {
      // 6 present, 2 absent, 2 excused → 6/8 = 75, not 8/10 = 80.
      expect(
        attendanceRate([
          ...rows(6, "present"),
          ...rows(2, "absent"),
          ...rows(2, "excused"),
        ]),
      ).toBe(75);
    });

    it("is null when every day was excused", () => {
      expect(attendanceRate(rows(5, "excused"))).toBe(null);
    });
  });

  describe("nothing to score", () => {
    // null, never 0: the category has to drop out of the weighted score the
    // way an ungraded one does. A 0 here would tank every grade in the school
    // on the first day of the curso lectivo.
    it("is null for no rows at all", () => {
      expect(attendanceRate([])).toBe(null);
      expect(attendanceRate(undefined)).toBe(null);
      expect(attendanceRate(null)).toBe(null);
    });

    it("ignores rows carrying an unrecognised status", () => {
      expect(attendanceRate([{ status: "bogus" }, { status: null }])).toBe(
        null,
      );
      expect(attendanceRate([...rows(4, "present"), { status: "bogus" }])).toBe(
        100,
      );
    });
  });

  it("floors at 0 rather than going negative", () => {
    expect(attendanceRate(rows(4, "absent"))).toBe(0);
  });

  it("matches the SQL view on the live demo fixture", () => {
    // 22 counted days, 1 absence, 5 lates → floor(5/3)=1 → 20/22.
    // The att_cat CTE returns 90.91 for exactly this shape.
    const rate = attendanceRate([
      ...rows(16, "present"),
      ...rows(1, "absent"),
      ...rows(5, "late"),
    ]);
    expect(Math.round(rate * 100) / 100).toBe(90.91);
  });
});
