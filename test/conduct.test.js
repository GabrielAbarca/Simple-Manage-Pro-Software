import { describe, it, expect } from "vitest";
import {
  CONDUCT_MAX,
  conductScore,
  conductDeduction,
  conductAfter,
  groupRecordsByStudent,
} from "../src/js/conduct.js";

/** A discipline record as conductScore reads it. */
const rec = (conduct_points, extra = {}) => ({ conduct_points, ...extra });

describe("conductScore", () => {
  it("is 100 for a student with nothing on file", () => {
    // Not null: a clean discipline record IS the answer, unlike an empty
    // attendance record, where the grade is simply not knowable yet.
    expect(conductScore([])).toBe(CONDUCT_MAX);
    expect(conductScore([])).not.toBeNull();
  });

  it("treats a missing or empty record list as clean", () => {
    expect(conductScore(null)).toBe(100);
    expect(conductScore(undefined)).toBe(100);
  });

  it("subtracts each record's own points", () => {
    // 100 − (10 + 2 + 5) = 83.
    expect(conductScore([rec(10), rec(2), rec(5)])).toBe(83);
  });

  it("keeps two decimals", () => {
    expect(conductScore([rec(2.5), rec(1.25)])).toBe(96.25);
  });

  it("accepts the numeric string Supabase returns for numeric(5,2)", () => {
    expect(conductScore([rec("2.50"), rec("5.00")])).toBe(92.5);
  });

  describe("the floor holds at 0", () => {
    it("never returns a negative conducta", () => {
      expect(conductScore([rec(200)])).toBe(0);
      expect(conductScore([rec(60), rec(60)])).toBe(0);
    });

    it("lands exactly on 0 when the deductions total 100", () => {
      expect(conductScore([rec(50), rec(50)])).toBe(0);
    });
  });

  describe("a record with no usable points costs nothing", () => {
    it("ignores 0, null, undefined and a missing column", () => {
      // Every row predating conduct_points carries the 0 default, and a
      // record filed purely for the register is allowed to cost nothing.
      expect(conductScore([rec(0), rec(null), rec(undefined), {}])).toBe(100);
    });

    it("ignores a value that is not a number", () => {
      expect(conductScore([rec("abc"), rec(NaN), rec(Infinity)])).toBe(100);
    });

    it("ignores negative points rather than awarding them", () => {
      // Conducta counts down only — a negative must not hand out a 105.
      expect(conductScore([rec(-5)])).toBe(100);
      expect(conductScore([rec(-5), rec(10)])).toBe(90);
    });
  });

  describe("only the points decide the grade", () => {
    it("ignores severity entirely", () => {
      // Severity is kept for the register and carries no weight: the same
      // points at any severity must produce the same grade.
      const low = [rec(5, { severity: "low" })];
      const high = [rec(5, { severity: "high" })];
      const none = [rec(5, { severity: null })];
      expect(conductScore(low)).toBe(95);
      expect(conductScore(high)).toBe(conductScore(low));
      expect(conductScore(none)).toBe(conductScore(low));
    });

    it("ignores resolved and resolution", () => {
      // Both columns survive in the table but no longer surface, and neither
      // may forgive a deduction.
      const open = [rec(10, { resolved: false, resolution: null })];
      const closed = [rec(10, { resolved: true, resolution: "Spoke to them" })];
      expect(conductScore(open)).toBe(90);
      expect(conductScore(closed)).toBe(conductScore(open));
    });
  });
});

describe("conductAfter", () => {
  it("shows where the grade lands once the points are taken off", () => {
    expect(conductAfter(85, 2)).toBe(83);
    expect(conductAfter(100, 0)).toBe(100);
  });

  it("clamps at 0 when the deduction exceeds what is left", () => {
    expect(conductAfter(3, 10)).toBe(0);
  });

  it("starts from a clean 100 when the current grade is unknown", () => {
    expect(conductAfter(null, 5)).toBe(95);
    expect(conductAfter(undefined, 5)).toBe(95);
    expect(conductAfter("", 5)).toBe(95);
  });

  it("treats an empty or unusable points field as no deduction yet", () => {
    // The form's initial state: the field is blank while the teacher types.
    expect(conductAfter(85, "")).toBe(85);
    expect(conductAfter(85, null)).toBe(85);
    expect(conductAfter(85, "abc")).toBe(85);
    expect(conductAfter(85, -5)).toBe(85);
  });

  it("accepts the numeric strings an input element hands back", () => {
    expect(conductAfter("85.00", "2.5")).toBe(82.5);
  });
});

describe("conductDeduction", () => {
  it("totals the points the view reports as `deduction`", () => {
    expect(conductDeduction([rec(10), rec(2), rec(5)])).toBe(17);
    expect(conductDeduction([])).toBe(0);
  });

  it("keeps counting past 100 while the grade floors at 0", () => {
    // The two are separate for this reason: 120 points off is a 0, but the
    // record still shows 120 deducted.
    expect(conductDeduction([rec(60), rec(60)])).toBe(120);
    expect(conductScore([rec(60), rec(60)])).toBe(0);
  });

  it("ignores the same unusable values conductScore ignores", () => {
    expect(conductDeduction([rec(null), rec("abc"), rec(-5), {}])).toBe(0);
  });
});

describe("groupRecordsByStudent", () => {
  it("groups records by student and keeps them in newest-first order", () => {
    const records = [
      { id: 3, student_id: 2, date: "2026-09-25" },
      { id: 2, student_id: 1, date: "2026-09-18" },
      { id: 1, student_id: 2, date: "2026-08-20" },
    ];
    const byStudent = groupRecordsByStudent(records);
    expect(byStudent.size).toBe(2);
    expect(byStudent.get(2).map((r) => r.id)).toEqual([3, 1]);
    expect(byStudent.get(1).map((r) => r.id)).toEqual([2]);
  });

  it("returns an empty map when there are no records", () => {
    expect(groupRecordsByStudent([]).size).toBe(0);
    expect(groupRecordsByStudent(null).size).toBe(0);
    expect(groupRecordsByStudent([]).get(1)).toBeUndefined();
  });
});
