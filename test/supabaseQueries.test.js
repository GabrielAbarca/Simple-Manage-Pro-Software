import { describe, it, expect, beforeEach, vi } from "vitest";

// Chainable Supabase mock: from(table).select().eq().in().order().{maybeSingle,
// single} — all thenable — resolving fixture rows with eq/in filters applied.
// `calls` records every resolved query so tests can assert query shape (e.g.
// the N+1 fix issuing a single teachers?id=in.(…) batch).
// `errors[table]` makes that table's next query fail, the way a dropped
// connection or an RLS denial would.
const { fixtures, calls, errors } = vi.hoisted(() => ({
  fixtures: /** @type {Record<string, any[]>} */ ({}),
  calls: /** @type {Array<{ table: string, filters: any[] }>} */ ([]),
  errors: /** @type {Record<string, {message: string} | undefined>} */ ({}),
}));

vi.mock("../src/js/supabaseClient.js", () => {
  function make(table) {
    const filters = [];
    const resolve = (single) => {
      if (errors[table]) {
        calls.push({ table, filters: [...filters] });
        return Promise.resolve({ data: null, error: errors[table] });
      }
      const rows = (fixtures[table] ?? []).filter((row) =>
        filters.every(([op, col, val]) =>
          op === "eq"
            ? String(row[col]) === String(val)
            : op === "in"
              ? val.map(String).includes(String(row[col]))
              : true,
        ),
      );
      calls.push({ table, filters: [...filters] });
      return Promise.resolve({
        data: single ? (rows[0] ?? null) : rows,
        error: null,
      });
    };
    const b = {
      select: () => b,
      order: () => b,
      eq: (col, val) => (filters.push(["eq", col, val]), b),
      in: (col, val) => (filters.push(["in", col, val]), b),
      maybeSingle: () => resolve(true),
      single: () => resolve(true),
      then: (onF, onR) => resolve(false).then(onF, onR),
    };
    return b;
  }
  return { supabase: { from: (table) => make(table) } };
});

const {
  fetchDashboardStats,
  fetchStudentAttendance,
  fetchStudentGrades,
  fetchStudentProfile,
  fetchEvents,
  fetchTeachers,
} = await import("../src/js/supabaseQueries.js");

function seed() {
  for (const k of Object.keys(fixtures)) delete fixtures[k];
  for (const k of Object.keys(errors)) delete errors[k];
  calls.length = 0;
  fixtures.attendance = [
    { id: 1, student_id: 101, status: "present", recorded_by: 7 },
    { id: 2, student_id: 101, status: "late", recorded_by: 8 },
    { id: 3, student_id: 101, status: "absent", recorded_by: 7 },
    { id: 4, student_id: 101, status: "absent", recorded_by: 7 },
  ];
  fixtures.teachers_directory = [
    { id: 7, first_name: "Sofía", last_name: "Ramírez" },
    { id: 8, first_name: "Marco", last_name: "López" },
  ];
  fixtures.student_grades = [
    { id: 10, student_id: 101, score: 90 },
    { id: 11, student_id: 101, score: 80 },
    { id: 12, student_id: 101, score: null }, // nulls excluded from the average
  ];
  // A class on every weekday so "next class" is deterministic regardless of the
  // day/time the test runs.
  fixtures.schedules = [1, 2, 3, 4, 5].map((day) => ({
    id: 300 + day,
    class_id: 21,
    day_of_week: day,
    start_time: "08:00",
    end_time: "09:00",
    subjects: { id: 31, name: "Mathematics" },
  }));
}

beforeEach(seed);

describe("fetchStudentAttendance (N+1 fix)", () => {
  it("resolves all recorders in a single batched teachers?id=in.(…) query", async () => {
    const rows = await fetchStudentAttendance(101);
    const teacherCalls = calls.filter((c) => c.table === "teachers_directory");
    expect(teacherCalls).toHaveLength(1);
    expect(teacherCalls[0].filters).toEqual([["in", "id", [7, 8]]]);
    // Each row carries its resolved recorder on `.teacher` (singular).
    expect(rows.find((r) => r.id === 1).teacher.last_name).toBe("Ramírez");
    expect(rows.find((r) => r.id === 2).teacher.last_name).toBe("López");
  });
});

describe("fetchDashboardStats aggregation", () => {
  it("computes attendance %, grade average and a next class", async () => {
    const stats = await fetchDashboardStats(101, 21);

    // present + late = 2 of 4 → 50%
    expect(stats.attendance).toEqual({ present: 2, total: 4, percentage: 50 });
    // (90 + 80) / 2 = 85, null excluded
    expect(stats.grades).toEqual({ average: 85, count: 2 });
    expect(stats.nextClass?.subjects?.name).toBe("Mathematics");
  });

  it("runs its three reads concurrently (attendance, grades, schedule)", async () => {
    await fetchDashboardStats(101, 21);
    const tables = calls.map((c) => c.table);
    expect(tables).toContain("attendance");
    expect(tables).toContain("student_grades");
    expect(tables).toContain("schedules");
  });
});

// A failed query used to return [] — indistinguishable from "no grades yet",
// so a network drop rendered as an empty state. These pin the distinction:
// a failure propagates, and only a genuinely absent row returns empty.
describe("failures propagate instead of looking like empty data", () => {
  it("fetchStudentGrades rejects when the query fails", async () => {
    errors.student_grades = { message: "network down" };
    await expect(fetchStudentGrades(101)).rejects.toMatchObject({
      message: "network down",
    });
  });

  it("fetchEvents rejects when the query fails", async () => {
    errors.events = { message: "boom" };
    await expect(fetchEvents()).rejects.toMatchObject({ message: "boom" });
  });

  it("fetchStudentAttendance rejects when the query fails", async () => {
    errors.attendance = { message: "boom" };
    await expect(fetchStudentAttendance(101)).rejects.toMatchObject({
      message: "boom",
    });
  });

  it("fetchDashboardStats rejects when any one of its reads fails", async () => {
    errors.student_grades = { message: "boom" };
    await expect(fetchDashboardStats(101, 21)).rejects.toMatchObject({
      message: "boom",
    });
  });

  it("fetchStudentProfile rejects on failure", async () => {
    errors.students = { message: "boom" };
    await expect(fetchStudentProfile(101)).rejects.toMatchObject({
      message: "boom",
    });
  });

  it("fetchStudentProfile still returns null when the student simply is not there", async () => {
    // No error, no row — a real answer, not a failure.
    fixtures.students = [];
    await expect(fetchStudentProfile(999)).resolves.toBeNull();
  });

  it("returns data normally when nothing is failing", async () => {
    await expect(fetchStudentGrades(101)).resolves.toHaveLength(3);
  });
});

// The student portal's Teachers tab reads the PII-free `teachers_directory`
// view, never the `teachers` base table — the latter carries national_id,
// phone, address and hire_date, and its RLS is narrowed to admin + self. These
// pin the relation name so a refactor cannot silently repoint it.
describe("fetchTeachers reads the PII-free directory view", () => {
  it("queries teachers_directory, not the teachers base table", async () => {
    await fetchTeachers();
    const tables = calls.map((c) => c.table);
    expect(tables).toContain("teachers_directory");
    expect(tables).not.toContain("teachers");
  });

  it("returns the directory rows", async () => {
    await expect(fetchTeachers()).resolves.toHaveLength(2);
  });

  it("rejects when the query fails instead of rendering an empty list", async () => {
    errors.teachers_directory = { message: "boom" };
    await expect(fetchTeachers()).rejects.toMatchObject({ message: "boom" });
  });
});
