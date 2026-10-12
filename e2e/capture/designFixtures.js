// Fixture sets used only by the design-review capture run.
//
// They extend the shared e2e fixtures (e2e/fixtures.js) with enough rows to
// make each screen look like a real school rather than a stub: the console
// specs only need the shell, but a design critique needs populated stat
// cards, a full roster table and a gradebook with marks in it.
//
// Nothing here is imported by the test suite — the capture run has its own
// config (playwright.capture.config.js), so CI is untouched.

import { UID, teacherFix } from "../fixtures.js";

/** The date the overview treats as "today" (see admin.js todayIso). */
function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** `days` before today, as YYYY-MM-DD. */
function daysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const gradeLevels = [
  { id: 1, name: "7th Grade", numeric_level: 7 },
  { id: 2, name: "8th Grade", numeric_level: 8 },
  { id: 3, name: "9th Grade", numeric_level: 9 },
];

const rooms = [
  { id: 41, name: "Room 101", capacity: 30 },
  { id: 42, name: "Room 102", capacity: 30 },
  { id: 43, name: "Room 201", capacity: 28 },
  { id: 44, name: "Science Lab", capacity: 24 },
  { id: 45, name: "Auditorium", capacity: 120 },
];

const sections = [
  {
    id: 21,
    school_year_id: 1,
    grade_level_id: 1,
    section: "A",
    display_name: "7A",
    room_id: 41,
    max_capacity: 30,
    homeroom_teacher_id: 7,
  },
  {
    id: 22,
    school_year_id: 1,
    grade_level_id: 1,
    section: "B",
    display_name: "7B",
    room_id: 42,
    max_capacity: 30,
    homeroom_teacher_id: 8,
  },
  {
    id: 23,
    school_year_id: 1,
    grade_level_id: 2,
    section: "A",
    display_name: "8A",
    room_id: 43,
    max_capacity: 28,
    homeroom_teacher_id: 9,
  },
  {
    id: 24,
    school_year_id: 1,
    grade_level_id: 3,
    section: "A",
    display_name: "9A",
    room_id: null,
    max_capacity: 28,
    homeroom_teacher_id: 10,
  },
];

const teachers = [
  {
    id: 7,
    first_name: "Sofía",
    last_name: "Ramírez",
    specialization: "Mathematics",
    national_id: "0801-1990-00121",
    email: "sofia.ramirez@example.com",
    phone: "555-0100",
    hire_date: "2020-02-01",
    status: "active",
  },
  {
    id: 8,
    first_name: "Marco",
    last_name: "López",
    specialization: "Language Arts",
    national_id: "0801-1988-00344",
    email: "marco.lopez@example.com",
    phone: "555-0101",
    hire_date: "2019-08-12",
    status: "active",
  },
  {
    id: 9,
    first_name: "Valeria",
    last_name: "Cordero",
    specialization: "Biology",
    national_id: "0801-1991-00512",
    email: "valeria.cordero@example.com",
    phone: "555-0102",
    hire_date: "2021-01-18",
    status: "active",
  },
  {
    id: 10,
    first_name: "Diego",
    last_name: "Fuentes",
    specialization: "History",
    national_id: "0801-1985-00877",
    email: "diego.fuentes@example.com",
    phone: "555-0103",
    hire_date: "2018-03-05",
    status: "active",
  },
  {
    id: 11,
    first_name: "Carmen",
    last_name: "Núñez",
    specialization: "Art",
    national_id: "0801-1993-00901",
    email: "carmen.nunez@example.com",
    phone: "555-0104",
    hire_date: "2022-07-01",
    status: "inactive",
  },
];

const subjects = [
  { id: 31, name: "Mathematics", code: "MATH7", color: "#7380ec" },
  { id: 32, name: "Language Arts", code: "LANG7", color: "#ff7782" },
  { id: 33, name: "Biology", code: "BIO7", color: "#41f1b6" },
  { id: 34, name: "History", code: "HIST7", color: "#ffbb55" },
  { id: 35, name: "Physical Education", code: "PE7", color: "#7d8da1" },
];

