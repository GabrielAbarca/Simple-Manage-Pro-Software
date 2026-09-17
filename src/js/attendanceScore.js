// ─────────────────────────────────────────────────────────────────
//  attendanceScore.js — attendance as a grade, in one place.
//
//  REAC 2026 makes attendance 5% of every subject's grade. The score
//  follows MEP's long-standing accumulation rule: three tardías count
//  as one ausencia.
//
//  A justified absence ('excused') is left out of the calculation
//  entirely rather than counted as a day attended — it neither helps nor
//  hurts, which is the point of justifying it.
//
//  Pure on purpose: the SQL view public.student_period_grades computes
//  the identical number server-side, and demoDb.js mirrors it through
//  this module. Keep all three in step — a divergence here is a grade
//  that changes depending on whether the demo overlay is in play.
// ─────────────────────────────────────────────────────────────────

/** Tardías that add up to one absence. MEP's traditional rule. */
export const LATES_PER_ABSENCE = 3;

/**
 * Attendance as a percentage, for one student in one subject over one
 * period's worth of rows.
 *
 * Returns null — never 0 — when no day counts. A period before any
 * attendance has been taken must drop out of the weighted score the way
 * an ungraded category does; scoring it 0 would tank every grade in the
 * school on the first day of the curso lectivo.
 *
 * @param {Array<{ status?: string | null }>} rows attendance rows, already
 *   scoped to one student, one class_subject_teacher and one period
 * @returns {number | null} 0–100, or null when nothing counted
 */
export function attendanceRate(rows) {
  let counted = 0;
  let absences = 0;
  let lates = 0;

  for (const row of rows ?? []) {
    switch (row?.status) {
      case "excused":
        continue;
      case "absent":
        absences += 1;
        break;
      case "late":
        lates += 1;
        break;
      case "present":
        break;
      default:
        // An unknown status is not evidence the student was away.
        continue;
    }
    counted += 1;
  }

  if (counted === 0) return null;

  const effectiveAbsences = absences + Math.floor(lates / LATES_PER_ABSENCE);
  const attended = Math.max(counted - effectiveAbsences, 0);
  return (attended / counted) * 100;
}
