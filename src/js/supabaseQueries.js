// Student portal data layer.
//
// Every fetcher here throws when the query fails, and returns empty only when
// the query succeeded and there genuinely is nothing. These used to be the
// same thing — a failure returned [] — which meant a dropped connection or an
// RLS denial rendered as "No grades recorded yet". The caller (main.js) is the
// only consumer, and it turns a throw into a visible error state with a retry.
import { supabase } from "./supabaseClient.js";
import { nextOccurrence } from "./scheduleLogic.js";

export async function fetchStudentProfile(studentId) {
  const { data, error } = await supabase
    .from("students")
    .select(
      `
      *,
      classes!class_id (
        id, section, display_name, max_capacity, homeroom_teacher_id, room_id,
        grade_levels ( id, name, numeric_level ),
        school_years ( id, name, start_date, end_date, is_active )
      )
    `,
    )
    .eq("id", studentId)
    .maybeSingle();

  if (error) {
    console.error("fetchStudentProfile:", error.message);
    throw error;
  }
  // A missing row is an answer, not a failure — main.js has its own handling
  // for "this login isn't linked to a student".
  if (!data) {
    console.error("fetchStudentProfile: no student found with id", studentId);
    return null;
  }

  // The two lookups below decorate the class with a teacher name and a room
  // name. They stay error-tolerant on purpose: losing them costs a label, not
  // the page, so they must not take the whole profile down with them.
  const cls = data.classes;
  if (cls && cls.homeroom_teacher_id) {
    const { data: teacher } = await supabase
      .from("teachers_directory")
      .select("id, first_name, last_name")
      .eq("id", cls.homeroom_teacher_id)
      .maybeSingle();
    cls.homeroom_teacher = teacher;
  }

  if (cls && cls.room_id) {
    const { data: room } = await supabase
      .from("rooms")
      .select("id, name")
      .eq("id", cls.room_id)
      .maybeSingle();
    cls.room = room;
  }

  return data;
}

export async function fetchGradingPeriods(schoolYearId) {
  const { data, error } = await supabase
    .from("grading_periods")
    .select("*")
    .eq("school_year_id", schoolYearId)
    .order("period_order", { ascending: true });

  if (error) {
    console.error("fetchGradingPeriods:", error.message);
    throw error;
  }
  return data;
}

export async function fetchStudentGrades(studentId, gradingPeriodId = null) {
  let query = supabase
    .from("student_grades")
    .select(
      `
      id, score, notes, submitted_at,
      grading_periods ( id, name, period_order ),
      class_subject_teachers (
        id, teacher_id,
        subjects ( id, name, code, color )
      )
    `,
    )
    .eq("student_id", studentId)
    .order("submitted_at", { ascending: true });

  if (gradingPeriodId) {
    query = query.eq("grading_period_id", gradingPeriodId);
  }

  const { data, error } = await query;
  if (error) {
    console.error("fetchStudentGrades:", error.message);
    throw error;
  }

  // teachers isn't a real foreign-key target PostgREST can embed anymore (RLS
  // narrowed to admin/self; the safe columns live in teachers_directory
  // instead) — resolve every teacher in one batched query, same pattern as
  // fetchStudentAttendance's recorder lookup below.
  const teacherIds = [
    ...new Set(
      /** @type {any[]} */ (data)
        .map((g) => g.class_subject_teachers?.teacher_id)
        .filter((id) => id != null),
    ),
  ];
  if (teacherIds.length > 0) {
    const { data: teachers } = await supabase
      .from("teachers_directory")
      .select("id, first_name, last_name")
      .in("id", teacherIds);
    const byId = new Map((teachers ?? []).map((tch) => [tch.id, tch]));
    for (const record of /** @type {any[]} */ (data)) {
      const cst = record.class_subject_teachers;
      if (cst) {
        cst.teachers = byId.get(cst.teacher_id) ?? null;
      }
    }
  }

  return data;
}

