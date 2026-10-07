import { describe, it, expect } from "vitest";
import { setupSteps } from "../src/js/admin/domain/setupSteps.js";

const empty = {
  activeYear: null,
  hasYears: false,
  periods: [],
  sections: [],
  subjects: [],
  teachers: [],
  assignments: [],
  enrolledCount: 0,
};
const done = (facts) =>
  Object.fromEntries(
    setupSteps({ ...empty, ...facts }).map((s) => [s.id, s.done]),
  );
const step = (facts, id) =>
  setupSteps({ ...empty, ...facts }).find((s) => s.id === id);

describe("setupSteps", () => {
  it("lists the eight steps in dependency order, none done on an empty school", () => {
    const steps = setupSteps(empty);
    expect(steps.map((s) => s.id)).toEqual([
      "year",
      "periods",
      "sections",
      "subjects",
      "teachers",
      "assignments",
      "students",
      "logins",
    ]);
    expect(steps.every((s) => !s.done)).toBe(true);
  });

  it("asks to activate a year that exists but is not active", () => {
    expect(step({ hasYears: true }, "year")).toMatchObject({
      done: false,
      activate: true,
    });
    expect(step({}, "year").activate).toBe(false);
    expect(step({ activeYear: { id: 1 }, hasYears: true }, "year").done).toBe(
      true,
    );
  });

  it("counts periods done only at exactly 100%", () => {
    expect(done({}).periods).toBe(false);
    expect(done({ periods: [{ weight: 50 }] }).periods).toBe(false);
    expect(
      done({
        periods: [{ weight: 33.33 }, { weight: 33.33 }, { weight: 33.34 }],
      }).periods,
    ).toBe(true);
  });

  it("does not count inactive teachers", () => {
    expect(done({ teachers: [{ id: 1, status: "inactive" }] }).teachers).toBe(
      false,
    );
    expect(done({ teachers: [{ id: 1, status: "on_leave" }] }).teachers).toBe(
      true,
    );
  });

  it("counts students only once they are enrolled in a section", () => {
    expect(done({ enrolledCount: 0 }).students).toBe(false);
    expect(done({ enrolledCount: 3 }).students).toBe(true);
  });

  it("wants a login for every assigned, active teacher", () => {
    const teachers = [
      { id: 1, status: "active", auth_user_id: "a" },
      { id: 2, status: "active", auth_user_id: null },
      { id: 3, status: "inactive", auth_user_id: null },
    ];
    expect(done({ teachers, assignments: [] }).logins).toBe(false);
    expect(
      done({ teachers, assignments: [{ teacher_id: 1 }, { teacher_id: 2 }] })
        .logins,
    ).toBe(false);
    expect(
      done({ teachers, assignments: [{ teacher_id: 1 }, { teacher_id: 3 }] })
        .logins,
    ).toBe(true);
  });
});
