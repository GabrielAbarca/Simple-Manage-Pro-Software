import { describe, it, expect } from "vitest";

// The interface defaults to Spanish, so the headers are checked in Spanish.
import {
  gradebookRows,
  attendanceSummaryRows,
  attendanceLogRows,
} from "../src/js/classExportRows.js";

const roster = [
  { id: 2, first_name: "Luis", last_name: "Martínez", status: "active" },
  { id: 1, first_name: "Ana", last_name: "García", status: "active" },
  { id: 3, first_name: "Eva", last_name: "Ávila", status: "inactive" },
];

describe("gradebookRows", () => {
  it("lists each student's scores, period score, graded count and posted grade", () => {
    const rows = gradebookRows({
      assignments: [
        { id: 10, name: "Quiz 1", max_score: 20 },
        { id: 11, name: "Proyecto", max_score: null },
      ],
      students: roster.slice(0, 2),
      columns: [
        [
          { student_id: 1, score: 18 },
          { student_id: 2, score: "15.5" },
        ],
        [{ student_id: 1, score: null }],
      ],
      periodGrades: [{ student_id: 1, period_score: 87.456, graded_count: 1 }],
      posted: [{ student_id: 1, score: 88 }],
    });
    expect(rows).toEqual([
      [
        "Apellidos",
        "Nombre",
        "Quiz 1 (sobre 20)",
        "Proyecto",
        "Nota del periodo",
        "Calificadas",
        "Nota publicada",
      ],
      ["García", "Ana", 18, null, 87.46, 1, 88],
      ["Martínez", "Luis", 15.5, null, null, 0, null],
    ]);
  });

  it("still has a header row when there are no students", () => {
    const rows = gradebookRows({
      assignments: [],
      students: [],
      columns: [],
      periodGrades: [],
      posted: [],
    });
    expect(rows).toHaveLength(1);
  });
});

describe("attendanceSummaryRows", () => {
  it("counts each status per student, with missed lessons as absences plus tardías", () => {
    const rows = attendanceSummaryRows(
      [
        { student_id: 1, status: "present" },
        { student_id: 1, status: "absent" },
        { student_id: 1, status: "late" },
        { student_id: 1, status: "excused" },
        { student_id: 3, status: "absent" },
        { student_id: 99, status: "late" },
      ],
      roster,
    );
    expect(rows).toEqual([
      [
        "Apellidos",
        "Nombre",
        "Presente",
        "Ausente",
        "Tardía",
        "Justificada",
        "Ausencias + tardías",
      ],
      // Ávila is inactive but has a record, so she stays in the file.
      ["Ávila", "Eva", 0, 1, 0, 0, 1],
      ["García", "Ana", 1, 1, 1, 1, 2],
      ["Martínez", "Luis", 0, 0, 0, 0, 0],
      // Moved to another section, but the on-screen summary counts them.
      ["Estudiante 99", null, 0, 0, 1, 0, 1],
    ]);
  });

  it("leaves out an inactive student with no records", () => {
    const rows = attendanceSummaryRows([], roster);
    expect(rows.map((r) => r[0])).toEqual(["Apellidos", "García", "Martínez"]);
  });
});

describe("attendanceLogRows", () => {
  it("lists every record by date and then by student, with real dates", () => {
    const rows = attendanceLogRows(
      [
        { student_id: 2, status: "late", date: "2026-03-02" },
        { student_id: 1, status: "absent", date: "2026-03-02" },
        { student_id: 1, status: "present", date: "2026-02-27" },
        { student_id: 99, status: "excused", date: "2026-03-01" },
      ],
      roster,
    );
    expect(rows[0]).toEqual(["Fecha", "Apellidos", "Nombre", "Estado"]);
    expect(
      rows
        .slice(1)
        .map((r) => [
          /** @type {Date} */ (r[0]).toISOString().slice(0, 10),
          ...r.slice(1),
        ]),
    ).toEqual([
      ["2026-02-27", "García", "Ana", "Presente"],
      ["2026-03-01", "Estudiante 99", null, "Justificada"],
      ["2026-03-02", "García", "Ana", "Ausente"],
      ["2026-03-02", "Martínez", "Luis", "Tardía"],
    ]);
  });
});
