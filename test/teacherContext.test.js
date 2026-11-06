import { describe, it, expect, beforeEach } from "vitest";
import {
  resolveTeacherContext,
  hasTeacherContext,
} from "../src/js/teacher/context.js";
import { state } from "../src/js/teacher/state.js";

const YEAR = { id: 1, name: "2025-2026", is_active: true };
const PERIODS = [{ id: 1, name: "Period 1", period_order: 1 }];

/** A stub data layer; pass overrides to make a call fail or return nothing. */
function makeDb({ teacherId = 7, year = YEAR, periods = PERIODS, fail } = {}) {
  return {
    getTeacherId: async () => {
      if (fail === "teacher") throw new Error("teachers unreachable");
      return teacherId;
    },
    fetchActiveYear: async () => {
      if (fail === "year") throw new Error("school_years unreachable");
      return year;
    },
    fetchGradingPeriods: async () => periods,
  };
}

beforeEach(() => {
  state.teacherId = null;
  state.activeYear = null;
  state.periods = [];
  state.contextError = null;
});

describe("resolveTeacherContext", () => {
  it("populates the context and reports success", async () => {
    expect(await resolveTeacherContext(makeDb())).toBe(true);
    expect(state.teacherId).toBe(7);
    expect(state.activeYear).toEqual(YEAR);
    expect(state.periods).toEqual(PERIODS);
    expect(state.contextError).toBeNull();
  });

  // The whole point of the split try blocks: the console still knows which
  // school year it is in even when the teachers lookup dies.
  it("keeps the school year when the teacher lookup throws", async () => {
    expect(await resolveTeacherContext(makeDb({ fail: "teacher" }))).toBe(
      false,
    );
    expect(state.teacherId).toBeNull();
    expect(state.activeYear).toEqual(YEAR);
    expect(state.contextError).toBeInstanceOf(Error);
  });

  it("reports a failed year lookup", async () => {
    expect(await resolveTeacherContext(makeDb({ fail: "year" }))).toBe(false);
    expect(state.teacherId).toBe(7);
    expect(state.activeYear).toBeNull();
    expect(state.contextError).toBeInstanceOf(Error);
  });

  // An admin using the console for oversight owns no teachers row. That is an
  // expected state, not a failure — the views show it differently.
  it("treats an account with no teachers row as a success, not an error", async () => {
    expect(await resolveTeacherContext(makeDb({ teacherId: null }))).toBe(true);
    expect(state.teacherId).toBeNull();
    expect(state.contextError).toBeNull();
  });

  it("clears a previous failure on a successful retry", async () => {
    await resolveTeacherContext(makeDb({ fail: "teacher" }));
    expect(state.contextError).toBeInstanceOf(Error);

    expect(await resolveTeacherContext(makeDb())).toBe(true);
    expect(state.contextError).toBeNull();
    expect(state.teacherId).toBe(7);
  });
});

describe("hasTeacherContext", () => {
  it("needs both a teacher and an active year", async () => {
    expect(hasTeacherContext()).toBe(false);

    await resolveTeacherContext(makeDb({ teacherId: null }));
    expect(hasTeacherContext()).toBe(false);

    await resolveTeacherContext(makeDb({ year: null }));
    expect(hasTeacherContext()).toBe(false);

    await resolveTeacherContext(makeDb());
    expect(hasTeacherContext()).toBe(true);
  });
});
