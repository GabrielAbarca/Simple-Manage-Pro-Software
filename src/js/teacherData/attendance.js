// ── Attendance + absence summary (item 3) ────────────────────────
import { supabase } from "../supabaseClient.js";

export async function fetchAttendanceSheet(classId, date) {
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
      .eq("class_id", classId)
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

export async function upsertAttendance(classId, date, rows, recordedBy) {
  const payload = rows.map((r) => ({
    student_id: r.id,
    class_id: classId,
    date,
    status: r.status,
    notes: r.notes || null,
    recorded_by: recordedBy ?? null,
  }));
  const { error } = await supabase
    .from("attendance")
    .upsert(payload, { onConflict: "student_id,class_id,date" });
  if (error) throw error;
}

// ── Absence summary (item 3) ────────────────────────────────
// Raw status rows for a section; aggregated client-side into per-student counts.
export async function fetchClassAttendance(classId) {
  const { data, error } = await supabase
    .from("attendance")
    .select("student_id, status")
    .eq("class_id", classId);
  if (error) throw error;
  return data;
}
