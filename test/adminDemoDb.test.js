import { describe, it, expect, vi } from "vitest";

// adminData.js constructs the real Supabase gateway at import time; stub the
// client so the module loads without env vars (tests use fake gateways).
vi.mock("../src/js/supabaseClient.js", () => ({ supabase: {} }));

import { createDemoGateway } from "../src/js/adminDemoDb.js";
import { createAdminData } from "../src/js/adminData.js";

// A fake "real" gateway backed by in-memory tables. It returns every row for a
// table (the demo overlay re-applies match/order itself), and its writes are
// recorded so tests can assert the overlay NEVER calls them.
function fakeRealGateway(seed = {}) {
  const tables = structuredClone(seed);
  const writes = [];
  return {
    writes,
    counts: [],
    async select(table, opts = {}) {
      const rows = (tables[table] ?? []).map((r) => ({ ...r }));
      if (!opts.columns) return rows;
      const cols = opts.columns.split(",").map((c) => c.trim());
      return rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c]])));
    },
    async count(table, opts) {
      this.counts.push([table, opts]);
      return (tables[table] ?? []).length;
    },
    async insert(table, row) {
      writes.push(["insert", table, row]);
      return { ...row, id: 999 };
    },
    async update(table, id) {
      writes.push(["update", table, id]);
    },
    async remove(table, id) {
      writes.push(["remove", table, id]);
    },
  };
}

describe("adminDemoDb — generic demo overlay", () => {
  it("passes reads through and applies match + ordering", async () => {
    const real = fakeRealGateway({
      grading_periods: [
        { id: 2, school_year_id: 1, name: "P2", period_order: 2 },
        { id: 1, school_year_id: 1, name: "P1", period_order: 1 },
        { id: 3, school_year_id: 9, name: "X", period_order: 1 },
      ],
    });
    const g = createDemoGateway(real);
    const rows = await g.select("grading_periods", {
      match: { school_year_id: 1 },
      order: { column: "period_order" },
    });
    expect(rows.map((r) => r.name)).toEqual(["P1", "P2"]);
  });

  it("records inserts locally (never on the real gateway) and overlays them", async () => {
    const real = fakeRealGateway({ school_years: [{ id: 1, name: "A" }] });
    const onWrite = vi.fn();
    const g = createDemoGateway(real, { onWrite });

    const created = await g.insert("school_years", { name: "B" });
    expect(created.id).toBeLessThan(0); // local negative id
    expect(onWrite).toHaveBeenCalledOnce();
    expect(real.writes).toEqual([]); // nothing reached the backend

    const rows = await g.select("school_years", {
      order: { column: "name" },
    });
    expect(rows.map((r) => r.name)).toEqual(["A", "B"]);
  });

  it("overlays updates onto server rows", async () => {
    const real = fakeRealGateway({
      rooms: [{ id: 1, name: "R1", capacity: 10 }],
    });
    const g = createDemoGateway(real);
    await g.update("rooms", 1, { capacity: 25 });
    const [room] = await g.select("rooms");
    expect(room.capacity).toBe(25);
    expect(real.writes).toEqual([]);
  });

  it("hides deleted server rows and drops deleted local inserts", async () => {
    const real = fakeRealGateway({ teachers: [{ id: 1, last_name: "A" }] });
    const g = createDemoGateway(real);

    await g.remove("teachers", 1);
    expect(await g.select("teachers")).toEqual([]);

    const local = await g.insert("teachers", { last_name: "B" });
    expect((await g.select("teachers")).length).toBe(1);
    await g.remove("teachers", local.id);
    expect(await g.select("teachers")).toEqual([]);
  });

  it("excludes local inserts that don't match a read's filter", async () => {
    const real = fakeRealGateway({ classes: [] });
    const g = createDemoGateway(real);
    await g.insert("classes", { school_year_id: 1, section: "A" });
    await g.insert("classes", { school_year_id: 2, section: "B" });
    const rows = await g.select("classes", { match: { school_year_id: 1 } });
    expect(rows.map((r) => r.section)).toEqual(["A"]);
  });

  it("orders numerically and honors descending", async () => {
    const real = fakeRealGateway({
      grade_levels: [
        { id: 1, numeric_level: 10 },
        { id: 2, numeric_level: 2 },
      ],
    });
    const g = createDemoGateway(real);
    const asc = await g.select("grade_levels", {
      order: { column: "numeric_level" },
    });
    expect(asc.map((r) => r.numeric_level)).toEqual([2, 10]);
    const desc = await g.select("grade_levels", {
      order: { column: "numeric_level", ascending: false },
    });
    expect(desc.map((r) => r.numeric_level)).toEqual([10, 2]);
  });
});

