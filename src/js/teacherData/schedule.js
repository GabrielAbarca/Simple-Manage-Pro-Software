// ── Schedule (by class, and today's — item 7) ────────────────────
import { supabase } from "../supabaseClient.js";

export async function fetchScheduleByClass(classId) {
  const { data, error } = await supabase
    .from("schedules")
    .select(
      `
      id, day_of_week, start_time, end_time, teacher_id,
      subjects!subject_id(id, name, color),
      rooms!room_id(id, name)
    `,
    )
    .eq("class_id", classId)
    .order("day_of_week")
    .order("start_time");
  if (error) throw error;

  // A class's full week can include colleagues' periods, not just the
  // caller's own, so `teachers` can no longer be embedded here (RLS narrowed
  // to admin/self). Resolve names in one batched query against the PII-free
  // directory view instead.
  const teacherIds = [
    ...new Set(data.map((s) => s.teacher_id).filter((id) => id != null)),
  ];
  if (teacherIds.length > 0) {
    const { data: teachers } = await supabase
      .from("teachers_directory")
      .select("id, first_name, last_name")
      .in("id", teacherIds);
    const byId = new Map((teachers ?? []).map((tch) => [tch.id, tch]));
    for (const record of /** @type {any[]} */ (data)) {
      record.teachers = byId.get(record.teacher_id) ?? null;
    }
  }

  return data;
}

// ── Today (item 7) ──────────────────────────────────────────
export async function fetchScheduleToday(teacherId, dayOfWeek) {
  const { data, error } = await supabase
    .from("schedules")
    .select(
      `
      id, class_id, subject_id, day_of_week, start_time, end_time,
      classes!class_id(display_name, section, grade_levels!grade_level_id(name)),
      subjects!subject_id(name, color),
      rooms!room_id(name)
    `,
    )
    .eq("teacher_id", teacherId)
    .eq("day_of_week", dayOfWeek)
    .order("start_time");
  if (error) throw error;
  return data;
}
