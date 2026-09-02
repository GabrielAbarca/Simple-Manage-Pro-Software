// ── My Classes ────────────────────────────────────────────────
import { supabase } from "../supabaseClient.js";

export async function fetchMyClasses(teacherId, yearId) {
  const { data, error } = await supabase
    .from("class_subject_teachers")
    .select(
      `
      id, class_id, subject_id,
      classes!class_id(id, display_name, section, grade_levels!grade_level_id(name)),
      subjects!subject_id(id, name, color)
    `,
    )
    .eq("teacher_id", teacherId)
    .eq("school_year_id", yearId)
    .order("class_id");
  if (error) throw error;
  return data;
}

export async function fetchActiveCountByClass() {
  const { data, error } = await supabase
    .from("students")
    .select("class_id")
    .eq("status", "active");
  if (error) throw error;
  return (data ?? []).reduce((acc, s) => {
    if (s.class_id) acc[s.class_id] = (acc[s.class_id] || 0) + 1;
    return acc;
  }, {});
}
