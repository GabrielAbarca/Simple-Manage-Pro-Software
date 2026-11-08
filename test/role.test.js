import { describe, it, expect, beforeEach, vi } from "vitest";

// Minimal chainable mock for role.js's needs: auth.getSession plus
// from("profiles").select().eq().maybeSingle(). `state` drives both.
const { state } = vi.hoisted(() => ({
  state: {
    session: /** @type {any} */ (null),
    profiles: /** @type {any[]} */ ([]),
    error: /** @type {any} */ (null),
  },
}));

vi.mock("../src/js/supabaseClient.js", () => {
  function make(table) {
    const filters = [];
    const b = {
      select: () => b,
      eq: (col, val) => (filters.push([col, val]), b),
      maybeSingle: () => {
        if (state.error) {
          return Promise.resolve({ data: null, error: state.error });
        }
        const rows = (table === "profiles" ? state.profiles : []).filter(
          (row) =>
            filters.every(([col, val]) => String(row[col]) === String(val)),
        );
        return Promise.resolve({ data: rows[0] ?? null, error: null });
      },
    };
    return b;
  }
  return {
    supabase: {
      from: (table) => make(table),
      auth: {
        getSession: async () => ({ data: { session: state.session } }),
      },
    },
  };
});

const { fetchRole, portalPath } = await import("../src/js/role.js");

beforeEach(() => {
  state.session = { user: { id: "uid-1" } };
  state.profiles = [];
  state.error = null;
});

describe("portalPath", () => {
  it("maps each role to its portal", () => {
    expect(portalPath("admin")).toBe("/admin.html");
    expect(portalPath("teacher")).toBe("/teacher.html");
    expect(portalPath("student")).toBe("/student.html");
  });

  it("routes missing roles like a student", () => {
    expect(portalPath(null)).toBe("/student.html");
    expect(portalPath(undefined)).toBe("/student.html");
  });
});

describe("fetchRole", () => {
  it("returns the stored role for the signed-in user", async () => {
    state.profiles = [
      { id: "uid-1", role: "admin" },
      { id: "uid-2", role: "teacher" },
    ];
    expect(await fetchRole()).toBe("admin");
  });

  it("returns null when signed out", async () => {
    state.session = null;
    expect(await fetchRole()).toBe(null);
  });

  it("returns null when no profile row exists", async () => {
    expect(await fetchRole()).toBe(null);
  });

  it("returns null for an unknown role value", async () => {
    state.profiles = [{ id: "uid-1", role: "director" }];
    expect(await fetchRole()).toBe(null);
  });

  it("returns null when the profiles query errors", async () => {
    const silenced = vi.spyOn(console, "error").mockImplementation(() => {});
    state.error = { message: "boom" };
    expect(await fetchRole()).toBe(null);
    silenced.mockRestore();
  });
});