describe("adminDemoDb — ranges and counts", () => {
  it("applies an inclusive between filter across server and local rows", async () => {
    const real = fakeRealGateway({
      attendance: [
        { id: 1, date: "2026-03-01" },
        { id: 2, date: "2026-03-15" },
        { id: 3, date: "2026-04-01" },
        { id: 4, date: null },
      ],
    });
    const g = createDemoGateway(real);
    await g.insert("attendance", { date: "2026-03-31" });
    const rows = await g.select("attendance", {
      between: { column: "date", from: "2026-03-01", to: "2026-03-31" },
    });
    expect(rows.map((r) => r.date).sort()).toEqual([
      "2026-03-01",
      "2026-03-15",
      "2026-03-31",
    ]);
  });

  it("filters a narrowed read by a column it did not ask for", async () => {
    const real = fakeRealGateway({
      attendance: [
        { id: 1, student_id: 7, status: "absent", date: "2026-03-02" },
        { id: 2, student_id: 7, status: "absent", date: "2026-05-02" },
      ],
    });
    const rows = await createDemoGateway(real).select("attendance", {
      columns: "id, student_id",
      between: { column: "date", from: "2026-03-01", to: "2026-03-31" },
    });
    expect(rows.map((r) => r.id)).toEqual([1]);
  });

  it("passes a count straight through while the table is untouched", async () => {
    const real = fakeRealGateway({ students: [{ id: 1 }, { id: 2 }] });
    const g = createDemoGateway(real);
    const opts = { match: { status: "active" } };
    expect(await g.count("students", opts)).toBe(2);
    expect(real.counts).toEqual([["students", opts]]);
  });

  it("counts through the overlay once the table has local changes", async () => {
    const real = fakeRealGateway({
      students: [
        { id: 1, status: "active" },
        { id: 2, status: "active" },
        { id: 3, status: "inactive" },
      ],
    });
    const g = createDemoGateway(real);
    await g.insert("students", { status: "active" });
    await g.update("students", 2, { status: "inactive" });
    await g.remove("students", 1);
    expect(await g.count("students", { match: { status: "active" } })).toBe(1);
    expect(real.counts).toEqual([]);
    expect(real.writes).toEqual([]);
  });

  it("counts a row a local update brings into the filter", async () => {
    const real = fakeRealGateway({
      students: [
        { id: 1, status: "active" },
        { id: 2, status: "inactive" },
      ],
    });
    // Make the server side drop non-matching rows, as PostgREST does.
    const serverSelect = real.select.bind(real);
    real.select = async (table, opts = {}) =>
      (await serverSelect(table, opts)).filter(
        (r) => !opts.match || r.status === opts.match.status,
      );
    const g = createDemoGateway(real);
    await g.update("students", 2, { status: "active" });
    expect(await g.count("students", { match: { status: "active" } })).toBe(2);
  });
});

describe("adminData — createAdminData over a gateway", () => {
  it("setActiveYear clears previously-active years then activates the target", async () => {
    const calls = [];
    /** @type {any} */
    const gateway = {
      select: async () => [],
      insert: async () => ({}),
      update: async (table, id, patch) => calls.push([table, id, patch]),
      remove: async () => {},
    };
    const data = createAdminData(gateway);
    await data.setActiveYear(3, [1, 2, 3]);
    expect(calls).toEqual([
      ["school_years", 1, { is_active: false }],
      ["school_years", 2, { is_active: false }],
      ["school_years", 3, { is_active: true }],
    ]);
  });

  it("routes list/create/delete to the right table", async () => {
    const calls = [];
    /** @type {any} */
    const gateway = {
      select: async (table, opts) => (calls.push(["select", table, opts]), []),
      insert: async (table, row) => (calls.push(["insert", table, row]), row),
      update: async () => {},
      remove: async (table, id) => calls.push(["remove", table, id]),
    };
    const data = createAdminData(gateway);
    await data.listSchoolYears();
    await data.createSubject({ name: "Math" });
    await data.deleteRoom(5);
    expect(calls).toEqual([
      [
        "select",
        "school_years",
        { order: { column: "start_date", ascending: false } },
      ],
      ["insert", "subjects", { name: "Math" }],
      ["remove", "rooms", 5],
    ]);
  });

  it("reassigns an assignment's teacher by updating the row in place", async () => {
    // Grades, assignments and grade categories cascade off this row's id, so a
    // reassignment must be an UPDATE — a delete-and-recreate would silently
    // take a term's marks with it.
    const calls = [];
    /** @type {any} */
    const gateway = {
      select: async () => [],
      insert: async (table, row) => (calls.push(["insert", table, row]), row),
      update: async (table, id, patch) =>
        calls.push(["update", table, id, patch]),
      remove: async (table, id) => calls.push(["remove", table, id]),
    };
    await createAdminData(gateway).updateAssignment(12, { teacher_id: 7 });
    expect(calls).toEqual([
      ["update", "class_subject_teachers", 12, { teacher_id: 7 }],
    ]);
  });

  it("keeps an assignment reassignment inside the demo overlay", async () => {
    const real = fakeRealGateway({
      class_subject_teachers: [
        {
          id: 12,
          class_id: 1,
          subject_id: 2,
          teacher_id: 3,
          school_year_id: 1,
        },
      ],
    });
    const data = createAdminData(createDemoGateway(real));
    await data.updateAssignment(12, { teacher_id: 7 });

    expect(real.writes).toEqual([]); // never reached the real backend
    const rows = await data.listAssignments(1);
    expect(rows.find((r) => r.id === 12).teacher_id).toBe(7);
  });

  it("reads the overview's attendance figures through narrow queries", async () => {
    const calls = [];
    /** @type {any} */
    const gateway = {
      select: async (table, opts) => (calls.push(["select", table, opts]), []),
      count: async (table, opts) => (calls.push(["count", table, opts]), 0),
    };
    const data = createAdminData(gateway);
    await data.countStudents("active");
    await data.countAttendance("2026-03-01", "2026-03-31", ["present", "late"]);
    await data.listMissedLessons("2026-02-01", "2026-12-15");
    expect(calls).toEqual([
      ["count", "students", { match: { status: "active" } }],
      [
        "count",
        "attendance",
        {
          between: { column: "date", from: "2026-03-01", to: "2026-03-31" },
          inList: { column: "status", values: ["present", "late"] },
        },
      ],
      [
        "select",
        "attendance",
        {
          columns: "id, student_id, class_subject_teacher_id, status, date",
          inList: { column: "status", values: ["absent", "late"] },
          between: { column: "date", from: "2026-02-01", to: "2026-12-15" },
        },
      ],
    ]);
  });
});
