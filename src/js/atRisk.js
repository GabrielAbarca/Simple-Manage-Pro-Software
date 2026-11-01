/** Missed lessons in one subject at which a student is flagged. */
export const AT_RISK_MISSED_LESSONS = 5;

/** The attendance statuses that count as a missed lesson. */
export const MISSED_LESSON_STATUSES = ["absent", "late"];

/**
 * @param {string | null | undefined} status an attendance status
 * @returns {boolean}
 */
export function isMissedLesson(status) {
  return MISSED_LESSON_STATUSES.includes(String(status));
}

/**
 * Students with at least `threshold` missed lessons in any one subject.
 *
 * @param {Array<{ student_id: number, class_subject_teacher_id: number | null, status?: string | null }>} rows
 *   attendance rows across any number of students and subjects
 * @param {number} [threshold]
 * @returns {Set<number>} the flagged student ids
 */
export function atRiskStudentIds(rows, threshold = AT_RISK_MISSED_LESSONS) {
  /** @type {Map<string, number>} */
  const missed = new Map();
  /** @type {Set<number>} */
  const flagged = new Set();
  for (const row of rows ?? []) {
    if (!isMissedLesson(row?.status)) continue;
    if (row.class_subject_teacher_id == null) continue;
    const key = `${row.student_id}:${row.class_subject_teacher_id}`;
    const n = (missed.get(key) ?? 0) + 1;
    missed.set(key, n);
    if (n >= threshold) flagged.add(row.student_id);
  }
  return flagged;
}
