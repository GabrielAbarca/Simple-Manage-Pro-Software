// ═══════════════════════════════════════════════════════════════
//  teacher.js — Simple Manage Pro | Teacher Console
//
//  A single authenticated teacher's workspace. Everything scopes to
//  the teacher resolved from app_config via demo_teacher_id() (demo:
//  no per-teacher auth). Modeled on PowerSchool's PowerTeacher Pro.
//
//  Architecture:
//  1. Auth guard + teacher identity
//  2. Data layer  (db object — all Supabase queries)
//  3. UI helpers  (toast, modal, confirm, drawer, table helpers)
//  4. Navigation  (class-first: My Classes → class workspace)
//  5. My Classes landing
//  6. Class workspace shell + sub-tabs
//  7. Roster      (+ student detail drawer)
//  8. Gradebook   (assignments + per-student scores — the core)
//  9. Attendance
// 10. Schedule
// 11. Subjects    (global catalog — retained)
// ═══════════════════════════════════════════════════════════════

import "./errorHandler.js";
import "./speedInsights.js";
import { supabase } from "./supabaseClient.js";
import { signOut, getSession } from "./auth.js";
import {
  fetchRole,
  fetchStudentId,
  portalPath,
  haltForRedirect,
} from "./role.js";
import { initTheme, bindThemeToggle } from "./theme.js";
import {
  skeletonRows,
  skeletonBlock,
  skeletonCards,
  skeletonCardItems,
  initSidebarToggle,
} from "./ui.js";
import { renderSettings } from "./settings.js";
import { DEMO_MODE } from "./demoMode.js";
import { wrapDbForDemo } from "./demoDb.js";
import { dayKey, jsDayToDow } from "./scheduleLogic.js";
import {
  initI18n,
  applyTranslations,
  t,
  tn,
  formatDate as i18nFormatDate,
} from "./i18n.js";

// ───────────────────────────────────────────────────────────────
//  1. AUTH GUARD + TEACHER IDENTITY
// ───────────────────────────────────────────────────────────────
const session = await getSession();
if (!session) haltForRedirect("/login.html", "Unauthenticated");

// Teachers own this console; admins may enter too (school oversight, and the
// shared demo profile carries the admin role). Everyone else is sent to the
// portal their role resolves to.
const role = await fetchRole();
if (role !== "teacher" && role !== "admin") {
  haltForRedirect(portalPath(role), "Unauthorized");
}

// Resolve the current teacher (demo: fixed via app_config → demo_teacher_id()).
// Every teacher-scoped query below filters to TEACHER_ID in ACTIVE_YEAR.
let TEACHER_ID = null;
let ACTIVE_YEAR = null;
let PERIODS = [];

// ── Role gating (visual/demo only) ──────────────────────────────
// There is no per-user auth yet — this console always runs as the demo teacher.
// IS_ADMIN is the SINGLE flag every admin-restricted control routes through, and
// the only line a future real auth check would replace. Do not hardcode the
// disabled state into individual buttons; gate them through this flag instead.
const IS_ADMIN = false;

// Core, reusable treatment for any admin-restricted control. When IS_ADMIN is
// false, render the element enabled-but-inert: dimmed, not-allowed, aria-disabled,
// a hover tooltip, and a no-op click so the underlying action never runs. NOTE:
// the native `disabled` attribute is intentionally avoided — it suppresses mouse
// events, which would kill the hover tooltip.
function applyAdminLock(el) {
  el.classList.add("admin-only");
  el.setAttribute("aria-disabled", "true");
  el.title = t("common.adminOnly");
  el.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
}

// Wire a click action behind the flag in one call. Admin: run the real handler.
// Non-admin: lock the control (inert) and never attach the real handler.
function bindAdminAction(el, handler) {
  if (IS_ADMIN) el.addEventListener("click", handler);
  else applyAdminLock(el);
  return el;
}

// ───────────────────────────────────────────────────────────────
//  2. DATA LAYER
// ───────────────────────────────────────────────────────────────
const realDb = {
  // ── Identity / context ──────────────────────────────────────
  async getTeacherId() {
    // Real mode: resolve the teacher from their linked auth user
    // (teachers.auth_user_id). Demo mode keeps the fixed-teacher hack
    // (app_config → demo_teacher_id()), since the shared demo account
    // isn't tied to a specific teacher.
    if (!DEMO_MODE) {
      const { data, error } = await supabase
        .from("teachers")
        .select("id")
        .eq("auth_user_id", session.user.id)
        .maybeSingle();
      if (error) throw error;
      return data?.id ?? null;
    }
    const { data, error } = await supabase.rpc("demo_teacher_id");
    if (error) throw error;
    return data;
  },

  async fetchActiveYear() {
    const { data, error } = await supabase
      .from("school_years")
      .select("id, name, is_active")
      .eq("is_active", true)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async fetchTeacher(id) {
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
  },

  // Full teacher record for the read-only Settings view (display only).
  async fetchTeacherFull(id) {
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
  },

  async fetchGradingPeriods(yearId) {
    let q = supabase
      .from("grading_periods")
      .select("id, name, period_order, start_date, end_date")
      .order("period_order");
    if (yearId) q = q.eq("school_year_id", yearId);
    const { data, error } = await q;
    if (error) throw error;
    return data;
  },

  // ── My Classes ──────────────────────────────────────────────
  async fetchMyClasses(teacherId, yearId) {
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
  },

  async fetchActiveCountByClass() {
    const { data, error } = await supabase
      .from("students")
      .select("class_id")
      .eq("status", "active");
    if (error) throw error;
    return (data ?? []).reduce((acc, s) => {
      if (s.class_id) acc[s.class_id] = (acc[s.class_id] || 0) + 1;
      return acc;
    }, {});
  },

  // ── Roster / students ───────────────────────────────────────
  async fetchRoster(classId) {
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
  },

  async fetchStudentContacts(studentId) {
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
  },

  async insertStudent(payload) {
    const { error } = await supabase.from("students").insert(payload);
    if (error) throw error;
  },

  async updateStudent(id, payload) {
    const { error } = await supabase
      .from("students")
      .update(payload)
      .eq("id", id);
    if (error) throw error;
  },

  async deleteStudent(id) {
    const { error } = await supabase.from("students").delete().eq("id", id);
    if (error) throw error;
  },

  // ── Assignments (gradebook) ─────────────────────────────────
  async fetchAssignments(cstId, periodId) {
    const { data, error } = await supabase
      .from("assignments")
      .select("id, name, due_date, max_score, note, created_at, category_id")
      .eq("class_subject_teacher_id", cstId)
      .eq("grading_period_id", periodId)
      .order("due_date", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true });
    if (error) throw error;
    return data;
  },

  async insertAssignment(payload) {
    const { error } = await supabase.from("assignments").insert(payload);
    if (error) throw error;
  },

  async updateAssignment(id, payload) {
    const { error } = await supabase
      .from("assignments")
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw error;
  },

  async deleteAssignment(id) {
    // assignment_grades.assignment_id is ON DELETE CASCADE — scores go with it.
    const { error } = await supabase.from("assignments").delete().eq("id", id);
    if (error) throw error;
  },

  // Full grade records for one student — powers the per-student grade modal.
  async fetchStudentAssignmentGrades(assignmentIds, studentId) {
    if (!assignmentIds.length) return [];
    const { data, error } = await supabase
      .from("assignment_grades")
      .select("assignment_id, score, note, graded_at, created_at")
      .in("assignment_id", assignmentIds)
      .eq("student_id", studentId);
    if (error) throw error;
    return data;
  },

  // Rows are passed through verbatim — caller owns score/note/graded_at so it
  // can null graded_at when a score is cleared. created_at is never sent, so the
  // DB default fills it on insert and the existing value survives on update.
  async upsertAssignmentGrades(rows) {
    const { error } = await supabase
      .from("assignment_grades")
      .upsert(rows, { onConflict: "assignment_id,student_id" });
    if (error) throw error;
  },

  // Computed overall grade per student — read from the view, never recompute.
  async fetchPeriodGrades(cstId, periodId) {
    const { data, error } = await supabase
      .from("student_period_grades")
      .select("student_id, period_score, graded_count, total_assignments")
      .eq("class_subject_teacher_id", cstId)
      .eq("grading_period_id", periodId)
      .not("student_id", "is", null);
    if (error) throw error;
    return data;
  },

  // Every period's score for a section in one shot — powers the roster's
  // per-period columns + weighted Overall (pivoted client-side by period_order).
  async fetchAllPeriodGrades(cstId) {
    const { data, error } = await supabase
      .from("student_period_grades")
      .select("student_id, grading_period_id, period_score")
      .eq("class_subject_teacher_id", cstId)
      .not("student_id", "is", null);
    if (error) throw error;
    return data;
  },

  // ── Attendance ──────────────────────────────────────────────
  async fetchAttendanceSheet(classId, date) {
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
  },

  async upsertAttendance(classId, date, rows, recordedBy) {
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
  },

  // ── Schedule ────────────────────────────────────────────────
  async fetchScheduleByClass(classId) {
    const { data, error } = await supabase
      .from("schedules")
      .select(
        `
        id, day_of_week, start_time, end_time,
        subjects!subject_id(id, name, color),
        teachers!teacher_id(id, first_name, last_name),
        rooms!room_id(id, name)
      `,
      )
      .eq("class_id", classId)
      .order("day_of_week")
      .order("start_time");
    if (error) throw error;
    return data;
  },

  // ── Shared reference data (for forms) ───────────────────────
  async fetchSubjects() {
    const { data, error } = await supabase
      .from("subjects")
      .select("id, name, code, color")
      .order("name");
    if (error) throw error;
    return data;
  },

  async fetchTeachers() {
    const { data, error } = await supabase
      .from("teachers")
      .select("id, first_name, last_name")
      .order("last_name");
    if (error) throw error;
    return data;
  },

  async fetchRooms() {
    const { data, error } = await supabase
      .from("rooms")
      .select("id, name, capacity")
      .order("name");
    if (error) throw error;
    return data;
  },

  // ── Subjects catalog (global — retained) ────────────────────
  async fetchSubjectsDetailed() {
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
  },

  // ── Student 360 (read-only) ─────────────────────────────────
  async fetchStudentAttendance(studentId) {
    const { data, error } = await supabase
      .from("attendance")
      .select("status")
      .eq("student_id", studentId);
    if (error) throw error;
    return data;
  },

  async fetchStudentDiscipline(studentId) {
    const { data, error } = await supabase
      .from("discipline_records")
      .select("id, date, type, severity, resolved, description, resolution")
      .eq("student_id", studentId)
      .order("date", { ascending: false });
    if (error) throw error;
    return data;
  },

  // ── Discipline (write — item 2) ─────────────────────────────
  // Teacher-filed behavior records. reported_by_teacher stamps authorship;
  // reported_by_staff stays null (this console is teacher-scoped).
  async insertDiscipline(payload) {
    const { error } = await supabase.from("discipline_records").insert(payload);
    if (error) throw error;
  },

  async updateDiscipline(id, payload) {
    const { error } = await supabase
      .from("discipline_records")
      .update(payload)
      .eq("id", id);
    if (error) throw error;
  },

  // Per-subject grades come from student_grades (the full-school record the
  // student portal shows), NOT the assignment-derived view. Read-only.
  async fetchStudentSubjectGrades(studentId, periodId) {
    const { data, error } = await supabase
      .from("student_grades")
      .select(
        "score, class_subject_teachers!class_subject_teacher_id(subjects!subject_id(name, color))",
      )
      .eq("student_id", studentId)
      .eq("grading_period_id", periodId);
    if (error) throw error;
    return data;
  },

  // Every posted subject grade for a student, all periods — powers the printable
  // progress report (item 6). Read-only, the full-school student_grades record.
  async fetchStudentAllSubjectGrades(studentId) {
    const { data, error } = await supabase
      .from("student_grades")
      .select(
        "score, grading_period_id, notes, class_subject_teachers!class_subject_teacher_id(subjects!subject_id(name))",
      )
      .eq("student_id", studentId);
    if (error) throw error;
    return data;
  },

  // ── Post grades (item 1) ────────────────────────────────────
  // The grades already posted to the report card for this section + period, so
  // the posting panel can show what's live and pre-fill overrides/comments.
  async fetchPostedGrades(cstId, periodId) {
    const { data, error } = await supabase
      .from("student_grades")
      .select("student_id, score, notes, submitted_at")
      .eq("class_subject_teacher_id", cstId)
      .eq("grading_period_id", periodId);
    if (error) throw error;
    return data;
  },

  // Commit final period grades to the official student_grades record the student
  // portal reads. Upsert on the unique (student, cst, period) key.
  async upsertStudentGrades(rows) {
    const { error } = await supabase.from("student_grades").upsert(rows, {
      onConflict: "student_id,class_subject_teacher_id,grading_period_id",
    });
    if (error) throw error;
  },

  // ── Grade categories (item 8) ───────────────────────────────
  async fetchCategories(cstId) {
    const { data, error } = await supabase
      .from("grade_categories")
      .select("id, name, weight")
      .eq("class_subject_teacher_id", cstId)
      .order("name");
    if (error) throw error;
    return data;
  },

  async insertCategory(payload) {
    const { error } = await supabase.from("grade_categories").insert(payload);
    if (error) throw error;
  },

  async updateCategory(id, payload) {
    const { error } = await supabase
      .from("grade_categories")
      .update(payload)
      .eq("id", id);
    if (error) throw error;
  },

  async deleteCategory(id) {
    // assignments.category_id is ON DELETE SET NULL — assignments survive and
    // fall back to flat weighting.
    const { error } = await supabase
      .from("grade_categories")
      .delete()
      .eq("id", id);
    if (error) throw error;
  },

  // ── Column grade entry (item 4) ─────────────────────────────
  // Every student's score for ONE assignment, for the whole-class entry grid.
  async fetchAssignmentColumn(assignmentId) {
    const { data, error } = await supabase
      .from("assignment_grades")
      .select("student_id, score, note, graded_at")
      .eq("assignment_id", assignmentId);
    if (error) throw error;
    return data;
  },

  // ── Absence summary (item 3) ────────────────────────────────
  // Raw status rows for a section; aggregated client-side into per-student counts.
  async fetchClassAttendance(classId) {
    const { data, error } = await supabase
      .from("attendance")
      .select("student_id, status")
      .eq("class_id", classId);
    if (error) throw error;
    return data;
  },

  // ── Today (item 7) ──────────────────────────────────────────
  async fetchScheduleToday(teacherId, dayOfWeek) {
    const { data, error } = await supabase
      .from("schedules")
      .select(
        `
        id, class_id, subject_id, day_of_week, start_time, end_time,
        classes!class_id(display_name),
        subjects!subject_id(name, color),
        rooms!room_id(name)
      `,
      )
      .eq("teacher_id", teacherId)
      .eq("day_of_week", dayOfWeek)
      .order("start_time");
    if (error) throw error;
    return data;
  },
};

