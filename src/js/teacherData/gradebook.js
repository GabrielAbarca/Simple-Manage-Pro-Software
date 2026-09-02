// ── Assignments, scores, posted grades, and column entry (gradebook) ──
import { supabase } from "../supabaseClient.js";

// ── Assignments (gradebook) ─────────────────────────────────
export async function fetchAssignments(cstId, periodId) {
  const { data, error } = await supabase
    .from("assignments")
    .select("id, name, due_date, max_score, note, created_at, category_id")
    .eq("class_subject_teacher_id", cstId)
    .eq("grading_period_id", periodId)
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data;
}

export async function insertAssignment(payload) {
  const { error } = await supabase.from("assignments").insert(payload);
  if (error) throw error;
}

export async function updateAssignment(id, payload) {
  const { error } = await supabase
    .from("assignments")
    .update({ ...payload, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function deleteAssignment(id) {
  // assignment_grades.assignment_id is ON DELETE CASCADE — scores go with it.
  const { error } = await supabase.from("assignments").delete().eq("id", id);
  if (error) throw error;
}

// Full grade records for one student — powers the per-student grade modal.
export async function fetchStudentAssignmentGrades(assignmentIds, studentId) {
  if (!assignmentIds.length) return [];
  const { data, error } = await supabase
    .from("assignment_grades")
    .select("assignment_id, score, note, graded_at, created_at")
    .in("assignment_id", assignmentIds)
    .eq("student_id", studentId);
  if (error) throw error;
  return data;
}

// Rows are passed through verbatim — caller owns score/note/graded_at so it
// can null graded_at when a score is cleared. created_at is never sent, so the
// DB default fills it on insert and the existing value survives on update.
export async function upsertAssignmentGrades(rows) {
  const { error } = await supabase
    .from("assignment_grades")
    .upsert(rows, { onConflict: "assignment_id,student_id" });
  if (error) throw error;
}

// Computed overall grade per student — read from the view, never recompute.
export async function fetchPeriodGrades(cstId, periodId) {
  const { data, error } = await supabase
    .from("student_period_grades")
    .select("student_id, period_score, graded_count, total_assignments")
    .eq("class_subject_teacher_id", cstId)
    .eq("grading_period_id", periodId)
    .not("student_id", "is", null);
  if (error) throw error;
  return data;
}

// Every period's score for a section in one shot — powers the roster's
// per-period columns + weighted Overall (pivoted client-side by period_order).
export async function fetchAllPeriodGrades(cstId) {
  const { data, error } = await supabase
    .from("student_period_grades")
    .select("student_id, grading_period_id, period_score")
    .eq("class_subject_teacher_id", cstId)
    .not("student_id", "is", null);
  if (error) throw error;
  return data;
}

// ── Post grades (item 1) ────────────────────────────────────
// The grades already posted to the report card for this section + period, so
// the posting panel can show what's live and pre-fill overrides/comments.
export async function fetchPostedGrades(cstId, periodId) {
  const { data, error } = await supabase
    .from("student_grades")
    .select("student_id, score, notes, submitted_at")
    .eq("class_subject_teacher_id", cstId)
    .eq("grading_period_id", periodId);
  if (error) throw error;
  return data;
}

// Commit final period grades to the official student_grades record the student
// portal reads. Upsert on the unique (student, cst, period) key.
export async function upsertStudentGrades(rows) {
  const { error } = await supabase.from("student_grades").upsert(rows, {
    onConflict: "student_id,class_subject_teacher_id,grading_period_id",
  });
  if (error) throw error;
}

// ── Column grade entry (item 4) ─────────────────────────────
// Every student's score for ONE assignment, for the whole-class entry grid.
export async function fetchAssignmentColumn(assignmentId) {
  const { data, error } = await supabase
    .from("assignment_grades")
    .select("student_id, score, note, graded_at")
    .eq("assignment_id", assignmentId);
  if (error) throw error;
  return data;
}
