// ─────────────────────────────────────────────────────────────────
//  classExportRows.js — the rows behind the class workspace's exports:
//  a period's gradebook and a subject's attendance. Pure, so the sheets
//  can be checked without a browser.
// ─────────────────────────────────────────────────────────────────
import { t } from "./i18n.js";
import { dateCell } from "./tableExport.js";

/** @typedef {{ id: number, first_name: string, last_name: string, status?: string }} RosterStudent */

const ATTENDANCE_STATUSES = ["present", "absent", "late", "excused"];

/**
 * A stored score as a number, or null when there is none.
 * @param {unknown} value
 */
function score(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/** @param {RosterStudent} a @param {RosterStudent} b */
function byName(a, b) {
  return (
    a.last_name.localeCompare(b.last_name, "es") ||
    a.first_name.localeCompare(b.first_name, "es")
  );
}

/**
 * One row per student: each assignment's score, then the period score, how
 * many assignments are graded and the grade posted to the report card.
 *
 * @param {{
 *   assignments: Array<{ id: number, name: string, max_score?: number | null }>,
 *   students: RosterStudent[],
 *   columns: Array<Array<{ student_id: number, score: unknown }>>,
 *   periodGrades: Array<{ student_id: number, period_score: unknown, graded_count?: number | null }>,
 *   posted: Array<{ student_id: number, score: unknown }>,
 * }} data `columns[i]` holds the grades of `assignments[i]`
 * @returns {unknown[][]} the header row first
 */
export function gradebookRows({
  assignments,
  students,
  columns,
  periodGrades,
  posted,
}) {
  const scores = columns.map(
    (column) => new Map(column.map((g) => [g.student_id, score(g.score)])),
  );
  const period = new Map(periodGrades.map((p) => [p.student_id, p]));
  const postedBy = new Map(posted.map((p) => [p.student_id, score(p.score)]));
  const header = [
    t("admin.export.lastName"),
    t("admin.export.firstName"),
    ...assignments.map((a) =>
      a.max_score != null
        ? t("admin.export.outOf", { name: a.name, max: Number(a.max_score) })
        : a.name,
    ),
    t("admin.export.periodScore"),
    t("admin.export.gradedCount"),
    t("admin.export.posted"),
  ];
  const rows = [...students]
    .sort(byName)
    .map((s) => [
      s.last_name,
      s.first_name,
      ...scores.map((byStudent) => byStudent.get(s.id) ?? null),
      score(period.get(s.id)?.period_score),
      period.get(s.id)?.graded_count ?? 0,
      postedBy.get(s.id) ?? null,
    ]);
  return [header, ...rows];
}

/**
 * The students an attendance export covers, in name order: everyone active on
 * the roster, anyone else on it with a record, and then anyone with a record
 * who is no longer on the roster (moved to another section), named by id.
 * @param {RosterStudent[]} roster
 * @param {Array<{ student_id: number }>} records
 * @returns {RosterStudent[]}
 */
function attendanceStudents(roster, records) {
  const recorded = new Set(records.map((r) => r.student_id));
  const onRoster = new Set(roster.map((s) => s.id));
  const gone = [...recorded]
    .filter((id) => !onRoster.has(id))
    .sort((a, b) => a - b)
    .map((id) => ({
      id,
      last_name: t("admin.absence.studentFallback", { id }),
      first_name: null,
    }));
  return [
    ...roster
      .filter((s) => s.status === "active" || recorded.has(s.id))
      .sort(byName),
    ...gone,
  ];
}

/**
 * One row per student with a count of each attendance status, and absences
 * plus tardías together, the figure the absence summary flags.
 * @param {Array<{ student_id: number, status: string }>} records
 * @param {RosterStudent[]} roster
 * @returns {unknown[][]} the header row first
 */
export function attendanceSummaryRows(records, roster) {
  /** @type {Map<number, Record<string, number>>} */
  const counts = new Map();
  for (const r of records) {
    const c = counts.get(r.student_id) ?? {};
    c[r.status] = (c[r.status] ?? 0) + 1;
    counts.set(r.student_id, c);
  }
  const header = [
    t("admin.export.lastName"),
    t("admin.export.firstName"),
    ...ATTENDANCE_STATUSES.map((s) => t(`enums.attendance.${s}`)),
    t("admin.export.absentLate"),
  ];
  const rows = attendanceStudents(roster, records).map((s) => {
    const c = counts.get(s.id) ?? {};
    return [
      s.last_name,
      s.first_name,
      ...ATTENDANCE_STATUSES.map((status) => c[status] ?? 0),
      (c.absent ?? 0) + (c.late ?? 0),
    ];
  });
  return [header, ...rows];
}

/**
 * Every attendance record, by date and then by student.
 * @param {Array<{ student_id: number, status: string, date: string }>} records
 * @param {RosterStudent[]} roster
 * @returns {unknown[][]} the header row first
 */
export function attendanceLogRows(records, roster) {
  const students = attendanceStudents(roster, records);
  const byId = new Map(students.map((s) => [s.id, s]));
  const order = new Map(students.map((s, i) => [s.id, i]));
  const header = [
    t("admin.export.date"),
    t("admin.export.lastName"),
    t("admin.export.firstName"),
    t("admin.export.status"),
  ];
  const rows = [...records]
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        order.get(a.student_id) - order.get(b.student_id),
    )
    .map((r) => {
      const s = byId.get(r.student_id);
      return [
        dateCell(r.date),
        s.last_name,
        s.first_name,
        t(`enums.attendance.${r.status}`),
      ];
    });
  return [header, ...rows];
}