const STUDENT_NAMES = [
  ["Ana", "García", "F"],
  ["Luis", "Martínez", "M"],
  ["Camila", "Herrera", "F"],
  ["Mateo", "Rojas", "M"],
  ["Isabella", "Vargas", "F"],
  ["Sebastián", "Moreno", "M"],
  ["Valentina", "Castro", "F"],
  ["Diego", "Salazar", "M"],
  ["Lucía", "Peña", "F"],
  ["Emilio", "Navarro", "M"],
  ["Renata", "Ibarra", "F"],
  ["Joaquín", "Delgado", "M"],
  ["Antonella", "Quintero", "F"],
  ["Tomás", "Mendoza", "M"],
];

const students = STUDENT_NAMES.map(([first, last, gender], i) => ({
  id: 101 + i,
  // The first row is the portal's signed-in student, so index.html and the
  // console agree on who "Ana García" is.
  auth_user_id: i === 0 ? UID : null,
  class_id: sections[i % sections.length].id,
  first_name: first,
  last_name: last,
  gender,
  email: `${first.toLowerCase()}.${last.toLowerCase()}@example.com`,
  phone: `555-02${String(i).padStart(2, "0")}`,
  national_id: `0801-2013-0${String(1000 + i)}`,
  enrollment_number: `S-${101 + i}`,
  date_of_birth: `2013-0${(i % 9) + 1}-1${i % 9}`,
  enrollment_date: "2025-09-01",
  // Two students off the active roster, so the status badges show both states.
  status: i === 11 || i === 13 ? "inactive" : "active",
  classes: sections[i % sections.length],
}));

// Today's attendance: mostly present, a couple late and absent, so the rate
// card lands on a believable figure rather than 100%.
const todayAttendance = students
  .filter((s) => s.status === "active")
  .map((s, i) => ({
    id: 900 + i,
    student_id: s.id,
    class_id: s.class_id,
    date: todayIso(),
    status: i % 9 === 0 ? "absent" : i % 5 === 0 ? "late" : "present",
    recorded_by: 7,
  }));

// History: three students cross the 3-absence at-risk threshold.
const historicAttendance = [];
let attendanceId = 1000;
students.slice(0, 5).forEach((s, si) => {
  const absences = si < 3 ? 4 : 1;
  for (let d = 1; d <= absences; d += 1) {
    historicAttendance.push({
      id: attendanceId++,
      student_id: s.id,
      class_id: s.class_id,
      date: daysAgo(d),
      status: "absent",
      recorded_by: 7,
    });
  }
});

/** Admin console with a full school behind it. */
export const adminPopulatedFix = {
  profiles: [{ id: UID, name: "Gabriel", role: "admin" }],
  school_years: [
    {
      id: 1,
      name: "2025-2026",
      start_date: "2025-09-01",
      end_date: "2026-06-30",
      is_active: true,
    },
  ],
  school_settings: [
    { id: 1, name: "Colegio San Marcos", logo_url: null, id_label: null },
  ],
  grading_periods: teacherFix.grading_periods,
  grade_levels: gradeLevels,
  rooms,
  classes: sections,
  teachers,
  subjects,
  students,
  attendance: [...todayAttendance, ...historicAttendance],
  class_subject_teachers: teacherFix.class_subject_teachers,
  grade_level_subjects: [],
  schedules: [],
};

/**
 * A school on its first login: the admin's profile exists, and nothing else
 * has been created yet. Every other table resolves to [] in the route handler.
 */
export const adminEmptyFix = {
  profiles: [{ id: UID, name: "Gabriel", role: "admin" }],
};

const assignments = [
  {
    id: 401,
    class_subject_teacher_id: 11,
    grading_period_id: 1,
    category_id: 61,
    name: "Unit 1 Quiz",
    due_date: daysAgo(21),
    max_score: 20,
    note: null,
    created_at: "2026-06-05T09:00:00Z",
  },
  {
    id: 402,
    class_subject_teacher_id: 11,
    grading_period_id: 1,
    category_id: 62,
    name: "Fractions Worksheet",
    due_date: daysAgo(14),
    max_score: 10,
    note: null,
    created_at: "2026-06-12T09:00:00Z",
  },
  {
    id: 403,
    class_subject_teacher_id: 11,
    grading_period_id: 1,
    category_id: 61,
    name: "Midterm Exam",
    due_date: daysAgo(7),
    max_score: 100,
    note: "Covers units 1–3",
    created_at: "2026-06-19T09:00:00Z",
  },
  {
    id: 404,
    class_subject_teacher_id: 11,
    grading_period_id: 1,
    category_id: 63,
    name: "Geometry Project",
    due_date: daysAgo(2),
    max_score: 50,
    note: null,
    created_at: "2026-06-26T09:00:00Z",
  },
];