// Demo sandbox: writes land in an in-memory session overlay instead of the
// shared backend; reads stay live with the overlay applied (see demoDb.js).
// A refresh restores pristine data. The first write shows a one-time notice.
let demoNoticeShown = false;
const db = DEMO_MODE
  ? wrapDbForDemo(realDb, {
      onWrite: () => {
        if (demoNoticeShown) return;
        demoNoticeShown = true;
        showToast(t("admin.demo.sandboxNotice"));
      },
    })
  : realDb;

// ───────────────────────────────────────────────────────────────
//  3. UI HELPERS
// ───────────────────────────────────────────────────────────────

// ── Toast ──────────────────────────────────────────────────────
const toastContainer = document.getElementById("toast-container");

function showToast(message, type = "success") {
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  const icon = type === "success" ? "check_circle" : "error";
  toast.innerHTML = `<span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-${icon}"></use></svg></span>${message}`;
  toastContainer.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

// ── Generic Modal ──────────────────────────────────────────────
const modalOverlay = document.getElementById("modal-overlay");
const modalTitle = document.getElementById("modal-title");
const modalForm = document.getElementById("modal-form");
const modalClose = document.getElementById("modal-close");
const modalCancel = document.getElementById("modal-cancel");
const modalSubmit = document.getElementById("modal-submit");

let currentSubmitHandler = null;

function openModal({
  title,
  fields,
  onSubmit,
  submitLabel = t("common.save"),
}) {
  modalTitle.textContent = title;
  modalSubmit.textContent = submitLabel;
  modalForm.innerHTML = "";

  fields.forEach((field) => {
    const group = document.createElement("div");
    group.className = "field-group";

    const label = document.createElement("label");
    label.textContent = field.label;
    label.htmlFor = `modal-field-${field.name}`;
    group.appendChild(label);

    let input;

    if (field.type === "select") {
      input = document.createElement("select");
      input.id = `modal-field-${field.name}`;
      input.name = field.name;
      if (field.required) input.required = true;

      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = field.required
        ? t("common.selectPlaceholder", { label: field.label.toLowerCase() })
        : t("common.none");
      input.appendChild(placeholder);

      (field.options ?? []).forEach((opt) => {
        const o = document.createElement("option");
        o.value = opt.value;
        o.textContent = opt.label;
        if (String(opt.value) === String(field.value)) o.selected = true;
        input.appendChild(o);
      });
    } else if (field.type === "textarea") {
      input = document.createElement("textarea");
      input.id = `modal-field-${field.name}`;
      input.name = field.name;
      input.rows = 3;
      input.value = field.value ?? "";
      if (field.placeholder) input.placeholder = field.placeholder;
    } else {
      input = document.createElement("input");
      input.id = `modal-field-${field.name}`;
      input.type = field.type ?? "text";
      input.name = field.name;
      input.value = field.value ?? "";
      if (field.required) input.required = true;
      if (field.placeholder) input.placeholder = field.placeholder;
      if (field.min != null) input.min = field.min;
      if (field.max != null) input.max = field.max;
      if (field.step != null) input.step = field.step;
    }

    // Disabled fields render but are excluded from FormData on submit — used for
    // read-only context like national_id (registrar-owned).
    if (field.disabled) input.disabled = true;

    group.appendChild(input);

    if (field.help) {
      const help = document.createElement("small");
      help.className = "field-help";
      help.textContent = field.help;
      group.appendChild(help);
    }

    modalForm.appendChild(group);
  });

  if (currentSubmitHandler)
    modalForm.removeEventListener("submit", currentSubmitHandler);

  currentSubmitHandler = async (e) => {
    e.preventDefault();
    const formData = Object.fromEntries(new FormData(modalForm));
    modalSubmit.disabled = true;
    try {
      await onSubmit(formData);
      closeModal();
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      modalSubmit.disabled = false;
    }
  };

  modalForm.addEventListener("submit", currentSubmitHandler);
  modalOverlay.classList.add("active");
}

function closeModal() {
  modalOverlay.classList.remove("active");
  modalForm.innerHTML = "";
  if (currentSubmitHandler) {
    modalForm.removeEventListener("submit", currentSubmitHandler);
    currentSubmitHandler = null;
  }
}

modalClose.addEventListener("click", closeModal);
modalCancel.addEventListener("click", closeModal);

// ── Confirm Modal ──────────────────────────────────────────────
const confirmOverlay = document.getElementById("confirm-overlay");
const confirmMessage = document.getElementById("confirm-message");
const confirmDelete = document.getElementById("confirm-delete");
const confirmCancel = document.getElementById("confirm-cancel");

let confirmHandler = null;

function openConfirm(message, onConfirm) {
  confirmMessage.textContent = message;
  confirmHandler = onConfirm;
  confirmOverlay.classList.add("active");
}

function closeConfirm() {
  confirmOverlay.classList.remove("active");
  confirmHandler = null;
}

confirmDelete.addEventListener("click", async () => {
  if (!confirmHandler) return;
  confirmDelete.disabled = true;
  try {
    await confirmHandler();
    closeConfirm();
  } catch (err) {
    showToast(err.message, "error");
  } finally {
    confirmDelete.disabled = false;
  }
});
confirmCancel.addEventListener("click", closeConfirm);

// ── Student drawer ─────────────────────────────────────────────
const drawerOverlay = document.getElementById("drawer-overlay");
const drawerTitle = document.getElementById("drawer-title");
const drawerBody = document.getElementById("drawer-body");

function openDrawer() {
  drawerOverlay.classList.add("active");
}
function closeDrawer() {
  drawerOverlay.classList.remove("active");
}
document.getElementById("drawer-close").addEventListener("click", closeDrawer);
// The only dialog that still closes on a backdrop click: this drawer is a
// read-only detail view with nothing to lose, and dismissing a drawer that
// way is what users expect. Every dialog holding input requires an explicit
// close instead.
drawerOverlay.addEventListener("click", (e) => {
  if (e.target === drawerOverlay) closeDrawer();
});

// ── Gradebook: Manage Assignments + per-student grade modals ────
const assignmentsOverlay = document.getElementById("assignments-overlay");
const manageTitle = document.getElementById("manage-title");
const manageBody = document.getElementById("manage-body");

document
  .getElementById("manage-close")
  .addEventListener("click", closeManageAssignments);
document
  .getElementById("manage-done")
  .addEventListener("click", closeManageAssignments);
document
  .getElementById("manage-add")
  .addEventListener("click", () => openAddAssignment());

const sgOverlay = document.getElementById("student-grades-overlay");
const sgTitle = document.getElementById("sg-title");
const sgBody = document.getElementById("sg-body");
const sgSave = document.getElementById("sg-save");

document
  .getElementById("sg-close")
  .addEventListener("click", closeStudentGradesModal);
document
  .getElementById("sg-cancel")
  .addEventListener("click", closeStudentGradesModal);
sgSave.addEventListener("click", saveStudentGrades);

// Per-assignment grade unlock: clicking an Edit button unlocks ONLY that one
// score input (delegated because sgBody is re-rendered on every open).
sgBody.addEventListener("click", (e) => {
  const btn = e.target.closest(".sg-edit-btn");
  if (!btn) return;
  const input = sgBody.querySelector(
    `.sg-score[data-assignment="${btn.dataset.assignment}"]`,
  );
  if (input) {
    input.readOnly = false;
    input.classList.remove("sg-locked");
    input.focus();
    input.select();
  }
  btn.remove();
});

// ── Grade categories modal (item 8) ────────────────────────────
const categoriesOverlay = document.getElementById("categories-overlay");
const categoriesTitle = document.getElementById("categories-title");
const categoriesBody = document.getElementById("categories-body");
const categoriesTotal = document.getElementById("categories-total");

document
  .getElementById("categories-close")
  .addEventListener("click", closeCategoriesModal);
document
  .getElementById("categories-done")
  .addEventListener("click", closeCategoriesModal);
document
  .getElementById("categories-add")
  .addEventListener("click", () => openCategoryForm());

// ── Post grades modal (item 1) ─────────────────────────────────
const pgOverlay = document.getElementById("post-grades-overlay");
const pgTitle = document.getElementById("pg-title");
const pgBody = document.getElementById("pg-body");
const pgSave = document.getElementById("pg-save");

document.getElementById("pg-close").addEventListener("click", closePostGrades);
document.getElementById("pg-cancel").addEventListener("click", closePostGrades);
pgSave.addEventListener("click", savePostGrades);

// ── Column grade entry modal (item 4) ──────────────────────────
const cgOverlay = document.getElementById("column-grades-overlay");
const cgTitle = document.getElementById("cg-title");
const cgBody = document.getElementById("cg-body");
const cgSave = document.getElementById("cg-save");

document
  .getElementById("cg-close")
  .addEventListener("click", closeColumnGrades);
document
  .getElementById("cg-cancel")
  .addEventListener("click", closeColumnGrades);
cgSave.addEventListener("click", saveColumnGrades);

// Print progress report from the open student drawer (item 6).
document
  .getElementById("drawer-print")
  .addEventListener("click", printStudentReport);

// Discipline add/edit launched from the drawer (item 2). Delegated because the
// drawer body is re-rendered on every open.
drawerBody.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  if (btn.dataset.action === "add-discipline") {
    openAddDiscipline();
  } else if (btn.dataset.action === "edit-discipline") {
    const rec = (_drawerData.discipline ?? []).find(
      (r) => String(r.id) === btn.dataset.id,
    );
    if (rec) openEditDiscipline(rec);
  }
});

// ── Table helpers ──────────────────────────────────────────────
function renderEmptyRow(tbodyId, colspan, message = t("common.noRecords")) {
  const tbody = document.getElementById(tbodyId);
  if (tbody)
    tbody.innerHTML = `<tr><td colspan="${colspan}" class="loading-cell">${message}</td></tr>`;
}

function renderErrorRow(tbodyId, colspan) {
  renderEmptyRow(tbodyId, colspan, t("common.loadFailed"));
}

function makeActionBtn(
  icon,
  label,
  onClick,
  danger = false,
  adminOnly = false,
) {
  const btn = document.createElement("button");
  btn.className = `btn-icon${danger ? " danger" : ""}`;
  btn.type = "button";
  btn.innerHTML = `<span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-${icon}"></use></svg></span>`;
  // Admin-restricted icon buttons reuse the single gate: applyAdminLock sets the
  // tooltip to the Spanish message and makes the click a no-op. Everyone else
  // gets the normal label tooltip + real handler.
  if (adminOnly && !IS_ADMIN) {
    applyAdminLock(btn);
  } else {
    btn.title = label;
    btn.addEventListener("click", onClick);
  }
  return btn;
}

function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c],
  );
}

// Weekday label for a day_of_week (1=Mon … 7=Sun). Resolved at call time so
// the active language applies (rebuilt fresh on the post-switch reload).
function dayName(dow) {
  const key = dayKey(Number(dow));
  return key ? t(`common.days.${key}`) : "";
}

// Distinct class options across the teacher's subject-sections.
function teacherClassOptions() {
  const seen = new Set();
  const opts = [];
  myClassesCache.forEach((cst) => {
    if (seen.has(cst.class_id)) return;
    seen.add(cst.class_id);
    opts.push({
      value: cst.class_id,
      label: cst.classes?.display_name ?? `Class ${cst.class_id}`,
    });
  });
  return opts;
}

// Current grading period = the one whose date range contains today,
// otherwise the first period (demo seed dates may be in the past).
// Single source of truth for the gradebook default AND the roster Overall.
function getCurrentPeriodId() {
  const today = new Date().toISOString().split("T")[0];
  const inRange = PERIODS.find(
    (p) => p.start_date <= today && today <= p.end_date,
  );
  return (inRange ?? PERIODS[0])?.id ?? "";
}

// Grade colour band: red <70, amber 70–74.99, green ≥75. Reuses the
// shared .score-low / .score-mid / .score-high classes from style.css.
function gradeBandClass(score) {
  if (score == null) return "";
  const n = Number(score);
  if (n < 70) return "score-low";
  if (n < 75) return "score-mid";
  return "score-high";
}

// Render one grade cell: colored value, or a neutral placeholder when ungraded
// (never a colored zero). Used by the roster grade columns + Overall.
function gradeCellHtml(score) {
  return score == null
    ? '<span class="text-muted">—</span>'
    : `<b class="${gradeBandClass(score)}">${Number(score).toFixed(1)}</b>`;
}

// Weighted Overall across the periods that have a grade, renormalizing the
// grading_periods.weight values so a missing period is excluded (never 0).
function weightedOverall(scoreByOrder) {
  let sum = 0;
  let wTot = 0;
  PERIODS.forEach((p) => {
    const s = scoreByOrder[p.period_order];
    if (s == null) return;
    const w = Number(p.weight) || 0;
    sum += Number(s) * w;
    wTot += w;
  });
  return wTot > 0 ? sum / wTot : null;
}

// Display status for one (student, assignment) grade record. No submission date
// exists in the schema, so "Late" derives from graded_at vs the due_date.
function gradeStatus(grade, dueDate) {
  if (!grade || grade.score == null)
    return { label: t("enums.gradeStatus.notGraded"), cls: "badge-neutral" };
  if (dueDate && grade.graded_at && grade.graded_at.slice(0, 10) > dueDate)
    return { label: t("enums.gradeStatus.late"), cls: "badge-warning" };
  return { label: t("enums.gradeStatus.graded"), cls: "badge-success" };
}

// "2024-12-13" / ISO timestamp → locale-aware friendly date, or "—" when absent.
function formatDate(value) {
  if (!value) return "—";
  return i18nFormatDate(value);
}

// ───────────────────────────────────────────────────────────────
//  4. NAVIGATION (class-first)
// ───────────────────────────────────────────────────────────────
const sections = document.querySelectorAll(".view-section");
const navLinks = document.querySelectorAll(".sidebar a[data-page]");

let myClassesCache = [];
let currentClass = null; // { cstId, classId, subjectId, names, color }
const loaded = { today: false, subjects: false, settings: false };

