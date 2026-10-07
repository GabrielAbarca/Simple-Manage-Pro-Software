import { describe, it, expect } from "vitest";
import { statusAllowsSignIn } from "../src/js/admin/domain/enums.js";

describe("statusAllowsSignIn", () => {
  it("lets a student sign in only while active", () => {
    expect(statusAllowsSignIn("student", "active")).toBe(true);
    for (const status of ["inactive", "graduated", "transferred", "withdrawn"])
      expect(statusAllowsSignIn("student", status)).toBe(false);
  });

  it("keeps a teacher signing in on leave, but not once inactive", () => {
    expect(statusAllowsSignIn("teacher", "active")).toBe(true);
    expect(statusAllowsSignIn("teacher", "on_leave")).toBe(true);
    expect(statusAllowsSignIn("teacher", "inactive")).toBe(false);
  });

  it("treats a missing status as the column default, active", () => {
    expect(statusAllowsSignIn("student", null)).toBe(true);
    expect(statusAllowsSignIn("teacher", undefined)).toBe(true);
  });
});
