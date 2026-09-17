// ── Attendance + absence summary (item 3) ────────────────────────
//
// Attendance is per SUBJECT, not per day: `attendance` is unique on
// (student_id, class_subject_teacher_id, date), so two teachers sharing a
// section each keep their own register for the same day. Every function here
// is therefore scoped by the class-subject-teacher id (`cstId`), not by class.
import { supabase } from "../supabaseClient.js";

/**
 * The day's sheet for one class-subject: every active student in the section,
 * carrying their record for that subject and date if one exists.
 *
 * The roster comes from the section (`classId`); the records come from the
 * subject (`cstId`). The record filter is exactly the unique key minus
 * `student_id`, so at most one row per student can come back and keying the
 * lookup by `student_id` is safe by construction.
 *
 * @param {number} classId
 * @param {number} cstId class_subject_teachers.id — the subject's register
 * @param {string} date YYYY-MM-DD
 * @returns {Promise<Array<{ id: number, first_name: string, last_name: string,
 *   status: string | null, notes: string }>>}
 */
export async function fetchAttendanceSheet(classId, cstId, date) {
  const [studentsRes, recordsRes] = await Promise.all([
    supabase
      .from("students")
      .select("id, first_name, last_name")
      .eq("class_id", classId)
      .eq("status", "active")
      .order("last_name"),
    supabase
      .from("attendance")
      .select("student_id, status, notes")
      .eq("class_subject_teacher_id", cstId)
      .eq("date", date),
  ]);
  if (studentsRes.error) throw studentsRes.error;
  if (recordsRes.error) throw recordsRes.error;

  const recordMap = Object.fromEntries(
    (recordsRes.data ?? []).map((r) => [r.student_id, r]),
  );
  // No default status — an unsaved sheet shows every status button inactive.
  // A saved record keeps its real status so loaded attendance renders highlighted.
  return (studentsRes.data ?? []).map((s) => ({
    ...s,
    status: recordMap[s.id]?.status ?? null,
    notes: recordMap[s.id]?.notes ?? "",
  }));
}

/**
 * Save the day's register for one class-subject.
 *
 * @param {number} classId
 * @param {number} cstId class_subject_teachers.id
 * @param {string} date YYYY-MM-DD
 * @param {Array<{ id: number, status: string, notes?: string | null }>} rows
 * @param {number | null} [recordedBy] teachers.id of whoever took the register
 */
export async function upsertAttendance(classId, cstId, date, rows, recordedBy) {
  // A null cstId does not upsert: the unique index treats NULLs as distinct, so
  // every save would insert another unattributable row instead of replacing the
  // previous one. Fail loudly rather than silently duplicating the register.
  if (cstId == null) {
    throw new Error("upsertAttendance: missing class_subject_teacher_id");
  }
  const payload = rows.map((r) => ({
    student_id: r.id,
    class_id: classId,
    class_subject_teacher_id: cstId,
    date,
    status: r.status,
    notes: r.notes || null,
    recorded_by: recordedBy ?? null,
  }));
  const { error } = await supabase.from("attendance").upsert(payload, {
    onConflict: "student_id,class_subject_teacher_id,date",
  });
  if (error) throw error;
}

// ── Absence summary (item 3) ────────────────────────────────
/**
 * Raw status rows for one class-subject; aggregated client-side into
 * per-student counts. Scoped to the subject, so a student absent all day
 * counts once here rather than once per subject they take.
 * @param {number} cstId class_subject_teachers.id
 * @returns {Promise<Array<{ student_id: number, status: string }>>}
 */
export async function fetchCstAttendance(cstId) {
  const { data, error } = await supabase
    .from("attendance")
    .select("student_id, status, date")
    .eq("class_subject_teacher_id", cstId);
  if (error) throw error;
  return data;
}