function showSection(page) {
  sections.forEach((s) => s.classList.remove("active"));
  navLinks.forEach((a) => a.classList.remove("active"));

  const target = document.getElementById(`view-${page}`);
  if (target) target.classList.add("active");

  // Class workspace keeps "My Classes" highlighted in the sidebar.
  const navPage = page === "class" ? "myclasses" : page;
  document
    .querySelector(`.sidebar a[data-page="${navPage}"]`)
    ?.classList.add("active");

  // Today's schedule is static for the session, so load it once (a reload
  // refreshes it). My Classes stays live because its student counts are mutable.
  if (page === "today" && !loaded.today) {
    loaded.today = true;
    loadToday();
  }
  if (page === "myclasses") loadMyClasses();
  if (page === "subjects" && !loaded.subjects) {
    loaded.subjects = true;
    loadSubjects();
  }
  if (page === "settings" && !loaded.settings) {
    loaded.settings = true;
    loadSettings();
  }
}

// Read-only Settings for the teacher context. Resolves the demo teacher record
// and builds the normalized adapter consumed by the shared renderer.
async function loadSettings() {
  const root = document.getElementById("settings-root");
  if (!root) return;

  let teacher;
  try {
    teacher = await db.fetchTeacherFull(TEACHER_ID);
  } catch (err) {
    console.error("loadSettings:", err);
    loaded.settings = false; // allow a retry on next visit
    root.innerHTML = `<div class="loading-cell">${t("common.couldNotLoadProfile")}</div>`;
    return;
  }

  if (!teacher) {
    // No teachers row for this account — the shared renderer needs one, so
    // explain rather than dereferencing a null record.
    root.innerHTML = `<div class="loading-cell">${t("admin.today.noTeacherRecordBody")}</div>`;
    return;
  }

  const tr = teacher;
  const statusLabel = (v) => (v ? t(`enums.studentStatus.${v}`) : null);

  const adapter = {
    context: "teacher",
    identity: {
      displayName: `${tr.first_name} ${tr.last_name}`,
      subtitle: `${t("settings.roleTeacher")}${tr.specialization ? " · " + tr.specialization : ""}`,
      avatarIcon: "co_present",
      roleBadge: {
        text: t("settings.roleTeacher"),
        className: "badge-primary",
      },
    },
    personal: [
      {
        label: t("settings.fields.firstName"),
        value: tr.first_name,
        icon: "badge",
      },
      {
        label: t("settings.fields.lastName"),
        value: tr.last_name,
        icon: "badge",
      },
      {
        label: t("settings.fields.nationalId"),
        value: tr.national_id,
        icon: "fingerprint",
      },
      {
        label: t("settings.fields.specialization"),
        value: tr.specialization,
        icon: "menu_book",
      },
      { label: t("settings.fields.email"), value: tr.email, icon: "mail" },
      { label: t("settings.fields.phone"), value: tr.phone, icon: "call" },
      { label: t("settings.fields.address"), value: tr.address, icon: "home" },
      {
        label: t("settings.fields.hireDate"),
        value: tr.hire_date ? formatDate(tr.hire_date) : null,
        icon: "event",
      },
      {
        label: t("settings.fields.status"),
        value: statusLabel(tr.status),
        icon: "info",
      },
    ],
    username: tr.email,
    email: tr.email,
  };

  renderSettings(root, adapter);
}

const closeNav = initSidebarToggle();

navLinks.forEach((link) => {
  link.addEventListener("click", (e) => {
    e.preventDefault();
    showSection(link.dataset.page);
    closeNav();
  });
});

// See the admin console's logout: preventDefault stops the <a> from navigating
// before signOut() has finished, which otherwise bounces the user right back.
document.getElementById("logout-btn")?.addEventListener("click", async (e) => {
  e.preventDefault();
  await signOut();
  window.location.replace("/login.html");
});

// Cross-portal links, revealed only when the target would accept this caller.
// `role` is the signed-in profiles.role resolved by the guard above — NOT
// IS_ADMIN, which is a visual lock on admin-restricted controls in this console
// and is deliberately always false. The student portal is keyed on a students
// row rather than a role: an account can hold both (the demo account does), and
// that row is exactly what the portal looks up.
async function initCrossPortalLinks() {
  const links = [
    { id: "admin-console-link", path: "/admin", allowed: role === "admin" },
    {
      id: "student-portal-link",
      path: "/",
      allowed: (await fetchStudentId(session.user.id)) != null,
    },
  ];

  for (const { id, path, allowed } of links) {
    const link = document.getElementById(id);
    if (!link || !allowed) continue;
    link.hidden = false;
    link.addEventListener("click", async (e) => {
      e.preventDefault();
      if (!(await getSession())) {
        window.location.replace("/login.html");
        return;
      }
      window.location.href = path;
    });
  }
}

initCrossPortalLinks();
document.querySelector(".profile-photo")?.addEventListener("click", () => {
  showSection("settings");
  // Snap to Account & Profile (default sub-tab on first render; re-select it
  // when re-opening after the user switched to another settings sub-tab).
  document
    .querySelector('#settings-root .settings-rail-item[data-section="account"]')
    ?.click();
});
initTheme();
bindThemeToggle(document.querySelector(".theme-toggler"));

// Resolve this view's language (stored "smp-lang-admin" → browser → English)
// and translate the static markup before any section renders.
initI18n("teacher");
applyTranslations();

document.getElementById("class-back-btn")?.addEventListener("click", () => {
  showSection("myclasses");
});

document.querySelectorAll(".class-subtab").forEach((btn) => {
  btn.addEventListener("click", () => openClassTab(btn.dataset.tab));
});

// ───────────────────────────────────────────────────────────────
//  5. MY CLASSES LANDING
// ───────────────────────────────────────────────────────────────
async function loadMyClasses() {
  const grid = document.getElementById("myclasses-grid");
  const subtitle = document.getElementById("myclasses-subtitle");
  if (!TEACHER_ID || !ACTIVE_YEAR) {
    if (subtitle) subtitle.textContent = "";
    grid.innerHTML = `<div class="loading-cell">${
      TEACHER_ID
        ? t("admin.today.contextNotLoaded")
        : t("admin.today.noTeacherRecordBody")
    }</div>`;
    return;
  }
  grid.innerHTML = skeletonCardItems(3);

  try {
    const [classes, counts] = await Promise.all([
      db.fetchMyClasses(TEACHER_ID, ACTIVE_YEAR.id),
      db.fetchActiveCountByClass(),
    ]);
    myClassesCache = classes;

    const totalStudents = [...new Set(classes.map((c) => c.class_id))].reduce(
      (sum, classId) => sum + (counts[classId] ?? 0),
      0,
    );
    subtitle.textContent = t("admin.myclasses.summary", {
      year: ACTIVE_YEAR.name,
      sections: tn("admin.sections", classes.length),
      students: tn("admin.students", totalStudents),
    });

    renderQuickStats(classes.length, totalStudents);
    renderMyClasses(classes, counts);
  } catch (err) {
    console.error(err);
    grid.innerHTML = `<div class="loading-cell">${t("admin.myclasses.loadFailed")}</div>`;
  }
}

function renderMyClasses(classes, counts) {
  const grid = document.getElementById("myclasses-grid");
  if (!classes.length) {
    grid.innerHTML = `<div class="loading-cell">${t("admin.myclasses.empty")}</div>`;
    return;
  }

  grid.innerHTML = "";
  classes.forEach((cst) => {
    const color = cst.subjects?.color || "var(--color-primary)";
    const count = counts[cst.class_id] ?? 0;
    const card = document.createElement("button");
    card.type = "button";
    card.className = "class-card";
    card.style.setProperty("--accent", color);
    card.innerHTML = `
      <span class="class-card-accent"></span>
      <div class="class-card-body">
        <h3 class="class-card-subject">${escapeHtml(cst.subjects?.name ?? "—")}</h3>
        <p class="class-card-section">${escapeHtml(cst.classes?.display_name ?? "—")} · ${escapeHtml(
          cst.classes?.grade_levels?.name ?? "",
        )}</p>
        <p class="class-card-count">
          <span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-group"></use></svg></span>
          ${tn("admin.students", count)}
        </p>
      </div>
      <span class="material-symbols-outlined class-card-arrow"><svg aria-hidden="true"><use href="#icon-chevron_right"></use></svg></span>
    `;
    card.addEventListener("click", () => openClassWorkspace(cst));
    grid.appendChild(card);
  });
}

function renderQuickStats(sectionCount, totalStudents) {
  const el = document.getElementById("quick-stats-list");
  el.innerHTML = `
    <span class="qstat"><span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-co_present"></use></svg></span>${tn("admin.sections", sectionCount)}</span>
    <span class="qstat"><span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-group"></use></svg></span>${tn("admin.students", totalStudents)}</span>
    <span class="qstat"><span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-calendar_today"></use></svg></span>${escapeHtml(ACTIVE_YEAR.name)}</span>`;
}

// ───────────────────────────────────────────────────────────────
//  6. CLASS WORKSPACE SHELL
// ───────────────────────────────────────────────────────────────
function openClassWorkspace(cst, initialTab = "roster") {
  currentClass = {
    cstId: cst.id,
    classId: cst.class_id,
    subjectId: cst.subject_id,
    className: cst.classes?.display_name ?? "—",
    subjectName: cst.subjects?.name ?? "—",
    color: cst.subjects?.color || "var(--color-primary)",
    gradeLevel: cst.classes?.grade_levels?.name ?? "",
  };

  document.getElementById("class-ws-title").textContent =
    `${currentClass.subjectName} · ${currentClass.className}`;
  document.getElementById("class-ws-subtitle").textContent =
    `${currentClass.gradeLevel} · ${ACTIVE_YEAR.name}`;
  document.getElementById("class-ws-dot").style.background = currentClass.color;

  showSection("class");
  openClassTab(initialTab);
}

function openClassTab(tab) {
  document
    .querySelectorAll(".class-subtab")
    .forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));

  const content = document.getElementById("class-tab-content");
  const renderers = {
    roster: renderRosterTab,
    gradebook: renderGradebookTab,
    attendance: renderAttendanceTab,
    schedule: renderScheduleTab,
  };
  (renderers[tab] ?? renderRosterTab)(content);
}

// ───────────────────────────────────────────────────────────────
//  7. ROSTER TAB (+ student drawer)
// ───────────────────────────────────────────────────────────────

// The roster is a CSS grid, so the column count has to reach the stylesheet:
// one grade column per grading period the year actually has, plus Overall.
// Costa Rica's MEP year runs two periodos, but a private colegio on three
// trimestres is equally valid — so the count comes from the data, never a
// literal. Kept in sync with the header/row cells, which map over PERIODS.
function rosterColsStyle() {
  return `--roster-cols: ${PERIODS.length + 1}`;
}

function renderRosterTab(content) {
  content.innerHTML = `
    <div class="view-toolbar">
      <div class="search-bar">
        <span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-search"></use></svg></span>
        <input type="search" id="roster-search" placeholder="${t("admin.roster.searchPlaceholder")}" />
      </div>
      <button class="btn btn-primary" id="btn-add-student">
        <span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-person_add"></use></svg></span> ${t("admin.roster.addStudent")}
      </button>
    </div>
    <div class="recent-activity">
      <div class="roster-list" id="roster-list" style="${rosterColsStyle()}">
        <div class="roster-head">
          <div class="roster-row-cells">
            <span>${t("admin.roster.name")}</span>
            ${PERIODS.map((p) => `<span>${escapeHtml(p.name)}</span>`).join("")}
            <span>${t("admin.roster.overall")}</span>
          </div>
        </div>
        <div id="roster-body">
          ${skeletonBlock(5)}
        </div>
      </div>
    </div>`;

  bindAdminAction(document.getElementById("btn-add-student"), openAddStudent);

  let searchTimeout;
  document.getElementById("roster-search").addEventListener("input", (e) => {
    clearTimeout(searchTimeout);
    const q = e.target.value.trim().toLowerCase();
    searchTimeout = setTimeout(() => renderRosterTable(filterRoster(q)), 250);
  });

  loadRoster();
}

let _rosterCache = [];
let _rosterPeriodGrades = {}; // student_id → { [period_order]: period_score }

async function loadRoster() {
  try {
    const [roster, periodGrades] = await Promise.all([
      db.fetchRoster(currentClass.classId),
      db.fetchAllPeriodGrades(currentClass.cstId),
    ]);
    _rosterCache = roster;

    const orderByPeriodId = Object.fromEntries(
      PERIODS.map((p) => [p.id, p.period_order]),
    );
    _rosterPeriodGrades = {};
    periodGrades.forEach((g) => {
      const order = orderByPeriodId[g.grading_period_id];
      if (order == null) return;
      (_rosterPeriodGrades[g.student_id] ??= {})[order] = g.period_score;
    });

    renderRosterTable(_rosterCache);
  } catch (err) {
    console.error(err);
    const body = document.getElementById("roster-body");
    if (body)
      body.innerHTML = `<div class="loading-cell">${t("common.loadFailed")}</div>`;
  }
}

function filterRoster(q) {
  if (!q) return _rosterCache;
  return _rosterCache.filter(
    (s) =>
      s.first_name?.toLowerCase().includes(q) ||
      s.last_name?.toLowerCase().includes(q) ||
      s.email?.toLowerCase().includes(q) ||
      s.enrollment_number?.toLowerCase().includes(q),
  );
}

function renderRosterTable(students) {
  const body = document.getElementById("roster-body");
  if (!body) return;
  if (!students.length) {
    body.innerHTML = `<div class="loading-cell">${t("admin.roster.empty")}</div>`;
    return;
  }

  body.innerHTML = "";
  students.forEach((student) => {
    const fullName = `${student.last_name}, ${student.first_name}`;
    const scores = _rosterPeriodGrades[student.id] ?? {};
    const overall = weightedOverall(scores);

    const row = document.createElement("div");
    row.className = "roster-row";

    // Clickable unit — the whole cells block opens the student-360 drawer.
    const cells = document.createElement("div");
    cells.className = "roster-row-cells";
    cells.setAttribute("role", "button");
    cells.tabIndex = 0;
    cells.innerHTML = `
      <span class="roster-name">${escapeHtml(fullName)}</span>
      ${PERIODS.map(
        (p) =>
          `<span class="roster-grade">${gradeCellHtml(scores[p.period_order])}</span>`,
      ).join("")}
      <span class="roster-grade">${gradeCellHtml(overall)}</span>`;
    cells.addEventListener("click", () => openStudentDrawer(student));
    cells.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openStudentDrawer(student);
      }
    });

    // Action rail — lives outside the clickable cells; revealed on hover/focus.
    const rail = document.createElement("div");
    rail.className = "roster-row-rail";
    rail.appendChild(
      makeActionBtn(
        "edit",
        t("common.edit"),
        (e) => {
          e.stopPropagation();
          openEditStudent(student);
        },
        false,
        true,
      ),
    );
    rail.appendChild(
      makeActionBtn(
        "delete",
        t("common.delete"),
        (e) => {
          e.stopPropagation();
          confirmDeleteStudent(
            student.id,
            `${student.first_name} ${student.last_name}`,
          );
        },
        true,
        true,
      ),
    );

    row.append(cells, rail);
    body.appendChild(row);
  });
}

