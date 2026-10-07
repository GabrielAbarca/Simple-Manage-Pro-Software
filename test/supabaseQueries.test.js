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
      order: (col, opts) => (filters.push(["order", col, opts]), b),
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
  fetchOwnConduct,
  fetchStudentGrades,
  fetchStudentProfile,
  fetchEvents,
  fetchTeachers,
} = await import("../src/js/supabaseQueries.js");

function seed() {
  for (const k of Object.keys(fixtures)) delete fixtures[k];
  for (const k of Object.keys(errors)) delete errors[k];
  calls.length = 0;
  // Rows 1 and 2 are the same DAY under two different subjects — the shape the
  // per-subject constraint now allows and the old (student_id, date) unique
  // made impossible. Row 4 predates the migration and carries no subject.
  fixtures.attendance = [
    {
      id: 1,
      student_id: 101,
      date: "2026-09-07",
      status: "present",
      recorded_by: 7,
      classes: { id: 21, display_name: "7A" },
      class_subject_teachers: {
        id: 11,
        subjects: { id: 31, name: "Mathematics", code: "MATH7" },
      },
    },
    {
      id: 2,
      student_id: 101,
      date: "2026-09-07",
      status: "late",
      recorded_by: 8,
      classes: { id: 21, display_name: "7A" },
      class_subject_teachers: {
        id: 12,
        subjects: { id: 32, name: "Spanish", code: "ESP7" },
      },
    },
    {
      id: 3,
      student_id: 101,
      date: "2026-09-04",
      status: "absent",
      recorded_by: 7,
      classes: { id: 21, display_name: "7A" },
      class_subject_teachers: {
        id: 11,
        subjects: { id: 31, name: "Mathematics", code: "MATH7" },
      },
    },
    {
      id: 4,
      student_id: 101,
      date: "2026-09-03",
      status: "absent",
      recorded_by: 7,
      classes: { id: 21, display_name: "7A" },
      class_subject_teachers: null,
    },
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

  it("keeps both subjects' records for one day instead of collapsing them", async () => {
    const rows = await fetchStudentAttendance(101);
    const sameDay = rows.filter((r) => r.date === "2026-09-07");
    expect(sameDay).toHaveLength(2);
    expect(
      sameDay.map((r) => r.class_subject_teachers.subjects.name).sort(),
    ).toEqual(["Mathematics", "Spanish"]);
  });

  it("leaves a pre-migration row without a subject, for the view to fall back on", async () => {
    const rows = await fetchStudentAttendance(101);
    const legacy = rows.find((r) => r.id === 4);
    expect(legacy.class_subject_teachers).toBeNull();
    // The section name is the only label such a row can carry.
    expect(legacy.classes.display_name).toBe("7A");
  });
});

describe("fetchDashboardStats aggregation", () => {
  it("computes attendance %, grade average and a next class", async () => {
    const stats = await fetchDashboardStats(101, 21);

    // present + late = 2 of 4 → 50%. The denominator counts attendance ROWS,
    // which are now subject-periods rather than days — MEP counts ausencias
    // por leccion, so this is the intended unit. Pinned so a change is
    // deliberate rather than accidental.
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

describe("fetchOwnConduct", () => {
  beforeEach(() => {
    fixtures.student_period_conduct = [
      { student_id: 101, grading_period_id: 1, conduct_score: 90 },
      { student_id: 102, grading_period_id: 1, conduct_score: 60 },
    ];
    fixtures.student_conduct_grades = [
      { student_id: 101, grading_period_id: 1, score: 88 },
    ];
    fixtures.discipline_records = [
      { id: 5, student_id: 101, type: "Tardanza", conduct_points: 10 },
      { id: 6, student_id: 102, type: "Agresión", conduct_points: 40 },
    ];
  });

  it("returns only the student's own live scores, posted marks and records", async () => {
    const conduct = await fetchOwnConduct(101);
    expect(conduct.live.map((r) => r.conduct_score)).toEqual([90]);
    expect(conduct.posted.map((r) => r.score)).toEqual([88]);
    expect(conduct.records.map((r) => r.id)).toEqual([5]);
    expect(calls.map((c) => c.table).sort()).toEqual([
      "discipline_records",
      "student_conduct_grades",
      "student_period_conduct",
    ]);
    expect(
      calls.find((c) => c.table === "discipline_records").filters,
    ).toContainEqual(["order", "date", { ascending: false }]);
  });

  it("rejects when any one of its reads fails", async () => {
    errors.student_conduct_grades = { message: "boom" };
    await expect(fetchOwnConduct(101)).rejects.toMatchObject({
      message: "boom",
    });
  });
});
