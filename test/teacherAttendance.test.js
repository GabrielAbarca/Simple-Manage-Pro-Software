import { describe, it, expect, beforeEach, vi } from "vitest";

// Chainable Supabase mock covering the shapes teacherData/attendance.js uses:
// from(table).select().eq().order() (thenable) and from(table).upsert(rows, opts).
// `upserts` records every write so a test can assert the exact onConflict target
// — the one thing that distinguishes a working save from a Postgres 42P10.
const { fixtures, calls, upserts, errors } = vi.hoisted(() => ({
  fixtures: /** @type {Record<string, any[]>} */ ({}),
  calls: /** @type {Array<{ table: string, filters: any[] }>} */ ([]),
  upserts: /** @type {Array<{ table: string, rows: any[], opts: any }>} */ ([]),
  errors: /** @type {Record<string, {message: string} | undefined>} */ ({}),
}));

vi.mock("../src/js/supabaseClient.js", () => {
  function make(table) {
    const filters = [];
    let range = null;
    let counted = false;
    const resolve = () => {
      if (errors[table]) {
        calls.push({ table, filters: [...filters] });
        return Promise.resolve({ data: null, error: errors[table] });
      }
      const rows = (fixtures[table] ?? []).filter((row) =>
        filters.every(([op, col, val]) =>
          op === "eq" ? String(row[col]) === String(val) : true,
        ),
      );
      calls.push({ table, filters: [...filters], range });
      return Promise.resolve({
        data: range ? rows.slice(range[0], range[1] + 1) : rows,
        count: counted ? rows.length : null,
        error: null,
      });
    };
    const b = {
      select: (_cols, opts) => ((counted = opts?.count === "exact"), b),
      range: (from, to) => ((range = [from, to]), b),
      order: () => b,
      eq: (col, val) => (filters.push(["eq", col, val]), b),
      upsert: (rows, opts) => {
        upserts.push({ table, rows, opts });
        return Promise.resolve({ error: errors[table] ?? null });
      },
      then: (onF, onR) => resolve().then(onF, onR),
    };
    return b;
  }
  return { supabase: { from: (table) => make(table) } };
});

const { fetchAttendanceSheet, upsertAttendance, fetchCstAttendance } =
  await import("../src/js/teacherData/attendance.js");

beforeEach(() => {
  for (const k of Object.keys(fixtures)) delete fixtures[k];
  for (const k of Object.keys(errors)) delete errors[k];
  calls.length = 0;
  upserts.length = 0;
  fixtures.students = [
    {
      id: 101,
      first_name: "Ana",
      last_name: "García",
      class_id: 21,
      status: "active",
    },
    {
      id: 102,
      first_name: "Luis",
      last_name: "Martínez",
      class_id: 21,
      status: "active",
    },
  ];
  fixtures.attendance = [
    {
      student_id: 101,
      class_subject_teacher_id: 11,
      date: "2026-09-07",
      status: "absent",
      notes: "",
    },
    {
      student_id: 101,
      class_subject_teacher_id: 12,
      date: "2026-09-07",
      status: "present",
      notes: "",
    },
  ];
});

describe("upsertAttendance — the per-subject write path", () => {
  it("upserts on the constraint the schema actually has", async () => {
    await upsertAttendance(
      21,
      11,
      "2026-09-07",
      [{ id: 101, status: "absent" }],
      7,
    );
    // Exact string: the shipped bug was onConflict "student_id,class_id,date",
    // a constraint incremental_attendance_by_subject.sql drops. PostgREST
    // forwards it verbatim and Postgres answers 42P10.
    expect(upserts[0].opts).toEqual({
      onConflict: "student_id,class_subject_teacher_id,date",
    });
  });

  it("stamps every row with the subject and the section", async () => {
    await upsertAttendance(
      21,
      11,
      "2026-09-07",
      [
        { id: 101, status: "absent", notes: "sick" },
        { id: 102, status: "present" },
      ],
      7,
    );
    expect(upserts[0].rows).toEqual([
      {
        student_id: 101,
        class_id: 21,
        class_subject_teacher_id: 11,
        date: "2026-09-07",
        status: "absent",
        notes: "sick",
        recorded_by: 7,
      },
      {
        student_id: 102,
        class_id: 21,
        class_subject_teacher_id: 11,
        date: "2026-09-07",
        status: "present",
        notes: null,
        recorded_by: 7,
      },
    ]);
  });

  it("refuses a null subject instead of writing an unattributable row", async () => {
    // NULLs are distinct in a unique index, so this would insert a new row on
    // every save rather than upserting — silent, unbounded duplication.
    await expect(
      upsertAttendance(
        21,
        null,
        "2026-09-07",
        [{ id: 101, status: "absent" }],
        7,
      ),
    ).rejects.toThrow(/class_subject_teacher_id/);
    expect(upserts).toHaveLength(0);
  });

  it("propagates a write error", async () => {
    errors.attendance = { message: "denied" };
    await expect(
      upsertAttendance(
        21,
        11,
        "2026-09-07",
        [{ id: 101, status: "absent" }],
        7,
      ),
    ).rejects.toMatchObject({ message: "denied" });
  });
});

describe("fetchAttendanceSheet — scoped to one subject", () => {
  it("filters records by subject and date, never by class", async () => {
    await fetchAttendanceSheet(21, 11, "2026-09-07");
    const records = calls.find((c) => c.table === "attendance");
    const cols = records.filters.map(([, col]) => col);
    // The filter set is exactly the unique key minus student_id, so at most one
    // row per student can come back and keying by student_id is safe. A class_id
    // filter here would let a second subject's row overwrite the first.
    expect(cols).toEqual(["class_subject_teacher_id", "date"]);
    expect(cols).not.toContain("class_id");
  });

  it("returns the roster with only this subject's statuses attached", async () => {
    const sheet = await fetchAttendanceSheet(21, 11, "2026-09-07");
    expect(sheet).toEqual([
      {
        id: 101,
        first_name: "Ana",
        last_name: "García",
        class_id: 21,
        status: "absent",
        notes: "",
      },
      {
        id: 102,
        first_name: "Luis",
        last_name: "Martínez",
        class_id: 21,
        status: null,
        notes: "",
      },
    ]);
  });

  it("shows the other subject's status when opened as that subject", async () => {
    const sheet = await fetchAttendanceSheet(21, 12, "2026-09-07");
    expect(sheet.find((s) => s.id === 101).status).toBe("present");
  });

  it("leaves the roster query scoped to the section", async () => {
    await fetchAttendanceSheet(21, 11, "2026-09-07");
    const roster = calls.find((c) => c.table === "students");
    expect(roster.filters.map(([, col]) => col)).toEqual([
      "class_id",
      "status",
    ]);
  });
});

describe("fetchCstAttendance — the absence summary", () => {
  it("counts one subject's register, not the whole section's", async () => {
    await fetchCstAttendance(11);
    const q = calls.find((c) => c.table === "attendance");
    expect(q.filters).toEqual([["eq", "class_subject_teacher_id", 11]]);
  });

  it("reads a year's register past the API's 1000-row cap, a page at a time", async () => {
    fixtures.attendance = Array.from({ length: 2345 }, (_, i) => ({
      id: i + 1,
      student_id: 101,
      class_subject_teacher_id: 11,
      date: "2026-03-02",
      status: "present",
    }));
    const rows = await fetchCstAttendance(11);
    expect(rows).toHaveLength(2345);
    expect(
      calls.filter((c) => c.table === "attendance").map((c) => c.range),
    ).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });
});
