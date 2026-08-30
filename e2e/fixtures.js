// Shared e2e harness: seeds an authenticated session and mocks the Supabase
// REST layer with in-memory fixtures (RLS hides all rows from anon, and no
// credentials live in the repo). Mirrors the network shape the app expects:
// GETs are answered from per-table fixtures with eq./in. filters applied; the
// demo_teacher_id RPC returns a fixed id; anything else (a write) is blocked.

export const SUPA = "https://demo.supabase.co";
export const REF = "demo";
export const UID = "00000000-0000-4000-8000-000000000001";

const cls = {
  id: 21,
  section: "A",
  display_name: "7A",
  max_capacity: 30,
  homeroom_teacher_id: 7,
  room_id: 41,
  grade_levels: { id: 1, name: "7th Grade", numeric_level: 7 },
  school_years: {
    id: 1,
    name: "2025-2026",
    start_date: "2025-09-01",
    end_date: "2026-06-30",
    is_active: true,
  },
};

const teacher = {
  id: 7,
  first_name: "Sofía",
  last_name: "Ramírez",
  specialization: "Mathematics",
  national_id: "1-1054-0378",
  email: "sofia@example.com",
  phone: "555-0100",
  address: "San José",
  hire_date: "2020-02-01",
  status: "active",
};

// Student-portal fixtures (index.html).
export const studentFix = {
  students: [
    {
      id: 101,
      auth_user_id: UID,
      class_id: 21,
      first_name: "Ana",
      last_name: "García",
      email: "ana@example.com",
      status: "active",
      enrollment_number: "S-101",
      date_of_birth: "2013-04-01",
      gender: "F",
      enrollment_date: "2025-09-01",
      classes: cls,
    },
  ],
  teachers: [
    { id: 7, first_name: "Sofía", last_name: "Ramírez" },
    { id: 8, first_name: "Marco", last_name: "López" },
  ],
  // Mirrors public.teachers_directory: the PII-free columns every signed-in
  // user (not just admin/self) can read after the RLS narrowing.
  teachers_directory: [
    {
      id: 7,
      first_name: "Sofía",
      last_name: "Ramírez",
      specialization: "Mathematics",
      email: "sofia@example.com",
      status: "active",
    },
    { id: 8, first_name: "Marco", last_name: "López", status: "active" },
  ],
  rooms: [{ id: 41, name: "Room 101" }],
  grading_periods: [
    {
      id: 1,
      school_year_id: 1,
      name: "Period 1",
      period_order: 1,
      start_date: "2026-06-01",
      end_date: "2026-08-31",
    },
  ],
  student_grades: [
    {
      id: 501,
      student_id: 101,
      score: 88,
      submitted_at: "2026-07-01T12:00:00Z",
      grading_periods: { id: 1, name: "Period 1", period_order: 1 },
      class_subject_teachers: {
        id: 11,
        teacher_id: 7,
        subjects: {
          id: 31,
          name: "Mathematics",
          code: "MATH7",
          color: "#7380ec",
        },
      },
    },
  ],
  attendance: [
    {
      id: 601,
      student_id: 101,
      date: "2026-07-10",
      status: "present",
      recorded_by: 7,
      classes: { id: 21, display_name: "7A" },
    },
    {
      id: 602,
      student_id: 101,
      date: "2026-07-09",
      status: "late",
      recorded_by: 8,
      classes: { id: 21, display_name: "7A" },
    },
    {
      id: 603,
      student_id: 101,
      date: "2026-07-08",
      status: "absent",
      recorded_by: 7,
      classes: { id: 21, display_name: "7A" },
    },
  ],
  schedules: [1, 2, 3, 4, 5].map((day) => ({
    id: 300 + day,
    class_id: 21,
    teacher_id: 7,
    subject_id: 31,
    room_id: 41,
    day_of_week: day,
    start_time: "08:00",
    end_time: "09:00",
    subjects: { id: 31, name: "Mathematics", code: "MATH7", color: "#7380ec" },
    rooms: { id: 41, name: "Room 101" },
  })),
  events: [
    {
      id: 701,
      title: "Final Exams",
      type: "exam_period",
      description: "Week of finals",
      start_date: "2026-07-20",
      end_date: "2026-07-24",
    },
  ],
};

