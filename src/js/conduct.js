// ─────────────────────────────────────────────────────────────────
//  conduct.js — conducta as a grade, in one place.
//
//  REAC 2026 grades conducta as a mark in its own right, with the same
//  70 floor as an academic subject in secondary. A student below it is
//  aplazado por conducta.
//
//  Every student starts the period at 100 and a teacher deducts points
//  on each discipline record, naming the reason. There is no severity
//  scale and no school-wide weighting: the points a teacher enters ARE
//  the deduction, so every point of a conducta grade traces back to one
//  named, described record. `severity` is kept on the record for the
//  register and deliberately has no effect here, as do `resolved` and
//  `resolution`, which survive in the table but no longer surface.
//
//  Pure on purpose: the SQL view public.student_period_conduct computes
//  the identical number server-side, and demoDb.js mirrors it through
//  this module. Keep all three in step — a divergence here is a grade
//  that changes depending on whether the demo overlay is in play.
// ─────────────────────────────────────────────────────────────────

/** A clean record. Conducta counts down from here, never up. */
export const CONDUCT_MAX = 100;

/**
 * Points a single record takes off. Anything that is not a usable
 * positive number takes off nothing — every row predating the
 * conduct_points column carries the 0 default, and a record filed
 * purely for the register is allowed to cost nothing.
 * @param {{ conduct_points?: unknown }} record
 * @returns {number}
 */
function pointsOf(record) {
  const n = Number(record?.conduct_points);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** numeric(5,2) everywhere in the schema, so two decimals everywhere here. */
function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Conducta for one student over one period's worth of discipline records.
 *
 * Returns 100 — never null — for a student with nothing on file. The
 * contrast with attendanceRate, which returns null when no day counted,
 * is deliberate: an empty attendance record means the grade is not yet
 * knowable, while an empty discipline record IS the answer. Every
 * student carries a conducta mark from the first day of the curso
 * lectivo, and a clean one is a perfect one.
 *
 * @param {Array<{ conduct_points?: unknown }>} records discipline records,
 *   already scoped to one student and one grading period
 * @returns {number} 0–100, rounded to two decimals
 */
export function conductScore(records) {
  return round2(Math.max(CONDUCT_MAX - conductDeduction(records), 0));
}

/**
 * Points deducted across a period's records — the same total the view emits
 * as `deduction`. Kept beside conductScore so the two can never disagree,
 * and separate from it because the total may exceed 100 while the grade
 * floors at 0.
 * @param {Array<{ conduct_points?: unknown }>} records
 * @returns {number} 0 or more, rounded to two decimals
 */
export function conductDeduction(records) {
  let total = 0;
  for (const record of records ?? []) total += pointsOf(record);
  return round2(total);
}

/**
 * Where a conducta lands once a further deduction is applied — what the
 * incident form shows the teacher before they save.
 * @param {unknown} current the student's conducta before this record
 * @param {unknown} points the deduction being entered
 * @returns {number} 0–100, rounded to two decimals
 */
export function conductAfter(current, points) {
  // Number(null) and Number("") are both 0, so an unknown grade has to be
  // caught before the cast or a blank field would read as a conducta of 0.
  const blank = (v) => v === null || v === undefined || v === "";
  const from = blank(current) ? NaN : Number(current);
  const base = Number.isFinite(from) ? from : CONDUCT_MAX;
  const off = blank(points) ? NaN : Number(points);
  const taken = Number.isFinite(off) && off > 0 ? off : 0;
  return round2(Math.max(base - taken, 0));
}

/**
 * @param {any[]} records
 * @returns {Map<number, any[]>} student id → that student's records
 */
export function groupRecordsByStudent(records) {
  const byStudent = new Map();
  for (const record of records ?? []) {
    const own = byStudent.get(record.student_id);
    if (own) own.push(record);
    else byStudent.set(record.student_id, [record]);
  }
  return byStudent;
}