// The teacher console shows one section at a time, so the whole cohort sits
// in 7A here: splitting them across four sections the way the admin console
// does would leave the gradebook with three or four rows.
const gradebookStudents = students.map((s) => ({
  id: s.id,
  first_name: s.first_name,
  last_name: s.last_name,
  email: s.email,
  phone: s.phone,
  status: s.status,
  enrollment_number: s.enrollment_number,
  national_id: s.national_id,
  date_of_birth: s.date_of_birth,
  gender: s.gender,
  address: null,
  photo_url: null,
  enrollment_date: s.enrollment_date,
}));

// Spread across the grade bands so the colored grade cells are all visible.
const PERIOD_SCORES = [94, 88, 72, 61, 45, 83, 97];

const periodGrades = gradebookStudents.map((s, i) => ({
  student_id: s.id,
  class_subject_teacher_id: 11,
  grading_period_id: 1,
  period_score: PERIOD_SCORES[i % PERIOD_SCORES.length],
  graded_count: i % 4 === 0 ? 3 : 4,
  total_assignments: assignments.length,
}));

/** Teacher console with a class whose gradebook actually has marks in it. */
export const teacherPopulatedFix = {
  ...teacherFix,
  school_settings: adminPopulatedFix.school_settings,
  students: gradebookStudents.map((s) => ({ ...s, class_id: 21 })),
  rooms,
  subjects,
  assignments,
  grade_categories: [
    { id: 61, class_subject_teacher_id: 11, name: "Exams", weight: 50 },
    { id: 62, class_subject_teacher_id: 11, name: "Homework", weight: 20 },
    { id: 63, class_subject_teacher_id: 11, name: "Projects", weight: 30 },
  ],
  student_period_grades: periodGrades,
  attendance: todayAttendance.map((a) => ({ ...a, class_id: 21 })),
};

// ── Student portal ────────────────────────────────────────────────
//
// The shared studentFix carries one subject, one grade and three attendance
// rows — enough for the suite's assertions, but the dashboard renders as a
// near-empty shell: a one-row grade table, a single subject bar and a 33%
// attendance ring. These rows fill every card on the page.

const PERIODS = [
  {
    id: 1,
    school_year_id: 1,
    name: "Period 1",
    period_order: 1,
    start_date: "2025-09-01",
    end_date: "2025-12-15",
  },
  {
    id: 2,
    school_year_id: 1,
    name: "Period 2",
    period_order: 2,
    start_date: "2026-01-08",
    end_date: "2026-03-27",
  },
  {
    id: 3,
    school_year_id: 1,
    name: "Period 3",
    period_order: 3,
    start_date: "2026-04-06",
    end_date: "2026-06-30",
  },
];

