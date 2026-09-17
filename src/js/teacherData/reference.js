// ── Shared reference data (for forms) + subjects catalog ─────────
import { supabase } from "../supabaseClient.js";

export async function fetchSubjects() {
  const { data, error } = await supabase
    .from("subjects")
    .select("id, name, code, color")
    .order("name");
  if (error) throw error;
  return data;
}

export async function fetchTeachers() {
  const { data, error } = await supabase
    .from("teachers_directory")
    .select("id, first_name, last_name")
    .order("last_name");
  if (error) throw error;
  return data;
}

/**
 * The single school_settings row — school identity and the MEP pass marks.
 * Schemas are applied by hand, so a project that predates the table (or the
 * pass-mark columns) must keep working: an unreadable row becomes null and
 * promotion.js applies its defaults.
 */
export async function fetchSchoolSettings() {
  const { data, error } = await supabase
    .from("school_settings")
    .select("*")
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn("fetchSchoolSettings:", error.message);
    return null;
  }
  return data;
}

export async function fetchRooms() {
  const { data, error } = await supabase
    .from("rooms")
    .select("id, name, capacity")
    .order("name");
  if (error) throw error;
  return data;
}

// ── Subjects catalog (global — retained) ────────────────────
export async function fetchSubjectsDetailed() {
  const { data, error } = await supabase
    .from("subjects")
    .select(
      `
      id, name, code, description, color,
      grade_level_subjects(grade_levels(name))
    `,
    )
    .order("name");
  if (error) throw error;
  return data;
}