export async function fetchStudentAttendance(studentId) {
  const { data, error } = await supabase
    .from("attendance")
    .select(
      `
      id, date, status, notes, recorded_by,
      classes ( id, display_name )
    `,
    )
    .eq("student_id", studentId)
    .order("date", { ascending: false });

  if (error) {
    console.error("fetchStudentAttendance:", error.message);
    throw error;
  }

  // Resolve every recorder in ONE batched query instead of one lookup per row
  // (this was an N+1: a serial round-trip for each attendance record).
  const recorderIds = [
    ...new Set(data.filter((r) => r.recorded_by).map((r) => r.recorded_by)),
  ];
  if (recorderIds.length > 0) {
    const { data: teachers } = await supabase
      .from("teachers_directory")
      .select("id, first_name, last_name")
      .in("id", recorderIds);
    const byId = new Map((teachers ?? []).map((tch) => [tch.id, tch]));
    // `data` rows are typed from the select above; `teacher` is attached
    // dynamically here (the recorder resolved from the batched query).
    for (const record of /** @type {any[]} */ (data)) {
      if (record.recorded_by) {
        record.teacher = byId.get(record.recorded_by) ?? null;
      }
    }
  }

  return data;
}

export async function fetchClassSchedule(classId) {
  const { data, error } = await supabase
    .from("schedules")
    .select(
      `
      id, day_of_week, start_time, end_time, teacher_id,
      subjects ( id, name, code, color ),
      rooms ( id, name )
    `,
    )
    .eq("class_id", classId)
    .order("day_of_week", { ascending: true })
    .order("start_time", { ascending: true });

  if (error) {
    console.error("fetchClassSchedule:", error.message);
    throw error;
  }

  // Same reasoning as fetchStudentGrades: teachers can no longer be embedded
  // for a non-admin, non-self caller, so resolve names in one batched query
  // against the PII-free directory view instead.
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

export async function fetchTeachers() {
  const { data, error } = await supabase
    .from("teachers_directory")
    .select("*")
    .order("last_name", { ascending: true });

  if (error) {
    console.error("fetchTeachers:", error.message);
    throw error;
  }
  return data;
}

export async function fetchEvents() {
  const { data, error } = await supabase
    .from("events")
    .select("*")
    .order("start_date", { ascending: true });

  if (error) {
    console.error("fetchEvents:", error.message);
    throw error;
  }
  return data;
}

export async function fetchDashboardStats(studentId, classId) {
  // Attendance, grades and schedule are independent reads — fetch them
  // concurrently instead of chaining awaits (was a 3-deep serial waterfall
  // blocking the dashboard's first paint).
  const [attendance, grades, schedule] = await Promise.all([
    fetchStudentAttendance(studentId),
    fetchStudentGrades(studentId),
    fetchClassSchedule(classId),
  ]);

  const totalDays = attendance.length;
  const presentDays = attendance.filter(
    (a) => a.status === "present" || a.status === "late",
  ).length;
  const attendancePct =
    totalDays > 0 ? Math.round((presentDays / totalDays) * 100) : 0;

  const scores = grades
    .filter((g) => g.score !== null)
    .map((g) => Number(g.score));
  const gradeAvg =
    scores.length > 0
      ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) /
        10
      : 0;

  const now = new Date();
  const currentTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const nextClass = nextOccurrence(schedule, now.getDay(), currentTime);

  return {
    attendance: {
      present: presentDays,
      total: totalDays,
      percentage: attendancePct,
    },
    grades: { average: gradeAvg, count: scores.length },
    nextClass,
    allGrades: grades,
    allAttendance: attendance,
    allSchedule: schedule,
  };
}

export async function fetchDisciplineRecords(studentId) {
  const { data, error } = await supabase
    .from("discipline_records")
    .select(
      `
      *,
      teachers:reported_by_teacher ( id, first_name, last_name )
    `,
    )
    .eq("student_id", studentId)
    .order("date", { ascending: false });

  if (error) {
    console.error("fetchDisciplineRecords:", error.message);
    throw error;
  }
  return data;
}