const portalClass = {
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

// One mark per subject per period, spread across the grade bands so the
// dashboard table and the subject bars show the full color range.
const SUBJECT_SCORES = {
  31: [92, 88, 95],
  32: [78, 84, 81],
  33: [66, 71, 74],
  34: [85, 90, 87],
  35: [96, 98, 94],
};
const SUBJECT_TEACHER = { 31: 7, 32: 8, 33: 9, 34: 10, 35: 8 };

const portalGrades = [];
let gradeId = 500;
Object.entries(SUBJECT_SCORES).forEach(([subjectId, scores]) => {
  const subject = subjects.find((s) => s.id === Number(subjectId));
  const teacherId = SUBJECT_TEACHER[subjectId];
  const teacherRow = teachers.find((x) => x.id === teacherId);
  scores.forEach((score, i) => {
    portalGrades.push({
      id: gradeId++,
      student_id: 101,
      grading_period_id: PERIODS[i].id,
      score,
      notes: null,
      submitted_at: `2026-0${i + 1}-15T12:00:00Z`,
      grading_periods: PERIODS[i],
      class_subject_teachers: {
        id: 10 + Number(subjectId),
        subjects: subject,
        teachers: teacherRow
          ? {
              id: teacherRow.id,
              first_name: teacherRow.first_name,
              last_name: teacherRow.last_name,
            }
          : null,
      },
    });
  });
});

// Six school weeks of attendance: mostly present, with the odd late and
// absence, so the ring lands on a realistic figure instead of 33%.
const portalAttendance = [];
let portalAttendanceId = 700;
for (let d = 1; d <= 42; d += 1) {
  const date = new Date();
  date.setDate(date.getDate() - d);
  const weekday = date.getDay();
  if (weekday === 0 || weekday === 6) continue;
  portalAttendance.push({
    id: portalAttendanceId++,
    student_id: 101,
    date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
    status: d % 13 === 0 ? "absent" : d % 7 === 0 ? "late" : "present",
    notes: null,
    recorded_by: d % 2 === 0 ? 7 : 8,
    classes: { id: 21, display_name: "7A" },
  });
}

// A full timetable: five periods a day, Monday to Friday.
const DAY_PLAN = [
  [31, 32, 33, 34, 35],
  [32, 31, 35, 33, 34],
  [33, 34, 31, 35, 32],
  [34, 35, 32, 31, 33],
  [35, 33, 34, 32, 31],
];
const SLOTS = [
  ["08:00", "09:00"],
  ["09:10", "10:10"],
  ["10:30", "11:30"],
  ["11:40", "12:40"],
  ["13:30", "14:30"],
];

const portalSchedules = [];
let scheduleId = 300;
DAY_PLAN.forEach((subjectIds, dayIndex) => {
  subjectIds.forEach((subjectId, slotIndex) => {
    const teacherId = SUBJECT_TEACHER[subjectId];
    const teacherRow = teachers.find((x) => x.id === teacherId);
    portalSchedules.push({
      id: scheduleId++,
      class_id: 21,
      subject_id: subjectId,
      teacher_id: teacherId,
      room_id: rooms[slotIndex % rooms.length].id,
      day_of_week: dayIndex + 1,
      start_time: SLOTS[slotIndex][0],
      end_time: SLOTS[slotIndex][1],
      subjects: subjects.find((s) => s.id === subjectId),
      teachers: teacherRow
        ? {
            id: teacherRow.id,
            first_name: teacherRow.first_name,
            last_name: teacherRow.last_name,
          }
        : null,
      rooms: rooms[slotIndex % rooms.length],
    });
  });
});

/** Student portal with every dashboard card populated. */
export const studentPopulatedFix = {
  students: [
    {
      id: 101,
      auth_user_id: UID,
      class_id: 21,
      first_name: "Ana",
      last_name: "García",
      email: "ana.garcia@example.com",
      phone: "555-0200",
      status: "active",
      enrollment_number: "S-101",
      national_id: "0801-2013-01000",
      date_of_birth: "2013-04-01",
      gender: "F",
      enrollment_date: "2025-09-01",
      classes: portalClass,
    },
  ],
  teachers,
  rooms,
  subjects,
  school_years: [portalClass.school_years],
  school_settings: adminPopulatedFix.school_settings,
  grading_periods: PERIODS,
  student_grades: portalGrades,
  attendance: portalAttendance,
  schedules: portalSchedules,
  events: [
    {
      id: 701,
      title: "Parent–Teacher Conferences",
      type: "meeting",
      description: "Afternoon slots by appointment",
      start_date: "2026-08-14",
      end_date: "2026-08-14",
    },
    {
      id: 702,
      title: "Science Fair",
      type: "activity",
      description: "Projects on display in the auditorium",
      start_date: "2026-08-21",
      end_date: "2026-08-22",
    },
    {
      id: 703,
      title: "Final Exams",
      type: "exam_period",
      description: "Week of finals",
      start_date: "2026-09-07",
      end_date: "2026-09-11",
    },
    {
      id: 704,
      title: "Independence Day",
      type: "holiday",
      description: "School closed",
      start_date: "2026-09-15",
      end_date: "2026-09-15",
    },
  ],
  discipline_records: [],
};
