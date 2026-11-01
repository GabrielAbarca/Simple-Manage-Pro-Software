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