let _drawerStudent = null;
let _drawerData = {};

async function openStudentDrawer(student) {
  _drawerStudent = student;
  drawerTitle.textContent = `${student.first_name} ${student.last_name}`;
  drawerBody.innerHTML = skeletonBlock();
  openDrawer();

  const periodId = getCurrentPeriodId();
  const periodName = PERIODS.find((p) => p.id === periodId)?.name ?? "";

  // Each section degrades independently — one failure shouldn't blank the rest.
  const [contacts, attendance, discipline, subjectGrades] = await Promise.all([
    db.fetchStudentContacts(student.id).catch(() => []),
    db.fetchStudentAttendance(student.id).catch(() => []),
    db.fetchStudentDiscipline(student.id).catch(() => []),
    db.fetchStudentSubjectGrades(student.id, periodId).catch(() => []),
  ]);
  _drawerData = { contacts, attendance, discipline, subjectGrades };

  const photo = student.photo_url
    ? `<img class="drawer-photo" src="${escapeHtml(student.photo_url)}" alt="" referrerpolicy="no-referrer" />`
    : `<div class="drawer-photo drawer-photo-empty"><span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-person"></use></svg></span></div>`;

  drawerBody.innerHTML = `
    <div class="drawer-section drawer-identity">
      ${photo}
      <ul class="drawer-contact">
        <li><span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-badge"></use></svg></span> ${escapeHtml(student.enrollment_number ?? "—")}</li>
        <li><span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-fingerprint"></use></svg></span> ${escapeHtml(student.national_id ?? "—")}</li>
        <li><span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-cake"></use></svg></span> ${escapeHtml(formatDate(student.date_of_birth))}</li>
        <li><span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-wc"></use></svg></span> ${escapeHtml(genderLabel(student.gender))}</li>
        <li><span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-mail"></use></svg></span> ${escapeHtml(student.email ?? "—")}</li>
        <li><span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-call"></use></svg></span> ${escapeHtml(student.phone ?? "—")}</li>
        <li><span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-home"></use></svg></span> ${escapeHtml(student.address ?? "—")}</li>
        <li><span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-info"></use></svg></span> ${escapeHtml(student.status ?? "—")}</li>
      </ul>
    </div>
    <div class="drawer-section">
      <h3>${t("admin.drawer.attendance")}</h3>
      ${renderDrawerAttendance(attendance)}
    </div>
    <div class="drawer-section">
      <h3>${periodName ? t("admin.drawer.gradesWithPeriod", { period: escapeHtml(periodName) }) : t("admin.drawer.grades")}</h3>
      ${renderDrawerSubjectGrades(subjectGrades)}
    </div>
    <div class="drawer-section">
      <div class="drawer-section-head">
        <h3>${t("admin.drawer.discipline")}</h3>
        <button type="button" class="link-btn" data-action="add-discipline">${t("admin.drawer.addRecord")}</button>
      </div>
      ${renderDrawerDiscipline(discipline)}
    </div>
    <div class="drawer-section">
      <h3>${t("admin.drawer.guardians")}</h3>
      ${renderDrawerGuardians(contacts)}
    </div>`;
}