// Teacher-console fixtures (teacher.html). The profile row carries the
// teacher role: the console's gate accepts teachers (and admins).
export const teacherFix = {
  profiles: [{ id: UID, name: "Sofía Ramírez", role: "teacher" }],
  school_years: [{ id: 1, name: "2025-2026", is_active: true }],
  grading_periods: studentFix.grading_periods,
  teachers: [teacher, { id: 8, first_name: "Marco", last_name: "López" }],
  teachers_directory: studentFix.teachers_directory,
  class_subject_teachers: [
    {
      id: 11,
      class_id: 21,
      subject_id: 31,
      teacher_id: 7,
      school_year_id: 1,
      classes: {
        id: 21,
        display_name: "7A",
        section: "A",
        grade_levels: { name: "7th Grade" },
      },
      subjects: { id: 31, name: "Mathematics", color: "#7380ec" },
    },
  ],
  students: [
    {
      id: 101,
      class_id: 21,
      first_name: "Ana",
      last_name: "García",
      status: "active",
      enrollment_number: "S-101",
    },
    {
      id: 102,
      class_id: 21,
      first_name: "Luis",
      last_name: "Martínez",
      status: "active",
      enrollment_number: "S-102",
    },
  ],
  schedules: studentFix.schedules,
  subjects: [{ id: 31, name: "Mathematics", code: "MATH7", color: "#7380ec" }],
  rooms: [{ id: 41, name: "Room 101", capacity: 30 }],
  attendance: [],
  assignments: [],
  assignment_grades: [],
  student_period_grades: [],
  discipline_records: [],
  student_grades: [],
  grade_categories: [],
  grade_component_templates: [
    { id: 5, name: "Plantilla MEP", subject_id: null, is_default: true },
  ],
  grade_component_template_items: [
    { id: 1, template_id: 5, name: "Cotidiano", weight: 35, item_order: 1 },
    { id: 2, template_id: 5, name: "Pruebas", weight: 40, item_order: 2 },
    { id: 3, template_id: 5, name: "Asistencia", weight: 25, item_order: 3 },
  ],
};

// Admin-console fixtures (admin.html). The shell only reads the signed-in
// profile and the active school year.
export const consoleFix = {
  profiles: [{ id: UID, name: "Gabriel", role: "admin" }],
  school_years: [{ id: 1, name: "2025-2026", is_active: true }],
};

// The Schedules tab needs the whole academic structure to build a week:
// two sections (so copy-between and cross-section conflicts are testable),
// two teachers, subjects, a room, and one seeded entry.
export const scheduleFix = {
  ...consoleFix,
  grade_levels: [{ id: 1, name: "10th Grade", numeric_level: 10 }],
  classes: [
    {
      id: 21,
      school_year_id: 1,
      grade_level_id: 1,
      section: "A",
      display_name: "1010-1",
    },
    {
      id: 22,
      school_year_id: 1,
      grade_level_id: 1,
      section: "B",
      display_name: "1010-2",
    },
  ],
  subjects: [
    { id: 101, name: "Mathematics", code: "MAT", color: "#7380ec" },
    { id: 102, name: "Biology", code: "BIO", color: "#41f1b6" },
  ],
  teachers: [
    { id: 1001, first_name: "Ana", last_name: "Rojas" },
    { id: 1002, first_name: "Luis", last_name: "Mora" },
  ],
  rooms: [{ id: 5, name: "Room 101" }],
  schedules: [
    {
      id: 900,
      class_id: 21,
      subject_id: 101,
      teacher_id: 1001,
      day_of_week: 1,
      start_time: "08:00:00",
      end_time: "09:00:00",
      room_id: 5,
    },
  ],
  schedule_configs: [
    {
      id: 1,
      school_year_id: 1,
      structure_type: "section",
      active_days: [1, 2, 3, 4, 5],
    },
  ],
  bell_schedules: [{ id: 1, name: "Morning" }],
  bell_schedule_blocks: [
    {
      id: 1,
      bell_schedule_id: 1,
      label: "Block 1",
      kind: "class",
      block_order: 1,
      start_time: "08:00:00",
      end_time: "09:00:00",
    },
    {
      id: 2,
      bell_schedule_id: 1,
      label: "Recess",
      kind: "break",
      block_order: 2,
      start_time: "09:00:00",
      end_time: "09:20:00",
    },
  ],
};

