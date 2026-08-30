// ── Roster / students, student 360, and discipline ──────────────
import { supabase } from "../supabaseClient.js";

// ── Roster / students ───────────────────────────────────────
export async function fetchRoster(classId) {
  const { data, error } = await supabase
    .from("students")
    .select(
      "id, first_name, last_name, email, phone, status, enrollment_number, " +
        "national_id, date_of_birth, gender, address, photo_url, enrollment_date",
    )
    .eq("class_id", classId)
    .order("last_name");
  if (error) throw error;
  return data;
}

export async function fetchStudentContacts(studentId) {
  const { data, error } = await supabase
    .from("student_guardians")
    .select(
      `
      is_primary,
      guardians!guardian_id(first_name, last_name, relationship, phone, alt_phone, email)
    `,
    )
    .eq("student_id", studentId);
  if (error) throw error;
  return data;
}

export async function insertStudent(payload) {
  const { error } = await supabase.from("students").insert(payload);
  if (error) throw error;
}

export async function updateStudent(id, payload) {
  const { error } = await supabase
    .from("students")
    .update(payload)
    .eq("id", id);
  if (error) throw error;
}

export async function deleteStudent(id) {
  const { error } = await supabase.from("students").delete().eq("id", id);
  if (error) throw error;
}

// ── Student 360 (read-only) ─────────────────────────────────
export async function fetchStudentAttendance(studentId) {
  const { data, error } = await supabase
    .from("attendance")
    .select("status")
    .eq("student_id", studentId);
  if (error) throw error;
  return data;
}

export async function fetchStudentDiscipline(studentId) {
  const { data, error } = await supabase
    .from("discipline_records")
    .select("id, date, type, severity, resolved, description, resolution")
    .eq("student_id", studentId)
    .order("date", { ascending: false });
  if (error) throw error;
  return data;
}

// ── Discipline (write — item 2) ─────────────────────────────
// Teacher-filed behavior records. reported_by_teacher stamps authorship;
// reported_by_staff stays null (this console is teacher-scoped).
export async function insertDiscipline(payload) {
  const { error } = await supabase.from("discipline_records").insert(payload);
  if (error) throw error;
}

export async function updateDiscipline(id, payload) {
  const { error } = await supabase
    .from("discipline_records")
    .update(payload)
    .eq("id", id);
  if (error) throw error;
}

// Per-subject grades come from student_grades (the full-school record the
// student portal shows), NOT the assignment-derived view. Read-only.
export async function fetchStudentSubjectGrades(studentId, periodId) {
  const { data, error } = await supabase
    .from("student_grades")
    .select(
      "score, class_subject_teachers!class_subject_teacher_id(subjects!subject_id(name, color))",
    )
    .eq("student_id", studentId)
    .eq("grading_period_id", periodId);
  if (error) throw error;
  return data;
}

// Every posted subject grade for a student, all periods — powers the printable
// progress report (item 6). Read-only, the full-school student_grades record.
export async function fetchStudentAllSubjectGrades(studentId) {
  const { data, error } = await supabase
    .from("student_grades")
    .select(
      "score, grading_period_id, notes, class_subject_teachers!class_subject_teacher_id(subjects!subject_id(name))",
    )
    .eq("student_id", studentId);
  if (error) throw error;
  return data;
}