function renderDrawerGuardians(contacts) {
  if (!contacts.length)
    return `<p class="drawer-muted">${t("admin.drawer.noGuardians")}</p>`;
  return contacts
    .map((c) => {
      const g = c.guardians ?? {};
      const primary = c.is_primary
        ? `<span class="badge badge-primary">${t("admin.drawer.primary")}</span>`
        : "";
      return `
      <div class="drawer-card">
        <div class="drawer-card-head">
          <b>${escapeHtml(g.first_name ?? "")} ${escapeHtml(g.last_name ?? "")}</b>
          <span class="drawer-rel">${escapeHtml(g.relationship ?? t("admin.drawer.guardianRel"))}</span>
          ${primary}
        </div>
        <ul class="drawer-contact">
          ${g.phone ? `<li><span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-call"></use></svg></span> ${escapeHtml(g.phone)}</li>` : ""}
          ${g.alt_phone ? `<li><span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-call"></use></svg></span> ${escapeHtml(g.alt_phone)} (${t("admin.drawer.alt")})</li>` : ""}
          ${g.email ? `<li><span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-mail"></use></svg></span> ${escapeHtml(g.email)}</li>` : ""}
        </ul>
      </div>`;
    })
    .join("");
}

function renderDrawerAttendance(rows) {
  if (!rows.length)
    return `<p class="drawer-muted">${t("admin.drawer.noAttendance")}</p>`;
  const counts = { present: 0, absent: 0, late: 0, excused: 0 };
  rows.forEach((r) => {
    if (counts[r.status] != null) counts[r.status] += 1;
  });
  const rate = Math.round(((counts.present + counts.late) / rows.length) * 100);
  return `
    <div class="drawer-attendance">
      <span class="att-chip att-present">${counts.present} ${t("enums.attendanceWord.present")}</span>
      <span class="att-chip att-absent">${counts.absent} ${t("enums.attendanceWord.absent")}</span>
      <span class="att-chip att-late">${counts.late} ${t("enums.attendanceWord.late")}</span>
      <span class="att-chip att-excused">${counts.excused} ${t("enums.attendanceWord.excused")}</span>
    </div>
    <p class="drawer-muted">${tn("admin.drawer.attendanceRate", rows.length, { rate, count: rows.length })}</p>`;
}

function renderDrawerSubjectGrades(rows) {
  if (!rows.length)
    return `<p class="drawer-muted">${t("admin.drawer.noGrades")}</p>`;
  return `<ul class="drawer-grades">${rows
    .map((r) => {
      const subject = r.class_subject_teachers?.subjects?.name ?? "—";
      const score = r.score;
      const cell =
        score == null
          ? '<span class="text-muted">—</span>'
          : `<b class="${gradeBandClass(score)}">${Number(score).toFixed(1)}</b>`;
      return `<li><span>${escapeHtml(subject)}</span>${cell}</li>`;
    })
    .sort()
    .join("")}</ul>`;
}

function renderDrawerDiscipline(rows) {
  if (!rows.length)
    return `<p class="drawer-muted">${t("admin.drawer.noDiscipline")}</p>`;
  const sevBadge = {
    low: "badge-neutral",
    medium: "badge-warning",
    high: "badge-danger",
  };
  return rows
    .map((r) => {
      const sev = sevBadge[r.severity] ?? "badge-neutral";
      const sevLabel = r.severity
        ? t(`enums.disciplineSeverity.${r.severity}`)
        : "—";
      const state = r.resolved
        ? `<span class="badge badge-success">${t("enums.disciplineState.resolved")}</span>`
        : `<span class="badge badge-warning">${t("enums.disciplineState.open")}</span>`;
      return `
      <div class="drawer-card">
        <div class="drawer-card-head">
          <b>${escapeHtml(r.type ?? t("admin.drawer.incident"))}</b>
          <span class="badge ${sev}">${escapeHtml(sevLabel)}</span>
          ${state}
          <button type="button" class="btn-icon drawer-card-edit" title="${t("common.edit")}"
            data-action="edit-discipline" data-id="${r.id}">
            <span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-edit"></use></svg></span>
          </button>
        </div>
        <p class="drawer-muted">${escapeHtml(r.date ?? "")}${r.description ? " · " + escapeHtml(r.description) : ""}</p>
        ${r.resolved && r.resolution ? `<p class="drawer-muted">${t("admin.drawer.resolutionPrefix")}${escapeHtml(r.resolution)}</p>` : ""}
      </div>`;
    })
    .join("");
}

async function openAddStudent() {
  openModal({
    title: t("admin.form.addStudentTitle", { class: currentClass.className }),
    submitLabel: t("admin.roster.addStudent"),
    fields: [
      {
        name: "enrollment_number",
        label: t("admin.form.enrollmentShort"),
        type: "text",
        required: true,
        placeholder: t("admin.form.enrollmentPlaceholder"),
      },
      {
        name: "first_name",
        label: t("admin.form.firstName"),
        type: "text",
        required: true,
      },
      {
        name: "last_name",
        label: t("admin.form.lastName"),
        type: "text",
        required: true,
      },
      { name: "email", label: t("admin.form.email"), type: "email" },
      { name: "phone", label: t("admin.form.phone"), type: "text" },
      {
        name: "date_of_birth",
        label: t("admin.form.dateOfBirth"),
        type: "date",
      },
      {
        name: "gender",
        label: t("admin.form.gender"),
        type: "select",
        options: genderOptions(),
      },
      {
        name: "enrollment_date",
        label: t("admin.form.enrollmentDate"),
        type: "date",
        value: new Date().toISOString().split("T")[0],
      },
      { name: "address", label: t("admin.form.address"), type: "textarea" },
      { name: "photo_url", label: t("admin.form.photoUrl"), type: "url" },
      {
        name: "class_id",
        label: t("admin.form.class"),
        type: "select",
        required: true,
        value: currentClass.classId,
        options: teacherClassOptions(),
      },
    ],
    onSubmit: async (formData) => {
      await db.insertStudent({
        enrollment_number: formData.enrollment_number.trim(),
        first_name: formData.first_name.trim(),
        last_name: formData.last_name.trim(),
        email: formData.email?.trim() || null,
        phone: formData.phone?.trim() || null,
        date_of_birth: formData.date_of_birth || null,
        gender: formData.gender || null,
        enrollment_date: formData.enrollment_date || null,
        address: formData.address?.trim() || null,
        photo_url: formData.photo_url?.trim() || null,
        class_id: Number(formData.class_id),
        status: "active",
      });
      showToast(
        t("admin.toast.studentAdded", {
          name: `${formData.first_name} ${formData.last_name}`,
        }),
      );
      loadRoster();
    },
  });
}

function openEditStudent(student) {
  openModal({
    title: t("admin.form.editStudentTitle"),
    submitLabel: t("admin.form.saveChanges"),
    fields: [
      {
        name: "first_name",
        label: t("admin.form.firstName"),
        type: "text",
        required: true,
        value: student.first_name,
      },
      {
        name: "last_name",
        label: t("admin.form.lastName"),
        type: "text",
        required: true,
        value: student.last_name,
      },
      {
        name: "email",
        label: t("admin.form.email"),
        type: "email",
        value: student.email ?? "",
      },
      {
        name: "phone",
        label: t("admin.form.phone"),
        type: "text",
        value: student.phone ?? "",
      },
      {
        name: "national_id",
        label: t("admin.form.nationalIdFull"),
        type: "text",
        value: student.national_id ?? "",
        disabled: true,
        help: t("admin.form.nationalIdHelp"),
      },
      {
        name: "date_of_birth",
        label: t("admin.form.dateOfBirth"),
        type: "date",
        value: student.date_of_birth ?? "",
      },
      {
        name: "gender",
        label: t("admin.form.gender"),
        type: "select",
        value: student.gender ?? "",
        options: genderOptions(),
      },
      {
        name: "enrollment_date",
        label: t("admin.form.enrollmentDate"),
        type: "date",
        value: student.enrollment_date ?? "",
      },
      {
        name: "address",
        label: t("admin.form.address"),
        type: "textarea",
        value: student.address ?? "",
      },
      {
        name: "photo_url",
        label: t("admin.form.photoUrl"),
        type: "url",
        value: student.photo_url ?? "",
      },
      {
        name: "class_id",
        label: t("admin.form.class"),
        type: "select",
        required: true,
        value: currentClass.classId,
        options: teacherClassOptions(),
      },
      {
        name: "status",
        label: t("admin.form.status"),
        type: "select",
        required: true,
        value: student.status,
        options: [
          { value: "active", label: t("enums.studentStatus.active") },
          { value: "inactive", label: t("enums.studentStatus.inactive") },
          { value: "graduated", label: t("enums.studentStatus.graduated") },
          { value: "transferred", label: t("enums.studentStatus.transferred") },
          { value: "withdrawn", label: t("enums.studentStatus.withdrawn") },
        ],
      },
    ],
    onSubmit: async (formData) => {
      // national_id is a disabled field — excluded from FormData, never updated.
      await db.updateStudent(student.id, {
        first_name: formData.first_name.trim(),
        last_name: formData.last_name.trim(),
        email: formData.email?.trim() || null,
        phone: formData.phone?.trim() || null,
        date_of_birth: formData.date_of_birth || null,
        gender: formData.gender || null,
        enrollment_date: formData.enrollment_date || null,
        address: formData.address?.trim() || null,
        photo_url: formData.photo_url?.trim() || null,
        class_id: Number(formData.class_id),
        status: formData.status,
      });
      showToast(
        t("admin.toast.studentUpdated", {
          name: `${formData.first_name} ${formData.last_name}`,
        }),
      );
      loadRoster();
    },
  });
}

function confirmDeleteStudent(id, name) {
  openConfirm(t("admin.confirm.deleteStudent", { name }), async () => {
    await db.deleteStudent(id);
    showToast(t("admin.toast.studentDeleted", { name }));
    loadRoster();
  });
}

// ───────────────────────────────────────────────────────────────
//  8. GRADEBOOK TAB (assignments + scores — the core)
// ───────────────────────────────────────────────────────────────
let gradebookState = null; // { cstId, periodId, assignments, students }

function renderGradebookTab(content) {
  const periodOptions = PERIODS.map(
    (p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`,
  ).join("");

  content.innerHTML = `
    <div class="view-toolbar">
      <div class="toolbar-filters">
        <label for="gradebook-period">${t("admin.gradebook.period")}</label>
        <select id="gradebook-period">${periodOptions}</select>
      </div>
      <div class="toolbar-actions">
        <button class="btn btn-ghost" id="btn-categories">
          <span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-category"></use></svg></span> ${t("admin.gradebook.categories")}
        </button>
        <button class="btn btn-secondary" id="btn-manage-assignments">
          <span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-list_alt"></use></svg></span> ${t("admin.gradebook.manage")}
        </button>
        <button class="btn btn-primary" id="btn-add-assignment">
          <span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-add"></use></svg></span> ${t("admin.gradebook.addAssignment")}
        </button>
        <button class="btn btn-primary" id="btn-post-grades">
          <span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-grading"></use></svg></span> ${t("admin.gradebook.postGrades")}
        </button>
      </div>
    </div>
    <div class="recent-activity">
      <div id="gradebook-grid">${skeletonBlock(4)}</div>
    </div>`;

  const periodSelect = document.getElementById("gradebook-period");
  periodSelect.value = getCurrentPeriodId();
  periodSelect.addEventListener("change", loadGradebook);

  document
    .getElementById("btn-add-assignment")
    .addEventListener("click", openAddAssignment);
  document
    .getElementById("btn-manage-assignments")
    .addEventListener("click", openManageAssignments);
  document
    .getElementById("btn-categories")
    .addEventListener("click", openCategoriesModal);
  document
    .getElementById("btn-post-grades")
    .addEventListener("click", openPostGrades);

  loadGradebook();
}

async function loadGradebook() {
  const grid = document.getElementById("gradebook-grid");
  const periodId = Number(document.getElementById("gradebook-period").value);
  const cstId = currentClass.cstId;
  grid.innerHTML = skeletonBlock(4);

  try {
    const [assignments, roster, periodGrades, categories] = await Promise.all([
      db.fetchAssignments(cstId, periodId),
      db.fetchRoster(currentClass.classId),
      db.fetchPeriodGrades(cstId, periodId),
      db.fetchCategories(cstId),
    ]);
    const students = roster.filter((s) => s.status === "active");

    gradebookState = { cstId, periodId, assignments, students, categories };
    renderGradebook(assignments, students, periodGrades);

    // Keep an open Manage Assignments list in sync after add/edit/delete.
    if (assignmentsOverlay.classList.contains("active"))
      renderManageAssignments();
  } catch (err) {
    console.error(err);
    grid.innerHTML = `<div class="loading-cell">${t("admin.gradebook.loadFailed", { msg: escapeHtml(err.message) })}</div>`;
  }
}

// Clean, scannable table: one row per student → name, current-period grade
// (colored by the standard bands), completion count. Grade entry lives in the
// per-student modal opened by clicking the row.
function renderGradebook(assignments, students, periodGrades) {
  const grid = document.getElementById("gradebook-grid");

  if (!assignments.length) {
    grid.innerHTML = `
      <div class="empty-state">
        <span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-assignment"></use></svg></span>
        <p>${t("admin.gradebook.noAssignments")}</p>
        <p class="empty-sub">${t("admin.gradebook.noAssignmentsSub")}</p>
      </div>`;
    return;
  }
  if (!students.length) {
    grid.innerHTML = `<div class="loading-cell">${t("admin.gradebook.noActiveStudents")}</div>`;
    return;
  }

  const overallMap = {};
  periodGrades.forEach((p) => {
    overallMap[p.student_id] = p;
  });
  const total = assignments.length;

  const bodyRows = students
    .map((s) => {
      const o = overallMap[s.id];
      const score = o && o.period_score != null ? Number(o.period_score) : null;
      const graded = o ? o.graded_count : 0;
      return `<tr class="row-clickable" data-student="${s.id}">
        <td>${escapeHtml(s.last_name)}, ${escapeHtml(s.first_name)}</td>
        <td>${gradeCellHtml(score)}</td>
        <td class="text-muted">${t("admin.gradebook.gradedCount", { graded, total })}</td>
      </tr>`;
    })
    .join("");

  grid.innerHTML = `
    <table class="data-table gradebook-table">
      <thead>
        <tr><th>${t("admin.gradebook.student")}</th><th>${t("admin.gradebook.grade")}</th><th>${t("admin.gradebook.completion")}</th></tr>
      </thead>
      <tbody>${bodyRows}</tbody>
    </table>`;

  grid.querySelectorAll("tr.row-clickable").forEach((tr) => {
    tr.addEventListener("click", () => {
      const s = students.find((x) => String(x.id) === tr.dataset.student);
      if (s) openStudentGradesModal(s);
    });
  });
}

function openAddAssignment() {
  openModal({
    title: t("admin.form.addAssignmentTitle", {
      subject: currentClass.subjectName,
      class: currentClass.className,
    }),
    submitLabel: t("admin.gradebook.addAssignment"),
    fields: [
      {
        name: "name",
        label: t("admin.form.name"),
        type: "text",
        required: true,
        placeholder: t("admin.form.assignmentNamePlaceholder"),
      },
      { name: "due_date", label: t("admin.form.dueDate"), type: "date" },
      {
        name: "max_score",
        label: t("admin.form.maxScore"),
        type: "number",
        required: true,
        value: "100",
        min: 1,
        step: "0.01",
      },
      {
        name: "category_id",
        label: t("admin.form.category"),
        type: "select",
        options: categoryOptions(),
        help: t("admin.form.categoryHelp"),
      },
      { name: "note", label: t("admin.form.note"), type: "textarea" },
    ],
    onSubmit: async (formData) => {
      await db.insertAssignment({
        class_subject_teacher_id: currentClass.cstId,
        grading_period_id: gradebookState.periodId,
        name: formData.name.trim(),
        due_date: formData.due_date || null,
        max_score: Number(formData.max_score),
        category_id: formData.category_id ? Number(formData.category_id) : null,
        note: formData.note?.trim() || null,
      });
      showToast(t("admin.toast.assignmentCreated", { name: formData.name }));
      loadGradebook();
    },
  });
}

function openEditAssignment(assignment) {
  openModal({
    title: t("admin.form.editAssignmentTitle"),
    submitLabel: t("admin.form.saveChanges"),
    fields: [
      {
        name: "name",
        label: t("admin.form.name"),
        type: "text",
        required: true,
        value: assignment.name,
      },
      {
        name: "due_date",
        label: t("admin.form.dueDate"),
        type: "date",
        value: assignment.due_date ?? "",
      },
      {
        name: "max_score",
        label: t("admin.form.maxScore"),
        type: "number",
        required: true,
        value: assignment.max_score,
        min: 1,
        step: "0.01",
      },
      {
        name: "category_id",
        label: t("admin.form.category"),
        type: "select",
        value: assignment.category_id ?? "",
        options: categoryOptions(),
      },
      {
        name: "note",
        label: t("admin.form.note"),
        type: "textarea",
        value: assignment.note ?? "",
      },
    ],
    onSubmit: async (formData) => {
      await db.updateAssignment(assignment.id, {
        name: formData.name.trim(),
        due_date: formData.due_date || null,
        max_score: Number(formData.max_score),
        category_id: formData.category_id ? Number(formData.category_id) : null,
        note: formData.note?.trim() || null,
      });
      showToast(t("admin.toast.assignmentUpdated", { name: formData.name }));
      loadGradebook();
    },
  });
}

function confirmDeleteAssignment(assignment) {
  openConfirm(
    t("admin.confirm.deleteAssignment", { name: assignment.name }),
    async () => {
      await db.deleteAssignment(assignment.id);
      showToast(t("admin.toast.assignmentDeleted", { name: assignment.name }));
      loadGradebook();
    },
  );
}

// ── Manage Assignments modal ───────────────────────────────────
// Assignment add/edit/delete moved here when the gradebook became student
// rows. Reuses the same add/edit/delete flows; the generic form modal stacks
// on top, and loadGradebook() re-renders this list while it's open.
function openManageAssignments() {
  renderManageAssignments();
  assignmentsOverlay.classList.add("active");
}

function closeManageAssignments() {
  assignmentsOverlay.classList.remove("active");
}

function renderManageAssignments() {
  const assignments = gradebookState?.assignments ?? [];
  const periodName =
    PERIODS.find((p) => p.id === gradebookState?.periodId)?.name ?? "";
  manageTitle.textContent = t("admin.manage.title", { period: periodName });

  if (!assignments.length) {
    manageBody.innerHTML = `<p class="drawer-muted">${t("admin.manage.empty")}</p>`;
    return;
  }

  const catById = Object.fromEntries(
    (gradebookState?.categories ?? []).map((c) => [c.id, c.name]),
  );

  manageBody.innerHTML = "";
  assignments.forEach((a) => {
    const item = document.createElement("div");
    item.className = "manage-item";

    const catName = a.category_id ? catById[a.category_id] : null;
    const info = document.createElement("div");
    info.className = "manage-item-info";
    info.innerHTML = `
      <b>${escapeHtml(a.name)}</b>
      <span class="manage-item-meta">/ ${a.max_score}${
        a.due_date ? " · due " + formatDate(a.due_date) : ""
      }${catName ? " · " + escapeHtml(catName) : ""}</span>`;

    const actions = document.createElement("div");
    actions.className = "manage-item-actions";
    actions.appendChild(
      makeActionBtn("edit_note", t("admin.manage.enterScores"), () =>
        openColumnGrades(a),
      ),
    );
    actions.appendChild(
      makeActionBtn("edit", t("common.edit"), () => openEditAssignment(a)),
    );
    actions.appendChild(
      makeActionBtn(
        "delete",
        t("common.delete"),
        () => confirmDeleteAssignment(a),
        true,
      ),
    );

    item.append(info, actions);
    manageBody.appendChild(item);
  });
}

// ── Per-student grade modal (detail view + grade entry) ─────────
let _studentGradesState = null;

async function openStudentGradesModal(student) {
  if (!gradebookState) return;
  const { assignments, periodId } = gradebookState;
  const periodName = PERIODS.find((p) => p.id === periodId)?.name ?? "";

  _studentGradesState = { student, assignments, gradeByAssignment: {} };
  sgTitle.textContent = `${student.first_name} ${student.last_name}`;
  sgBody.innerHTML = skeletonBlock();
  sgOverlay.classList.add("active");

  if (!assignments.length) {
    sgBody.innerHTML = `<p class="drawer-muted">${t("admin.sg.noAssignments", { period: escapeHtml(periodName) })}</p>`;
    return;
  }

  let grades;
  try {
    grades = await db.fetchStudentAssignmentGrades(
      assignments.map((a) => a.id),
      student.id,
    );
  } catch (err) {
    sgBody.innerHTML = `<div class="loading-cell">${t("admin.sg.loadFailed", { msg: escapeHtml(err.message) })}</div>`;
    return;
  }

  const gradeByAssignment = Object.fromEntries(
    grades.map((g) => [g.assignment_id, g]),
  );
  _studentGradesState.gradeByAssignment = gradeByAssignment;

  const rows = assignments
    .map((a) => {
      const g = gradeByAssignment[a.id];
      const score = g?.score ?? "";
      const note = g?.note ?? "";
      const status = gradeStatus(g, a.due_date);
      // Accidental-overwrite guard: an already-graded score renders locked
      // (read-only) behind a per-assignment Edit button. Ungraded scores stay
      // directly editable. This is per-assignment, never a whole-modal toggle.
      const graded = g && g.score != null;
      const scoreField = graded
        ? `<input class="sg-score sg-locked" type="number" min="0" max="${a.max_score}" step="0.01"
            data-assignment="${a.id}" data-original="${score}" value="${score}" readonly />
          <button type="button" class="sg-edit-btn" data-assignment="${a.id}" title="${t("admin.sg.editScore")}" aria-label="${t("admin.sg.editScore")}">
            <span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-edit"></use></svg></span>
          </button>`
        : `<input class="sg-score" type="number" min="0" max="${a.max_score}" step="0.01"
            data-assignment="${a.id}" data-original="${score}" value="${score}" placeholder="—" />`;
      return `
      <div class="sg-row">
        <span class="sg-cell sg-name" title="${escapeHtml(a.name)}">${escapeHtml(a.name)}</span>
        <span class="sg-cell sg-num">${a.max_score}</span>
        <span class="sg-cell sg-muted">${formatDate(a.due_date)}</span>
        <span class="sg-cell sg-score-cell">
          ${scoreField}
        </span>
        <span class="sg-cell"><span class="badge ${status.cls}">${status.label}</span></span>
        <span class="sg-cell sg-muted">${formatDate(g?.created_at)}</span>
        <span class="sg-cell sg-muted">${formatDate(g?.graded_at)}</span>
        <span class="sg-cell">
          <input class="sg-note" type="text" data-assignment="${a.id}"
            data-original="${escapeHtml(note)}" value="${escapeHtml(note)}" placeholder="${t("admin.sg.notePlaceholder")}" />
        </span>
      </div>`;
    })
    .join("");

  sgBody.innerHTML = `
    <p class="sg-period">${tn("admin.sg.periodLine", assignments.length, { period: escapeHtml(periodName), count: assignments.length })}</p>
    <div class="sg-scroll">
      <div class="sg-grid">
        <div class="sg-row sg-head">
          <span class="sg-cell">${t("admin.sg.assignment")}</span>
          <span class="sg-cell sg-num">${t("admin.sg.max")}</span>
          <span class="sg-cell">${t("admin.sg.due")}</span>
          <span class="sg-cell">${t("admin.sg.score")}</span>
          <span class="sg-cell">${t("admin.sg.status")}</span>
          <span class="sg-cell">${t("admin.sg.dateAdded")}</span>
          <span class="sg-cell">${t("admin.sg.dateGraded")}</span>
          <span class="sg-cell">${t("admin.sg.note")}</span>
        </div>
        ${rows}
      </div>
    </div>`;
}

function closeStudentGradesModal() {
  sgOverlay.classList.remove("active");
  sgBody.innerHTML = "";
  _studentGradesState = null;
}

async function saveStudentGrades() {
  if (!_studentGradesState) return;
  const { student, assignments, gradeByAssignment } = _studentGradesState;
  const maxMap = Object.fromEntries(
    assignments.map((a) => [a.id, Number(a.max_score)]),
  );

  const rows = [];
  let errorMsg = null;

  document.querySelectorAll("#sg-body .sg-score").forEach((input) => {
    const aId = Number(input.dataset.assignment);
    const noteInput = document.querySelector(
      `#sg-body .sg-note[data-assignment="${aId}"]`,
    );
    const scoreVal = input.value.trim();
    const noteVal = (noteInput?.value ?? "").trim();
    const scoreChanged = scoreVal !== (input.dataset.original ?? "");
    const noteChanged = noteVal !== (noteInput?.dataset.original ?? "");
    if (!scoreChanged && !noteChanged) return;

    let score = null;
    if (scoreVal !== "") {
      score = Number(scoreVal);
      const max = maxMap[aId];
      if (Number.isNaN(score) || score < 0 || score > max) {
        errorMsg ??= t("admin.validation.scoreRange", { max });
        return;
      }
    }

    const existing = gradeByAssignment[aId];
    rows.push({
      assignment_id: aId,
      student_id: student.id,
      score,
      note: noteVal || null,
      // Re-stamp graded_at only when the score itself changes; otherwise keep
      // the existing timestamp (note-only edits shouldn't move "Date graded").
      graded_at: scoreChanged
        ? score == null
          ? null
          : new Date().toISOString()
        : (existing?.graded_at ?? null),
    });
  });

  if (errorMsg) {
    showToast(errorMsg, "error");
    return;
  }
  if (!rows.length) {
    showToast(t("admin.validation.noChanges"), "error");
    return;
  }

  sgSave.disabled = true;
  try {
    await db.upsertAssignmentGrades(rows);
    showToast(
      tn("admin.toast.gradesSaved", rows.length, {
        count: rows.length,
        name: student.first_name,
      }),
    );
    closeStudentGradesModal();
    loadGradebook(); // refresh current-period grade + completion from the view
  } catch (err) {
    showToast(err.message, "error");
  } finally {
    sgSave.disabled = false;
  }
}

// ───────────────────────────────────────────────────────────────
//  9. ATTENDANCE TAB
// ───────────────────────────────────────────────────────────────
let _attendanceRows = [];

function renderAttendanceTab(content) {
  const today = new Date().toISOString().split("T")[0];
  content.innerHTML = `
    <div class="absence-summary recent-activity" id="absence-summary">
      ${skeletonBlock(2)}
    </div>
    <div class="view-toolbar">
      <div class="toolbar-filters">
        <label for="attendance-date">${t("admin.attendance.date")}</label>
        <input type="date" id="attendance-date" value="${today}" />
      </div>
      <button class="btn btn-secondary" id="btn-save-attendance">
        <span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-save"></use></svg></span> ${t("admin.attendance.save")}
      </button>
    </div>
    <div class="recent-activity">
      <table class="data-table" id="attendance-table">
        <thead>
          <tr><th>${t("admin.attendance.student")}</th><th>${t("admin.attendance.status")}</th><th>${t("admin.attendance.notes")}</th></tr>
        </thead>
        <tbody id="attendance-body">
          ${skeletonRows(5, 3)}
        </tbody>
      </table>
    </div>`;

  const dateInput = document.getElementById("attendance-date");
  dateInput.addEventListener("change", () =>
    loadAttendanceSheet(dateInput.value),
  );

  const tbody = document.getElementById("attendance-body");
  tbody.addEventListener("click", (e) => {
    const btn = e.target.closest(".attendance-status-btn");
    if (!btn) return;
    const idx = Number(btn.dataset.idx);
    _attendanceRows[idx].status = btn.dataset.status;
    btn
      .closest(".attendance-status-group")
      .querySelectorAll(".attendance-status-btn")
      .forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
  });
  tbody.addEventListener("input", (e) => {
    const input = e.target.closest(".attendance-notes-input");
    if (!input) return;
    _attendanceRows[Number(input.dataset.idx)].notes = input.value;
  });

  document
    .getElementById("btn-save-attendance")
    .addEventListener("click", saveAttendance);

  loadAttendanceSheet(today);
  loadAbsenceSummary();
}

async function loadAttendanceSheet(date) {
  const tbody = document.getElementById("attendance-body");
  tbody.innerHTML = skeletonRows(5, 3);
  try {
    _attendanceRows = await db.fetchAttendanceSheet(currentClass.classId, date);
    _attendanceRows.forEach((row) => {
      row._original = { status: row.status, notes: row.notes ?? "" };
    });
    renderAttendanceSheet(_attendanceRows);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="3" class="loading-cell">${t("admin.attendance.error", { msg: escapeHtml(err.message) })}</td></tr>`;
  }
}

function renderAttendanceSheet(rows) {
  const tbody = document.getElementById("attendance-body");
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="3" class="loading-cell">${t("admin.gradebook.noActiveStudents")}</td></tr>`;
    return;
  }

  const STATUSES = ["present", "absent", "late", "excused"];
  tbody.innerHTML = "";
  rows.forEach((row, idx) => {
    const tr = document.createElement("tr");
    const statusButtons = STATUSES.map((s) => {
      const active = row.status === s ? " active" : "";
      return `<button type="button" class="btn btn-sm attendance-status-btn${active}"
        data-idx="${idx}" data-status="${s}">${t(`enums.attendance.${s}`)}</button>`;
    }).join("");

    tr.innerHTML = `
      <td>${escapeHtml(row.last_name)}, ${escapeHtml(row.first_name)}</td>
      <td><div class="attendance-status-group">${statusButtons}</div></td>
      <td><input type="text" class="attendance-notes-input" data-idx="${idx}"
        value="${escapeHtml(row.notes ?? "")}" placeholder="${t("admin.attendance.notePlaceholder")}"></td>`;
    tbody.appendChild(tr);
  });
}

async function saveAttendance() {
  const date = document.getElementById("attendance-date").value;
  if (!date) {
    showToast(t("admin.validation.pickDate"), "error");
    return;
  }
  if (!_attendanceRows.length) {
    showToast(t("admin.validation.noAttendanceData"), "error");
    return;
  }

  // Require a chosen/loaded status — a row the teacher never picked stays null and
  // is never upserted (attendance.status is non-null in the DB).
  const changed = _attendanceRows.filter(
    (row) =>
      row.status &&
      (!row._original ||
        row._original.status !== row.status ||
        row._original.notes !== (row.notes ?? "")),
  );
  if (!changed.length) {
    showToast(t("admin.validation.noChanges"), "error");
    return;
  }

  try {
    await db.upsertAttendance(currentClass.classId, date, changed, TEACHER_ID);
    changed.forEach((row) => {
      row._original = { status: row.status, notes: row.notes ?? "" };
    });
    showToast(
      tn("admin.toast.attendanceSaved", changed.length, {
        count: changed.length,
      }),
    );
    loadAbsenceSummary(); // counts may have shifted a student over the threshold
  } catch (err) {
    showToast(err.message, "error");
  }
}

// ───────────────────────────────────────────────────────────────
//  10. SCHEDULE TAB (read-only)
// ───────────────────────────────────────────────────────────────
//  Timetables are authored in one place — the admin console's Schedules
//  tab, which is the only surface that checks for double-booked teachers
//  and rooms across sections. Here a teacher just reads their week.
function renderScheduleTab(content) {
  content.innerHTML = `
    <div class="view-toolbar">
      <div class="toolbar-filters">
        <label>${t("admin.schedule.weeklyFor", { class: escapeHtml(currentClass.className) })}</label>
      </div>
    </div>
    <div class="recent-activity">
      <div id="schedule-grid">${skeletonBlock(4)}</div>
    </div>`;

  loadSchedule();
}

async function loadSchedule() {
  const container = document.getElementById("schedule-grid");
  try {
    const entries = await db.fetchScheduleByClass(currentClass.classId);
    renderScheduleTable(entries);
  } catch (err) {
    container.innerHTML = `<div class="loading-cell">${t("admin.schedule.loadFailed", { msg: escapeHtml(err.message) })}</div>`;
  }
}

function renderScheduleTable(entries) {
  const container = document.getElementById("schedule-grid");
  if (!entries.length) {
    container.innerHTML = `<div class="loading-cell">${t("admin.schedule.empty")}</div>`;
    return;
  }

  const table = document.createElement("table");
  table.className = "data-table";
  table.innerHTML = `
    <thead>
      <tr>
        <th>${t("admin.schedule.day")}</th><th>${t("admin.schedule.start")}</th><th>${t("admin.schedule.end")}</th>
        <th>${t("admin.schedule.subject")}</th><th>${t("admin.schedule.teacher")}</th><th>${t("admin.schedule.room")}</th>
      </tr>
    </thead>`;
  const tbody = document.createElement("tbody");

  entries.forEach((entry) => {
    const tr = document.createElement("tr");
    const dot = entry.subjects?.color
      ? `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;
           background:${entry.subjects.color};margin-right:6px;vertical-align:middle;"></span>`
      : "";

    tr.innerHTML = `
      <td>${dayName(entry.day_of_week) || entry.day_of_week}</td>
      <td>${escapeHtml(entry.start_time)}</td>
      <td>${escapeHtml(entry.end_time)}</td>
      <td>${dot}${escapeHtml(entry.subjects?.name ?? "—")}</td>
      <td>${entry.teachers ? escapeHtml(entry.teachers.first_name + " " + entry.teachers.last_name) : "—"}</td>
      <td>${escapeHtml(entry.rooms?.name ?? "—")}</td>`;
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  container.innerHTML = "";
  container.appendChild(table);
}

// ───────────────────────────────────────────────────────────────
//  11. SUBJECTS SECTION (global catalog — retained)
// ───────────────────────────────────────────────────────────────
let _cachedSubjects = [];
let subjectsFilter = { search: "" };

async function loadSubjects() {
  renderEmptyRow("subjects-body", 4, t("admin.subjects.loading"));
  try {
    _cachedSubjects = await db.fetchSubjectsDetailed();
    renderSubjectsTable();
  } catch (err) {
    console.error(err);
    renderErrorRow("subjects-body", 4);
  }
}

function renderSubjectsTable() {
  const tbody = document.getElementById("subjects-body");
  let filtered = _cachedSubjects;

  if (subjectsFilter.search) {
    const q = subjectsFilter.search.toLowerCase();
    filtered = filtered.filter(
      (s) =>
        s.name?.toLowerCase().includes(q) || s.code?.toLowerCase().includes(q),
    );
  }

  if (!filtered.length) {
    renderEmptyRow("subjects-body", 4, t("admin.subjects.noMatch"));
    return;
  }

  tbody.innerHTML = "";
  filtered.forEach((subject) => {
    const gradeLevelNames =
      [
        ...new Set(
          (subject.grade_level_subjects ?? [])
            .map((gls) => gls.grade_levels?.name)
            .filter(Boolean),
        ),
      ].join(", ") || "—";

    const colorSwatch = subject.color
      ? `<span class="color-swatch" style="background:${subject.color};
           display:inline-block;width:16px;height:16px;border-radius:3px;
           vertical-align:middle;margin-right:6px;"></span>${escapeHtml(subject.color)}`
      : "—";

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><code>${escapeHtml(subject.code ?? "—")}</code></td>
      <td>${escapeHtml(subject.name)}</td>
      <td>${colorSwatch}</td>
      <td>${escapeHtml(gradeLevelNames)}</td>`;
    tbody.appendChild(tr);
  });
}

let subjectsSearchTimeout;
document.getElementById("subjects-search")?.addEventListener("input", (e) => {
  clearTimeout(subjectsSearchTimeout);
  subjectsSearchTimeout = setTimeout(() => {
    subjectsFilter.search = e.target.value.trim();
    if (_cachedSubjects.length) renderSubjectsTable();
  }, 350);
});

// Subjects is read-only for teachers — no add/edit/delete. The school's
// subject structure is registrar-managed, outside a teacher's role.

// ───────────────────────────────────────────────────────────────
//  12. SHARED SMALL HELPERS (added features)
// ───────────────────────────────────────────────────────────────
// Gender select options, built at call time so labels follow the active language.
function genderOptions() {
  return [
    { value: "M", label: t("enums.gender.M") },
    { value: "F", label: t("enums.gender.F") },
    { value: "O", label: t("enums.gender.O") },
  ];
}

function genderLabel(g) {
  return g === "M" || g === "F" || g === "O" ? t(`enums.gender.${g}`) : "—";
}

// Category dropdown options for the assignment form, from the loaded gradebook.
function categoryOptions() {
  return (gradebookState?.categories ?? []).map((c) => ({
    value: c.id,
    label: `${c.name} (${Number(c.weight)}%)`,
  }));
}

// ───────────────────────────────────────────────────────────────
//  13. GRADE CATEGORIES (item 8)
// ───────────────────────────────────────────────────────────────
function openCategoriesModal() {
  if (!currentClass) return;
  categoriesTitle.textContent = t("admin.categories.title", {
    subject: currentClass.subjectName,
    class: currentClass.className,
  });
  renderCategories();
  categoriesOverlay.classList.add("active");
}

function closeCategoriesModal() {
  categoriesOverlay.classList.remove("active");
}

function renderCategories() {
  const cats = gradebookState?.categories ?? [];
  if (!cats.length) {
    categoriesBody.innerHTML = `<p class="drawer-muted">${t("admin.categories.empty")}</p>`;
    categoriesTotal.textContent = "";
    return;
  }

  categoriesBody.innerHTML = "";
  cats.forEach((c) => {
    const item = document.createElement("div");
    item.className = "manage-item";
    const info = document.createElement("div");
    info.className = "manage-item-info";
    info.innerHTML = `<b>${escapeHtml(c.name)}</b><span class="manage-item-meta">${t("admin.categories.weight", { weight: Number(c.weight) })}</span>`;
    const actions = document.createElement("div");
    actions.className = "manage-item-actions";
    actions.appendChild(
      makeActionBtn("edit", t("common.edit"), () => openCategoryForm(c)),
    );
    actions.appendChild(
      makeActionBtn(
        "delete",
        t("common.delete"),
        () => confirmDeleteCategory(c),
        true,
      ),
    );
    item.append(info, actions);
    categoriesBody.appendChild(item);
  });

  const total = cats.reduce((s, c) => s + Number(c.weight || 0), 0);
  const off = Math.round(total * 100) / 100 !== 100;
  categoriesTotal.innerHTML = `${t("admin.categories.total")}<b class="${off ? "score-mid" : "score-high"}">${total}%</b>${
    off ? t("admin.categories.totalOff") : ""
  }`;
}

function openCategoryForm(category = null) {
  const editing = !!category;
  openModal({
    title: editing
      ? t("admin.categories.editTitle")
      : t("admin.categories.addTitle"),
    submitLabel: editing ? t("common.save") : t("admin.categories.add"),
    fields: [
      {
        name: "name",
        label: t("admin.form.name"),
        type: "text",
        required: true,
        value: category?.name ?? "",
        placeholder: t("admin.categories.namePlaceholder"),
      },
      {
        name: "weight",
        label: t("admin.form.weightPct"),
        type: "number",
        required: true,
        value: category?.weight ?? "",
        min: 0,
        step: "0.01",
      },
    ],
    onSubmit: async (formData) => {
      const payload = {
        name: formData.name.trim(),
        weight: Number(formData.weight),
      };
      if (editing) {
        await db.updateCategory(category.id, payload);
      } else {
        await db.insertCategory({
          ...payload,
          class_subject_teacher_id: currentClass.cstId,
        });
      }
      showToast(
        editing
          ? t("admin.toast.categoryUpdated", { name: payload.name })
          : t("admin.toast.categoryAdded", { name: payload.name }),
      );
      await refreshAfterCategoryChange();
    },
  });
}

function confirmDeleteCategory(category) {
  openConfirm(
    t("admin.confirm.deleteCategory", { name: category.name }),
    async () => {
      await db.deleteCategory(category.id);
      showToast(t("admin.toast.categoryDeleted", { name: category.name }));
      await refreshAfterCategoryChange();
    },
  );
}

// Reload the gradebook (refetches categories + grades, since weighting changed)
// and re-render the categories list if it's still open.
async function refreshAfterCategoryChange() {
  await loadGradebook();
  if (categoriesOverlay.classList.contains("active")) renderCategories();
}

// ───────────────────────────────────────────────────────────────
//  14. POST GRADES (item 1) — finalize period grade to the report card
// ───────────────────────────────────────────────────────────────
let _postGradesState = null;

async function openPostGrades() {
  if (!gradebookState) return;
  const { cstId, periodId, students } = gradebookState;
  const periodName = PERIODS.find((p) => p.id === periodId)?.name ?? "";
  pgTitle.textContent = t("admin.pg.title", { period: periodName });
  pgBody.innerHTML = skeletonBlock();
  pgOverlay.classList.add("active");

  let computed, posted;
  try {
    [computed, posted] = await Promise.all([
      db.fetchPeriodGrades(cstId, periodId),
      db.fetchPostedGrades(cstId, periodId),
    ]);
  } catch (err) {
    pgBody.innerHTML = `<div class="loading-cell">${t("admin.pg.loadFailed", { msg: escapeHtml(err.message) })}</div>`;
    return;
  }

  const computedById = Object.fromEntries(
    computed.map((c) => [c.student_id, c]),
  );
  const postedById = Object.fromEntries(posted.map((p) => [p.student_id, p]));
  _postGradesState = { cstId, periodId };

  if (!students.length) {
    pgBody.innerHTML = `<p class="drawer-muted">${t("admin.pg.noStudents")}</p>`;
    return;
  }

  const rows = students
    .map((s) => {
      const comp = computedById[s.id];
      const computedScore =
        comp && comp.period_score != null ? Number(comp.period_score) : null;
      const post = postedById[s.id];
      const postedScore =
        post && post.score != null ? Number(post.score) : null;
      const prefill =
        postedScore != null
          ? postedScore
          : computedScore != null
            ? computedScore.toFixed(1)
            : "";
      const note = post?.notes ?? "";
      const postedCell =
        postedScore != null
          ? `<b class="${gradeBandClass(postedScore)}">${postedScore.toFixed(1)}</b>`
          : '<span class="text-muted">—</span>';
      return `
      <div class="pg-row">
        <span class="pg-cell pg-name">${escapeHtml(s.last_name)}, ${escapeHtml(s.first_name)}</span>
        <span class="pg-cell pg-center">${gradeCellHtml(computedScore)}</span>
        <span class="pg-cell pg-center">${postedCell}</span>
        <span class="pg-cell">
          <input class="pg-score" type="number" min="0" max="100" step="0.01"
            data-student="${s.id}" data-computed="${computedScore != null ? computedScore.toFixed(2) : ""}"
            value="${prefill}" placeholder="—" />
        </span>
        <span class="pg-cell">
          <input class="pg-note" type="text" data-student="${s.id}"
            value="${escapeHtml(note)}" placeholder="${t("admin.pg.commentPlaceholder")}" />
        </span>
      </div>`;
    })
    .join("");

  pgBody.innerHTML = `
    <p class="sg-period">${t("admin.pg.intro", { period: escapeHtml(periodName) })}</p>
    <div class="sg-scroll">
      <div class="pg-grid">
        <div class="pg-row pg-head">
          <span class="pg-cell">${t("admin.pg.student")}</span>
          <span class="pg-cell pg-center">${t("admin.pg.computed")}</span>
          <span class="pg-cell pg-center">${t("admin.pg.posted")}</span>
          <span class="pg-cell">${t("admin.pg.toPost")}</span>
          <span class="pg-cell">${t("admin.pg.comment")}</span>
        </div>
        ${rows}
      </div>
    </div>
    <div class="pg-actions">
      <button type="button" class="link-btn" id="pg-fill-computed">${t("admin.pg.reset")}</button>
    </div>`;

  document.getElementById("pg-fill-computed").addEventListener("click", () => {
    pgBody.querySelectorAll(".pg-score").forEach((inp) => {
      const c = inp.dataset.computed;
      if (c !== "") inp.value = Number(c).toFixed(1);
    });
  });
}

function closePostGrades() {
  pgOverlay.classList.remove("active");
  pgBody.innerHTML = "";
  _postGradesState = null;
}

async function savePostGrades() {
  if (!_postGradesState) return;
  const { cstId, periodId } = _postGradesState;

  const rows = [];
  let errorMsg = null;
  const now = new Date().toISOString();

  pgBody.querySelectorAll(".pg-score").forEach((input) => {
    const studentId = Number(input.dataset.student);
    const noteInput = pgBody.querySelector(
      `.pg-note[data-student="${studentId}"]`,
    );
    const scoreVal = input.value.trim();
    const noteVal = (noteInput?.value ?? "").trim();
    if (scoreVal === "") return; // skip students with no grade to post

    const score = Number(scoreVal);
    if (Number.isNaN(score) || score < 0 || score > 100) {
      errorMsg ??= t("admin.validation.postRange");
      return;
    }
    rows.push({
      student_id: studentId,
      class_subject_teacher_id: cstId,
      grading_period_id: periodId,
      score,
      notes: noteVal || null,
      submitted_at: now,
    });
  });

  if (errorMsg) {
    showToast(errorMsg, "error");
    return;
  }
  if (!rows.length) {
    showToast(t("admin.validation.atLeastOne"), "error");
    return;
  }

  pgSave.disabled = true;
  try {
    await db.upsertStudentGrades(rows);
    showToast(
      tn("admin.toast.gradesPosted", rows.length, { count: rows.length }),
    );
    closePostGrades();
  } catch (err) {
    showToast(err.message, "error");
  } finally {
    pgSave.disabled = false;
  }
}

// ───────────────────────────────────────────────────────────────
//  15. COLUMN GRADE ENTRY (item 4) — one assignment, every student
// ───────────────────────────────────────────────────────────────
let _columnState = null;

async function openColumnGrades(assignment) {
  if (!gradebookState) return;
  const students = gradebookState.students; // active students only
  cgTitle.textContent = t("admin.cg.title", { assignment: assignment.name });
  cgBody.innerHTML = skeletonBlock();
  cgOverlay.classList.add("active");

  let existing;
  try {
    existing = await db.fetchAssignmentColumn(assignment.id);
  } catch (err) {
    cgBody.innerHTML = `<div class="loading-cell">${t("admin.pg.loadFailed", { msg: escapeHtml(err.message) })}</div>`;
    return;
  }
  const byStudent = Object.fromEntries(existing.map((g) => [g.student_id, g]));
  _columnState = { assignment, byStudent };

  if (!students.length) {
    cgBody.innerHTML = `<p class="drawer-muted">${t("admin.pg.noStudents")}</p>`;
    return;
  }

  const rows = students
    .map((s) => {
      const g = byStudent[s.id];
      const score = g?.score ?? "";
      const note = g?.note ?? "";
      return `
      <div class="cg-row">
        <span class="cg-cell cg-name">${escapeHtml(s.last_name)}, ${escapeHtml(s.first_name)}</span>
        <span class="cg-cell">
          <input class="cg-score" type="number" min="0" max="${assignment.max_score}" step="0.01"
            data-student="${s.id}" data-original="${score}" value="${score}" placeholder="—" />
        </span>
        <span class="cg-cell">
          <input class="cg-note" type="text" data-student="${s.id}"
            data-original="${escapeHtml(note)}" value="${escapeHtml(note)}" placeholder="${t("admin.cg.notePlaceholder")}" />
        </span>
      </div>`;
    })
    .join("");

  cgBody.innerHTML = `
    <p class="sg-period">${t("admin.cg.outOf", { max: assignment.max_score })}${
      assignment.due_date
        ? " · " + t("admin.cg.dueOn", { date: formatDate(assignment.due_date) })
        : ""
    } · ${tn("admin.students", students.length)}</p>
    <div class="sg-scroll">
      <div class="cg-grid">
        <div class="cg-row cg-head">
          <span class="cg-cell">${t("admin.cg.student")}</span>
          <span class="cg-cell">${t("admin.cg.score")}</span>
          <span class="cg-cell">${t("admin.cg.note")}</span>
        </div>
        ${rows}
      </div>
    </div>`;
}

function closeColumnGrades() {
  cgOverlay.classList.remove("active");
  cgBody.innerHTML = "";
  _columnState = null;
}

async function saveColumnGrades() {
  if (!_columnState) return;
  const { assignment, byStudent } = _columnState;
  const max = Number(assignment.max_score);

  const rows = [];
  let errorMsg = null;

  cgBody.querySelectorAll(".cg-score").forEach((input) => {
    const studentId = Number(input.dataset.student);
    const noteInput = cgBody.querySelector(
      `.cg-note[data-student="${studentId}"]`,
    );
    const scoreVal = input.value.trim();
    const noteVal = (noteInput?.value ?? "").trim();
    const scoreChanged = scoreVal !== (input.dataset.original ?? "");
    const noteChanged = noteVal !== (noteInput?.dataset.original ?? "");
    if (!scoreChanged && !noteChanged) return;

    let score = null;
    if (scoreVal !== "") {
      score = Number(scoreVal);
      if (Number.isNaN(score) || score < 0 || score > max) {
        errorMsg ??= t("admin.validation.scoreRange", { max });
        return;
      }
    }
    const existing = byStudent[studentId];
    rows.push({
      assignment_id: assignment.id,
      student_id: studentId,
      score,
      note: noteVal || null,
      // Same graded_at rule as the per-student modal: re-stamp only on a score
      // change; null it when the score is cleared.
      graded_at: scoreChanged
        ? score == null
          ? null
          : new Date().toISOString()
        : (existing?.graded_at ?? null),
    });
  });

  if (errorMsg) {
    showToast(errorMsg, "error");
    return;
  }
  if (!rows.length) {
    showToast(t("admin.validation.noChanges"), "error");
    return;
  }

  cgSave.disabled = true;
  try {
    await db.upsertAssignmentGrades(rows);
    showToast(
      tn("admin.toast.scoresSaved", rows.length, { count: rows.length }),
    );
    closeColumnGrades();
    loadGradebook();
  } catch (err) {
    showToast(err.message, "error");
  } finally {
    cgSave.disabled = false;
  }
}

// ───────────────────────────────────────────────────────────────
//  16. DISCIPLINE (item 2) — create/edit from the student drawer
// ───────────────────────────────────────────────────────────────
// Discipline severity options, built at call time so labels follow the language.
function disciplineSeverityOptions() {
  return [
    { value: "low", label: t("enums.disciplineSeverity.low") },
    { value: "medium", label: t("enums.disciplineSeverity.medium") },
    { value: "high", label: t("enums.disciplineSeverity.high") },
  ];
}

function openAddDiscipline() {
  const student = _drawerStudent;
  if (!student) return;
  const today = new Date().toISOString().split("T")[0];
  openModal({
    title: t("admin.discipline.addTitle", {
      name: `${student.first_name} ${student.last_name}`,
    }),
    submitLabel: t("admin.discipline.addRecord"),
    fields: [
      {
        name: "date",
        label: t("admin.form.date"),
        type: "date",
        required: true,
        value: today,
      },
      {
        name: "type",
        label: t("admin.form.type"),
        type: "text",
        required: true,
        placeholder: t("admin.discipline.typePlaceholder"),
      },
      {
        name: "severity",
        label: t("admin.form.severity"),
        type: "select",
        required: true,
        value: "low",
        options: disciplineSeverityOptions(),
      },
      {
        name: "description",
        label: t("admin.form.description"),
        type: "textarea",
      },
    ],
    onSubmit: async (formData) => {
      await db.insertDiscipline({
        student_id: student.id,
        date: formData.date,
        type: formData.type.trim(),
        severity: formData.severity,
        description: formData.description?.trim() || null,
        reported_by_teacher: TEACHER_ID,
      });
      showToast(t("admin.toast.disciplineAdded"));
      await refreshDrawer();
    },
  });
}

function openEditDiscipline(record) {
  openModal({
    title: t("admin.discipline.editTitle"),
    submitLabel: t("common.save"),
    fields: [
      {
        name: "date",
        label: t("admin.form.date"),
        type: "date",
        required: true,
        value: record.date ?? "",
      },
      {
        name: "type",
        label: t("admin.form.type"),
        type: "text",
        required: true,
        value: record.type ?? "",
      },
      {
        name: "severity",
        label: t("admin.form.severity"),
        type: "select",
        required: true,
        value: record.severity ?? "low",
        options: disciplineSeverityOptions(),
      },
      {
        name: "description",
        label: t("admin.form.description"),
        type: "textarea",
        value: record.description ?? "",
      },
      {
        name: "resolved",
        label: t("admin.form.status"),
        type: "select",
        value: record.resolved ? "yes" : "no",
        options: [
          { value: "no", label: t("enums.disciplineState.open") },
          { value: "yes", label: t("enums.disciplineState.resolved") },
        ],
      },
      {
        name: "resolution",
        label: t("admin.form.resolutionIf"),
        type: "textarea",
        value: record.resolution ?? "",
      },
    ],
    onSubmit: async (formData) => {
      const resolved = formData.resolved === "yes";
      await db.updateDiscipline(record.id, {
        date: formData.date,
        type: formData.type.trim(),
        severity: formData.severity,
        description: formData.description?.trim() || null,
        resolved,
        resolution: resolved ? formData.resolution?.trim() || null : null,
      });
      showToast(t("admin.toast.disciplineUpdated"));
      await refreshDrawer();
    },
  });
}

// Re-open the drawer for the current student to reflect a discipline change.
async function refreshDrawer() {
  if (_drawerStudent) await openStudentDrawer(_drawerStudent);
}

// ───────────────────────────────────────────────────────────────
//  17. ABSENCE SUMMARY (item 3)
// ───────────────────────────────────────────────────────────────
const ABSENCE_THRESHOLD = 5; // absent + late at/above this flags an at-risk student

async function loadAbsenceSummary() {
  const container = document.getElementById("absence-summary");
  if (!container) return;
  try {
    const [rows, roster] = await Promise.all([
      db.fetchClassAttendance(currentClass.classId),
      db.fetchRoster(currentClass.classId),
    ]);
    renderAbsenceSummary(rows, roster, container);
  } catch (err) {
    container.innerHTML = `<div class="loading-cell">${t("admin.absence.loadFailed", { msg: escapeHtml(err.message) })}</div>`;
  }
}

function renderAbsenceSummary(rows, roster, container) {
  const nameById = Object.fromEntries(
    roster.map((s) => [s.id, `${s.last_name}, ${s.first_name}`]),
  );
  const counts = {};
  rows.forEach((r) => {
    const c = (counts[r.student_id] ??= {
      present: 0,
      absent: 0,
      late: 0,
      excused: 0,
    });
    if (c[r.status] != null) c[r.status] += 1;
  });

  const flagged = Object.entries(counts)
    .map(([id, c]) => ({ id: Number(id), ...c, missed: c.absent + c.late }))
    .filter((s) => s.missed >= ABSENCE_THRESHOLD)
    .sort((a, b) => b.missed - a.missed);

  if (!flagged.length) {
    container.innerHTML = `
      <div class="absence-summary-head">
        <h3><span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-monitoring"></use></svg></span> ${t("admin.absence.title")}</h3>
      </div>
      <p class="drawer-muted">${t("admin.absence.empty", { threshold: ABSENCE_THRESHOLD })}</p>`;
    return;
  }

  const chips = flagged
    .map(
      (s) => `
      <div class="absence-chip${s.absent >= ABSENCE_THRESHOLD ? " absence-high" : ""}">
        <b>${escapeHtml(nameById[s.id] ?? t("admin.absence.studentFallback", { id: s.id }))}</b>
        <span>${s.absent} ${t("enums.attendanceWord.absent")} · ${s.late} ${t("enums.attendanceWord.late")}${s.excused ? " · " + s.excused + " " + t("enums.attendanceWord.excused") : ""}</span>
      </div>`,
    )
    .join("");

  container.innerHTML = `
    <div class="absence-summary-head">
      <h3><span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-monitoring"></use></svg></span> ${t("admin.absence.title")}</h3>
      <span class="badge badge-warning">${t("admin.absence.atRisk", { count: flagged.length, threshold: ABSENCE_THRESHOLD })}</span>
    </div>
    <div class="absence-grid">${chips}</div>`;
}

// ───────────────────────────────────────────────────────────────
//  18. TODAY START PAGE (item 7)
// ───────────────────────────────────────────────────────────────
async function loadToday() {
  const grid = document.getElementById("today-grid");
  const subtitle = document.getElementById("today-subtitle");
  if (!grid) return;
  if (!ACTIVE_YEAR || !TEACHER_ID) {
    // This early return skips the subtitle write further down, so clear the
    // static "Loading your day…" placeholder here — otherwise the header claims
    // the page is still loading forever while the grid says it gave up.
    if (subtitle) {
      subtitle.textContent = TEACHER_ID
        ? ""
        : t("admin.today.noTeacherRecordTitle");
    }
    grid.innerHTML = `<div class="loading-cell">${
      TEACHER_ID
        ? t("admin.today.contextNotLoaded")
        : t("admin.today.noTeacherRecordBody")
    }</div>`;
    return;
  }

  const now = new Date();
  const jsDow = now.getDay(); // 0 Sun … 6 Sat
  subtitle.textContent = i18nFormatDate(now, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  grid.innerHTML = skeletonCards(3);
  try {
    // myClassesCache lets us map a schedule row to its class_subject_teacher so
    // the action buttons can open the class workspace.
    if (!myClassesCache.length) {
      myClassesCache = await db.fetchMyClasses(TEACHER_ID, ACTIVE_YEAR.id);
    }
    // Weekends are queried like any other day — schools that teach on
    // Saturday exist, and an empty result renders the same "no classes".
    const entries = await db.fetchScheduleToday(TEACHER_ID, jsDayToDow(jsDow));
    renderToday(entries, grid, jsDow);
  } catch (err) {
    loaded.today = false; // allow a retry on next visit
    grid.innerHTML = `<div class="loading-cell">${t("admin.today.loadFailed", { msg: escapeHtml(err.message) })}</div>`;
  }
}

function renderToday(entries, grid, jsDow = null) {
  // Only show schedule rows the teacher actually grades (has a
  // class_subject_teacher assignment for); other teachers' classes are hidden.
  const mine = entries
    .map((e) => ({
      entry: e,
      cst: myClassesCache.find(
        (c) => c.class_id === e.class_id && c.subject_id === e.subject_id,
      ),
    }))
    .filter((m) => m.cst);

  if (!mine.length) {
    // A free Saturday still reads as a weekend; a free Tuesday does not.
    const weekend = jsDow === 0 || jsDow === 6;
    const icon = weekend ? "weekend" : "event_available";
    const message = t(
      weekend ? "admin.today.weekend" : "admin.today.noClasses",
    );
    grid.innerHTML = `<div class="empty-state"><span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-${icon}"></use></svg></span><p>${message}</p></div>`;
    return;
  }

  grid.innerHTML = "";
  const list = document.createElement("div");
  list.className = "today-list";

  mine.forEach(({ entry: e, cst }) => {
    const color = e.subjects?.color || "var(--color-primary)";
    const card = document.createElement("div");
    card.className = "today-card";
    card.style.setProperty("--accent", color);
    card.innerHTML = `
      <span class="today-card-accent"></span>
      <div class="today-card-time">
        <b>${escapeHtml((e.start_time ?? "").slice(0, 5))}</b>
        <span>${escapeHtml((e.end_time ?? "").slice(0, 5))}</span>
      </div>
      <div class="today-card-body">
        <h3>${escapeHtml(e.subjects?.name ?? "—")}</h3>
        <p>${escapeHtml(e.classes?.display_name ?? "—")}${
          e.rooms?.name ? " · " + escapeHtml(e.rooms.name) : ""
        }</p>
      </div>
      <div class="today-card-actions"></div>`;

    const actions = card.querySelector(".today-card-actions");
    const att = document.createElement("button");
    att.type = "button";
    att.className = "btn btn-sm btn-secondary";
    att.innerHTML = `<span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-fact_check"></use></svg></span> ${t("admin.today.attendance")}`;
    att.addEventListener("click", () => openClassWorkspace(cst, "attendance"));
    const gb = document.createElement("button");
    gb.type = "button";
    gb.className = "btn btn-sm btn-primary";
    gb.innerHTML = `<span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-school"></use></svg></span> ${t("admin.today.gradebook")}`;
    gb.addEventListener("click", () => openClassWorkspace(cst, "gradebook"));
    actions.append(att, gb);
    list.appendChild(card);
  });

  grid.appendChild(list);
}

// ───────────────────────────────────────────────────────────────
//  19. PRINTABLE PROGRESS REPORT (item 6)
// ───────────────────────────────────────────────────────────────
async function printStudentReport() {
  const student = _drawerStudent;
  if (!student) return;

  let grades = [];
  try {
    grades = await db.fetchStudentAllSubjectGrades(student.id);
  } catch {
    /* degrade — report prints without the grade table */
  }
  const attendance = _drawerData.attendance ?? [];
  const discipline = _drawerData.discipline ?? [];

  const win = window.open("", "_blank");
  if (!win) {
    showToast(t("admin.toast.popupBlocked"), "error");
    return;
  }
  win.document.write(buildReportHtml(student, grades, attendance, discipline));
  win.document.close();
  win.focus();
  win.print();
}

function buildReportHtml(student, grades, attendance, discipline) {
  const esc = escapeHtml;
  const periods = PERIODS.slice().sort(
    (a, b) => a.period_order - b.period_order,
  );

  // Pivot posted grades into subject × period.
  const bySubject = {};
  grades.forEach((g) => {
    const subj = g.class_subject_teachers?.subjects?.name ?? "—";
    (bySubject[subj] ??= {})[g.grading_period_id] = g.score;
  });
  const periodHeads = periods.map((p) => `<th>${esc(p.name)}</th>`).join("");
  const gradeRows =
    Object.keys(bySubject).sort().length === 0
      ? `<tr><td colspan="${periods.length + 1}">${t("admin.report.noGrades")}</td></tr>`
      : Object.keys(bySubject)
          .sort()
          .map((subj) => {
            const cells = periods
              .map((p) => {
                const s = bySubject[subj][p.id];
                return `<td>${s == null ? "—" : Number(s).toFixed(1)}</td>`;
              })
              .join("");
            return `<tr><td class="subj">${esc(subj)}</td>${cells}</tr>`;
          })
          .join("");

  // Attendance summary.
  const ac = { present: 0, absent: 0, late: 0, excused: 0 };
  attendance.forEach((r) => {
    if (ac[r.status] != null) ac[r.status] += 1;
  });
  const totalDays = attendance.length;
  const rate = totalDays
    ? Math.round(((ac.present + ac.late) / totalDays) * 100)
    : null;

  const discRows = discipline.length
    ? discipline
        .map(
          (d) =>
            `<tr><td>${esc(formatDate(d.date))}</td><td>${esc(d.type ?? "")}</td><td>${esc(
              d.severity ? t(`enums.disciplineSeverity.${d.severity}`) : "",
            )}</td><td>${d.resolved ? t("enums.disciplineState.resolved") : t("enums.disciplineState.open")}</td><td>${esc(
              d.description ?? "",
            )}</td></tr>`,
        )
        .join("")
    : `<tr><td colspan="5">${t("admin.report.noDiscipline")}</td></tr>`;

  const teacherName =
    document.getElementById("teacher-name")?.textContent ?? "";
  const printed = i18nFormatDate(new Date(), {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const fullName = `${student.first_name} ${student.last_name}`;
  return `<!doctype html>
<html lang="${document.documentElement.lang || "en"}"><head><meta charset="utf-8" />
<title>${esc(t("admin.report.title", { name: fullName }))}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; color: #1a1a1a; margin: 2.2rem; }
  h1 { font-size: 1.4rem; margin: 0; }
  h2 { font-size: 0.95rem; text-transform: uppercase; letter-spacing: .04em; color: #555; border-bottom: 1px solid #ddd; padding-bottom: .3rem; margin: 1.6rem 0 .7rem; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #333; padding-bottom: .8rem; }
  .muted { color: #666; font-size: .85rem; }
  .ident { display: grid; grid-template-columns: 1fr 1fr; gap: .2rem .8rem; font-size: .9rem; margin-top: .4rem; }
  table { width: 100%; border-collapse: collapse; font-size: .85rem; }
  th, td { border: 1px solid #ddd; padding: .45rem .6rem; text-align: center; }
  th { background: #f4f4f4; }
  td.subj, th:first-child { text-align: left; }
  .att span { display: inline-block; margin-right: 1rem; font-size: .9rem; }
  footer { margin-top: 2rem; font-size: .8rem; color: #888; display: flex; justify-content: space-between; }
  @media print { body { margin: 1rem; } }
</style></head>
<body>
  <div class="head">
    <div>
      <h1>${esc(fullName)}</h1>
      <div class="muted">${esc(
        ACTIVE_YEAR?.name
          ? t("admin.report.headerWithYear", { year: ACTIVE_YEAR.name })
          : t("admin.report.header"),
      )}</div>
    </div>
    <div class="muted">${esc(t("admin.report.printed", { date: printed }))}</div>
  </div>

  <div class="ident">
    <div><b>${t("admin.report.enrollment")}</b> ${esc(student.enrollment_number ?? "—")}</div>
    <div><b>${t("admin.report.nationalId")}</b> ${esc(student.national_id ?? "—")}</div>
    <div><b>${t("admin.report.dob")}</b> ${esc(formatDate(student.date_of_birth))}</div>
    <div><b>${t("admin.report.gender")}</b> ${esc(genderLabel(student.gender))}</div>
    <div><b>${t("admin.report.status")}</b> ${esc(student.status ? t(`enums.studentStatus.${student.status}`) : "—")}</div>
    <div><b>${t("admin.report.email")}</b> ${esc(student.email ?? "—")}</div>
  </div>

  <h2>${t("admin.report.gradesBySubject")}</h2>
  <table><thead><tr><th>${t("admin.report.subject")}</th>${periodHeads}</tr></thead><tbody>${gradeRows}</tbody></table>

  <h2>${t("admin.report.attendance")}</h2>
  <div class="att">
    <span><b>${ac.present}</b> ${t("enums.attendanceWord.present")}</span>
    <span><b>${ac.absent}</b> ${t("enums.attendanceWord.absent")}</span>
    <span><b>${ac.late}</b> ${t("enums.attendanceWord.late")}</span>
    <span><b>${ac.excused}</b> ${t("enums.attendanceWord.excused")}</span>
    ${rate != null ? `<span><b>${rate}%</b> ${tn("admin.report.attendanceRate", totalDays, { count: totalDays })}</span>` : ""}
  </div>

  <h2>${t("admin.report.discipline")}</h2>
  <table><thead><tr><th>${t("admin.report.date")}</th><th>${t("admin.report.type")}</th><th>${t("admin.report.severity")}</th><th>${t("admin.report.statusCol")}</th><th>${t("admin.report.description")}</th></tr></thead><tbody>${discRows}</tbody></table>

  <footer>
    <span>${t("admin.report.teacher")} ${esc(teacherName)}</span>
    <span>${t("admin.report.signature")}</span>
  </footer>
</body></html>`;
}

// ───────────────────────────────────────────────────────────────
//  INIT
// ───────────────────────────────────────────────────────────────
if (DEMO_MODE) {
  const logo = document.querySelector("aside .logo");
  if (logo) {
    const badge = document.createElement("span");
    badge.className = "demo-badge";
    badge.dataset.i18n = "admin.demo.badge";
    badge.dataset.i18nTitle = "admin.demo.sandboxNotice";
    badge.textContent = t("admin.demo.badge");
    badge.title = t("admin.demo.sandboxNotice");
    logo.appendChild(badge);
  }
}

try {
  // Resolved separately, not with Promise.all: the year is useful on its own,
  // and pairing the two meant a failure to resolve the teacher also threw away
  // a perfectly good year, leaving every view without its context.
  TEACHER_ID = await db.getTeacherId();
  ACTIVE_YEAR = await db.fetchActiveYear();
  PERIODS = await db.fetchGradingPeriods(ACTIVE_YEAR?.id);

  const teacher = await db.fetchTeacher(TEACHER_ID);
  if (teacher) {
    document.getElementById("teacher-name").textContent =
      `${teacher.first_name} ${teacher.last_name}`;
  } else {
    // Signed in, authorised, but this account owns no teachers row — normally
    // an admin using the console for oversight. That is an expected state, not
    // a failure, so say so plainly rather than flashing an error toast. The
    // element also backs a "Signed in as {name}" line, so it gets the account's
    // own email rather than a status phrase that would not read as a name.
    document.getElementById("teacher-name").textContent =
      session.user.email ?? "";
  }
} catch (err) {
  console.error("Failed to resolve teacher context:", err);
  showToast(t("admin.toast.contextFailed"), "error");
}

showSection("today");