function rowMatches(row, params) {
  for (const [k, v] of params) {
    if (["select", "order", "limit", "offset"].includes(k)) continue;
    if (v.startsWith("eq.")) {
      if (String(row[k]) !== v.slice(3)) return false;
    } else if (v.startsWith("in.(")) {
      const vals = v
        .slice(4, -1)
        .split(",")
        .map((s) => s.trim().replace(/^"|"$/g, ""));
      if (!vals.includes(String(row[k]))) return false;
    } else if (v === "not.is.null") {
      if (row[k] == null) return false;
    }
  }
  return true;
}

/**
 * Per-view i18n storage keys (src/js/i18n.js → STORAGE_KEYS). The login page
 * has no key by design and so cannot be pinned.
 */
export const LANG_KEYS = [
  "smp-lang-student",
  "smp-lang-admin",
  "smp-lang-console",
];

/**
 * Pin the interface language for a test context.
 *
 * The app defaults to Spanish. Most specs here assert English chrome, so the
 * suite pins a language rather than re-translating every assertion whenever
 * the default moves — the default itself is covered by its own spec
 * (language.spec.js), which seeds nothing.
 *
 * @param {import("@playwright/test").BrowserContext} context
 * @param {"en" | "es"} [lang]
 */
export async function seedLang(context, lang = "en") {
  await context.addInitScript(
    (entries) => {
      for (const [key, value] of entries) localStorage.setItem(key, value);
    },
    LANG_KEYS.map((key) => [key, lang]),
  );
}

/**
 * Route the Supabase origin against `fix`. Returns a `writes` array that
 * captures any non-GET request reaching the backend (must stay empty in demo).
 *
 * Also pins the interface language: every spec that renders the app calls
 * this, so it is the one place that keeps text assertions stable.
 */
export async function routeSupabase(context, fix) {
  await seedLang(context);
  const writes = [];
  await context.route(`${SUPA}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const isRead =
      req.method() === "GET" || url.pathname.endsWith("/rpc/demo_teacher_id");
    if (!isRead) writes.push(`${req.method()} ${url.pathname}`);

    if (url.pathname.endsWith("/rpc/demo_teacher_id")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "7",
      });
    }
    if (url.pathname.startsWith("/rest/v1/") && req.method() === "GET") {
      const table = url.pathname.replace("/rest/v1/", "");
      const rows = (fix[table] ?? []).filter((r) =>
        rowMatches(r, url.searchParams),
      );
      const wantsObject = (req.headers()["accept"] ?? "").includes(
        "vnd.pgrst.object",
      );
      if (wantsObject) {
        return rows.length
          ? route.fulfill({
              status: 200,
              contentType: "application/json",
              body: JSON.stringify(rows[0]),
            })
          : route.fulfill({
              status: 406,
              contentType: "application/json",
              body: JSON.stringify({ code: "PGRST116" }),
            });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(rows),
      });
    }
    // Reading the signed-in user back. supabase-js does this before it will
    // hand out a session built from tokens in the URL, which is how the
    // password-recovery specs arrive. It's a GET, so it was never counted as a
    // write — the sandbox's no-writes guarantee is untouched.
    if (url.pathname === "/auth/v1/user" && req.method() === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(authUser),
      });
    }
    // A write or any other auth call must never happen in the demo sandbox.
    return route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({ message: "blocked by e2e harness" }),
    });
  });
  return writes;
}

const TOKEN_TTL = 3600 * 24 * 365;

/** The Auth user behind the seeded session. */
const authUser = {
  id: UID,
  aud: "authenticated",
  role: "authenticated",
  email: "demo@example.com",
  app_metadata: {},
  user_metadata: {},
  created_at: "2026-01-01T00:00:00Z",
};

/**
 * A far-future access token. Exposed on its own for the specs that put one in
 * a URL fragment (the password-recovery landing) rather than in storage.
 */
export function accessTokenSeed() {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL;
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: UID, role: "authenticated", aud: "authenticated", exp })}.sig`;
}

export function sessionSeed() {
  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL;
  const jwt = accessTokenSeed();
  return JSON.stringify({
    access_token: jwt,
    token_type: "bearer",
    expires_in: TOKEN_TTL,
    expires_at: exp,
    refresh_token: "fake-refresh",
    user: authUser,
  });
}
