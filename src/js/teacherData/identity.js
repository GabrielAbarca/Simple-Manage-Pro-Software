// ── Identity / context ──────────────────────────────────────────
import { supabase } from "../supabaseClient.js";
import { DEMO_MODE } from "../demoMode.js";
import { state } from "../teacherState.js";

export async function getTeacherId() {
  // Real mode: resolve the teacher from their linked auth user
  // (teachers.auth_user_id). Demo mode keeps the fixed-teacher hack
  // (app_config → demo_teacher_id()), since the shared demo account
  // isn't tied to a specific teacher.
  if (!DEMO_MODE) {
    const { data, error } = await supabase
      .from("teachers")
      .select("id")
      .eq("auth_user_id", state.session.user.id)
      .maybeSingle();
    if (error) throw error;
    return data?.id ?? null;
  }
  const { data, error } = await supabase.rpc("demo_teacher_id");
  if (error) throw error;
  return data;
}

export async function fetchActiveYear() {
  const { data, error } = await supabase
    .from("school_years")
    .select("id, name, is_active")
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function fetchTeacher(id) {
  // An account with no teachers row resolves to a null id. Passing that to
  // .eq() serialises as the literal "id=eq.null", which Postgres rejects
  // against an integer column (22P02 → HTTP 400), so stop here instead.
  if (id == null) return null;
  const { data, error } = await supabase
    .from("teachers")
    .select("id, first_name, last_name, specialization")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data;
}

// Full teacher record for the read-only Settings view (display only).
export async function fetchTeacherFull(id) {
  if (id == null) return null;
  const { data, error } = await supabase
    .from("teachers")
    .select(
      "id, first_name, last_name, national_id, email, phone, address, " +
        "hire_date, specialization, status",
    )
    .eq("id", id)
    .single();
  if (error) throw error;
  return data;
}

export async function fetchGradingPeriods(yearId) {
  let q = supabase
    .from("grading_periods")
    .select("id, name, period_order, start_date, end_date")
    .order("period_order");
  if (yearId) q = q.eq("school_year_id", yearId);
  const { data, error } = await q;
  if (error) throw error;
  return data;
}
