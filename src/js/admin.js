// ═══════════════════════════════════════════════════════════════
//  admin.js — Simple Manage Pro | Admin Console
//
//  The school director/coordinator portal: where a school gets
//  configured and operated. Role-gated, bilingual, demo-overlay safe.
//
//  Architecture:
//  1. Auth guard + role gate (admin only)
//  2. Data layer  (gateway → real Supabase or demo overlay)
//  3. UI helpers  (toast, modal form, confirm, tables)
//  4. Navigation  (sidebar → view sections)
//  5. Sections    (overview, year & periods, grades & sections,
//                  subjects, teachers & assignments, schedules, settings)
// ═══════════════════════════════════════════════════════════════

import "./errorHandler.js";
import "./speedInsights.js";
import { initTheme, bindThemeToggle } from "./theme.js";
import { initSidebarToggle } from "./ui.js";
import { registerDialog } from "./dialog.js";
import { initControls } from "./controls/index.js";
import { DEMO_MODE } from "./demoMode.js";
import { parseCsv, autoMap } from "./csv.js";
import { initI18n, applyTranslations, t } from "./i18n.js";
import { state } from "./admin/state.js";
import { data } from "./admin/data.js";
import { resolveAdminSession } from "./admin/auth.js";
import { initAdminNav, showSection } from "./admin/nav.js";
import { loadOverview } from "./admin/screens/overview.js";
import { loadYearPeriods } from "./admin/screens/years.js";
import { loadGradesSections } from "./admin/screens/gradesSections.js";
import { loadGradeLevels } from "./admin/screens/gradeLevels.js";
import { loadRooms } from "./admin/screens/rooms.js";
import { loadSections } from "./admin/screens/sections.js";
import { loadSubjects } from "./admin/screens/subjects.js";
import { loadTeachers } from "./admin/screens/teachers.js";
import { loadAssignments } from "./admin/screens/assignments.js";
import { loadAccounts } from "./admin/screens/accounts.js";
import { loadStudents } from "./admin/screens/students.js";
import { loadSettings } from "./admin/screens/settings.js";
import { loadSchedulesTab } from "./admin/schedules/index.js";
import { escapeHtml, fmtDate } from "./admin/ui/format.js";
import { showToast, errorText } from "./admin/ui/feedback.js";
import {
  loadSchoolSettings,
  applyIdLabels,
} from "./admin/domain/schoolProfile.js";
import { gradeName, teacherName, sectionName } from "./admin/domain/lookups.js";
import {
  ROOM_TYPES,
  TEACHER_STATUSES,
  genderLabel,
  coerceGender,
  coerceDate,
  coerceInt,
  coerceNum,
  coerceEnum,
} from "./admin/domain/enums.js";
import {
  ensureSchoolYears,
  ensureActiveYear,
  ensureGradeLevels,
  ensureRooms,
  ensureTeachers,
} from "./admin/domain/references.js";

// ───────────────────────────────────────────────────────────────
//  1. AUTH GUARD + ROLE GATE
// ───────────────────────────────────────────────────────────────
const { session, role } = await resolveAdminSession();
state.session = session;
state.role = role;

// ───────────────────────────────────────────────────────────────
//  NAVIGATION + PAGE BOOTSTRAP
// ───────────────────────────────────────────────────────────────
const closeNav = initSidebarToggle();

initAdminNav(
  {
    overview: loadOverview,
    yearperiods: loadYearPeriods,
    gradessections: loadGradesSections,
    subjects: loadSubjects,
    schedules: loadSchedulesTab,
    teachers: loadTeachers,
    assignments: loadAssignments,
    students: loadStudents,
    accounts: loadAccounts,
    settings: loadSettings,
  },
  closeNav,
);

initTheme();
bindThemeToggle(document.querySelector(".theme-toggler"));
initI18n("admin");
applyTranslations();

// Enhance every <select> and <input type="date"> — now and whenever the app
// renders more. Must run AFTER initI18n/applyTranslations: the date picker
// takes its month names, field order and week start from the active locale.
initControls();

// ── CSV import (generic, descriptor-driven) ────────────────────
// One import wizard drives every structure table. Each entity is a
// descriptor: which fields to map (+ header aliases), how to turn a mapped
// row into a DB payload (resolving foreign keys by name), which fields must
// be unique, and how to preview + reload. Students keep an optional
// "enroll into section" target; sections/periods bind to the active year.
const importOverlay = document.getElementById("import-overlay");
const importBody = document.getElementById("import-body");
const importFooter = document.getElementById("import-footer");

// ── name→id resolvers ─────────────────────────────────────────
function resolveGradeLevel(raw) {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase();
  const n = Number(raw);
  return (
    state.gradeLevels.find(
      (g) =>
        (!Number.isNaN(n) && s !== "" && g.numeric_level === n) ||
        g.name.toLowerCase() === s,
    ) ?? null
  );
}
function resolveTeacherId(raw) {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (!s) return null;
  const tch = state.teachers.find(
    (x) =>
      (x.email && x.email.toLowerCase() === s) ||
      `${x.first_name} ${x.last_name}`.toLowerCase() === s,
  );
  return tch ? tch.id : null;
}
function resolveRoomId(raw) {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (!s) return null;
  const r = state.rooms.find((x) => x.name.toLowerCase() === s);
  return r ? r.id : null;
}

const REQ = (key) => t("console.import.errRequired", { field: t(key) });

// ── Entity descriptors ─────────────────────────────────────────
const IMPORT_DESCRIPTORS = {
  students: {
    table: "students",
    titleKey: "console.import.entity.students",
    reload: () => loadStudents(),
    targetSection: true,
    uniqueFields: ["enrollment_number"],
    autogen: {
      field: "enrollment_number",
      make: (i) =>
        `S-${Date.now().toString(36)}-${i}-${Math.floor(Math.random() * 1e4)}`,
    },
    existing: () => state.students,
    fields: [
      {
        key: "first_name",
        labelKey: "console.students.firstName",
        required: true,
        aliases: ["first name", "firstname", "nombre", "nombres", "given name"],
      },
      {
        key: "last_name",
        labelKey: "console.students.lastName",
        required: true,
        aliases: ["last name", "lastname", "apellido", "apellidos", "surname"],
      },
      {
        key: "enrollment_number",
        labelKey: "console.students.enrollmentNumber",
        aliases: [
          "enrollment number",
          "enrollment",
          "matricula",
          "matrícula",
          "student id",
          "studentid",
          "carnet",
          "id",
        ],
      },
      {
        key: "national_id",
        labelKey: "console.students.nationalId",
        aliases: ["national id", "nationalid", "cedula", "cédula", "dni"],
      },
      {
        key: "gender",
        labelKey: "console.students.gender",
        aliases: ["gender", "sex", "genero", "género", "sexo"],
      },
      {
        key: "date_of_birth",
        labelKey: "console.students.dateOfBirth",
        aliases: [
          "date of birth",
          "dob",
          "birthdate",
          "fecha de nacimiento",
          "nacimiento",
        ],
      },
      {
        key: "email",
        labelKey: "console.students.email",
        aliases: ["email", "correo", "e-mail", "mail"],
      },
      {
        key: "phone",
        labelKey: "console.students.phone",
        aliases: ["phone", "telefono", "teléfono", "celular", "mobile", "tel"],
      },
    ],
    async prepare() {
      if (!state.students.length) state.students = await data.listStudents();
      await ensureActiveYear();
      if (state.activeYear)
        state.sections = await data.listSections(state.activeYear.id);
      if (!state.gradeLevels.length)
        state.gradeLevels = await data.listGradeLevels();
      return { ok: true, ctx: {} };
    },
    resolve(get, ctx) {
      const first = get("first_name");
      const last = get("last_name");
      if (!first || !last) return { error: t("console.import.errMissingName") };
      return {
        payload: {
          first_name: first,
          last_name: last,
          enrollment_number: get("enrollment_number") || null,
          national_id: get("national_id") || null,
          gender: coerceGender(get("gender")),
          date_of_birth: coerceDate(get("date_of_birth")),
          email: get("email") || null,
          phone: get("phone") || null,
          class_id: ctx.targetSection ?? null,
          status: "active",
        },
      };
    },
    previewCols: [
      {
        labelKey: "console.students.name",
        get: (p) => `${p.first_name} ${p.last_name}`,
      },
      {
        labelKey: "console.students.enrollmentNumber",
        get: (p) => p.enrollment_number,
      },
      {
        labelKey: "console.students.gender",
        get: (p) => genderLabel(p.gender),
      },
    ],
  },

  teachers: {
    table: "teachers",
    titleKey: "console.import.entity.teachers",
    reload: () => loadTeachers(),
    uniqueFields: ["national_id", "email"],
    existing: () => state.teachers,
    fields: [
      {
        key: "first_name",
        labelKey: "console.teachers.firstName",
        required: true,
        aliases: ["first name", "firstname", "nombre", "nombres"],
      },
      {
        key: "last_name",
        labelKey: "console.teachers.lastName",
        required: true,
        aliases: ["last name", "lastname", "apellido", "apellidos"],
      },
      {
        key: "national_id",
        labelKey: "console.teachers.nationalId",
        aliases: ["national id", "cedula", "cédula", "dni", "id"],
      },
      {
        key: "email",
        labelKey: "console.teachers.email",
        aliases: ["email", "correo", "e-mail", "mail"],
      },
      {
        key: "phone",
        labelKey: "console.teachers.phone",
        aliases: ["phone", "telefono", "teléfono", "celular"],
      },
      {
        key: "specialization",
        labelKey: "console.teachers.specialization",
        aliases: [
          "specialization",
          "especializacion",
          "especialización",
          "subject",
          "area",
        ],
      },
      {
        key: "status",
        labelKey: "console.teachers.status",
        aliases: ["status", "estado"],
      },
    ],
    async prepare() {
      await ensureTeachers();
      return { ok: true, ctx: {} };
    },
    resolve(get) {
      const first = get("first_name");
      const last = get("last_name");
      if (!first || !last) return { error: t("console.import.errMissingName") };
      return {
        payload: {
          first_name: first,
          last_name: last,
          national_id: get("national_id") || null,
          email: get("email") || null,
          phone: get("phone") || null,
          specialization: get("specialization") || null,
          status: coerceEnum(get("status"), TEACHER_STATUSES, "active"),
        },
      };
    },
    previewCols: [
      {
        labelKey: "console.teachers.name",
        get: (p) => `${p.first_name} ${p.last_name}`,
      },
      { labelKey: "console.teachers.email", get: (p) => p.email ?? "—" },
      {
        labelKey: "console.teachers.specialization",
        get: (p) => p.specialization ?? "—",
      },
    ],
  },

  subjects: {
    table: "subjects",
    titleKey: "console.import.entity.subjects",
    reload: () => loadSubjects(),
    uniqueFields: ["name", "code"],
    existing: () => state.subjects,
    fields: [
      {
        key: "name",
        labelKey: "console.subjects.name",
        required: true,
        aliases: ["name", "nombre", "subject", "materia"],
      },
      {
        key: "code",
        labelKey: "console.subjects.code",
        aliases: ["code", "codigo", "código", "abbr"],
      },
      {
        key: "color",
        labelKey: "console.subjects.color",
        aliases: ["color", "colour"],
      },
      {
        key: "description",
        labelKey: "console.subjects.description",
        aliases: ["description", "descripcion", "descripción"],
      },
    ],
    async prepare() {
      if (!state.subjects.length) state.subjects = await data.listSubjects();
      return { ok: true, ctx: {} };
    },
    resolve(get) {
      const name = get("name");
      if (!name) return { error: REQ("console.subjects.name") };
      const color = get("color");
      return {
        payload: {
          name,
          code: get("code") || null,
          color: /^#?[0-9a-fA-F]{6}$/.test(color)
            ? color.startsWith("#")
              ? color
              : `#${color}`
            : null,
          description: get("description") || null,
        },
      };
    },
    previewCols: [
      { labelKey: "console.subjects.name", get: (p) => p.name },
      { labelKey: "console.subjects.code", get: (p) => p.code ?? "—" },
    ],
  },

  gradeLevels: {
    table: "grade_levels",
    titleKey: "console.import.entity.gradeLevels",
    reload: () => loadGradeLevels(),
    uniqueFields: ["name", "numeric_level"],
    existing: () => state.gradeLevels,
    fields: [
      {
        key: "numeric_level",
        labelKey: "console.grades.level",
        required: true,
        aliases: ["level", "numeric level", "nivel", "grade", "grado"],
      },
      {
        key: "name",
        labelKey: "console.grades.name",
        required: true,
        aliases: ["name", "nombre", "grade name", "grado"],
      },
    ],
    async prepare() {
      await ensureGradeLevels();
      return { ok: true, ctx: {} };
    },
    resolve(get) {
      const name = get("name");
      const level = coerceInt(get("numeric_level"));
      if (!name) return { error: REQ("console.grades.name") };
      if (level == null) return { error: REQ("console.grades.level") };
      return { payload: { name, numeric_level: level } };
    },
    previewCols: [
      { labelKey: "console.grades.level", get: (p) => p.numeric_level },
      { labelKey: "console.grades.name", get: (p) => p.name },
    ],
  },

  rooms: {
    table: "rooms",
    titleKey: "console.import.entity.rooms",
    reload: () => loadRooms(),
    uniqueFields: ["name"],
    existing: () => state.rooms,
    fields: [
      {
        key: "name",
        labelKey: "console.rooms.name",
        required: true,
        aliases: ["name", "nombre", "room", "aula"],
      },
      {
        key: "capacity",
        labelKey: "console.rooms.capacity",
        aliases: ["capacity", "capacidad", "seats"],
      },
      {
        key: "type",
        labelKey: "console.rooms.type",
        aliases: ["type", "tipo", "kind"],
      },
    ],
    async prepare() {
      await ensureRooms();
      return { ok: true, ctx: {} };
    },
    resolve(get) {
      const name = get("name");
      if (!name) return { error: REQ("console.rooms.name") };
      return {
        payload: {
          name,
          capacity: coerceInt(get("capacity")),
          type: coerceEnum(get("type"), ROOM_TYPES, "classroom"),
        },
      };
    },
    previewCols: [
      { labelKey: "console.rooms.name", get: (p) => p.name },
      { labelKey: "console.rooms.capacity", get: (p) => p.capacity ?? "—" },
      {
        labelKey: "console.rooms.type",
        get: (p) => t(`console.rooms.types.${p.type}`),
      },
    ],
  },

  schoolYears: {
    table: "school_years",
    titleKey: "console.import.entity.schoolYears",
    reload: () => loadYearPeriods(),
    uniqueFields: ["name"],
    existing: () => state.schoolYears,
    fields: [
      {
        key: "name",
        labelKey: "console.years.name",
        required: true,
        aliases: ["name", "nombre", "year", "año", "ciclo"],
      },
      {
        key: "start_date",
        labelKey: "console.years.start",
        required: true,
        aliases: ["start", "start date", "inicio", "fecha inicio"],
      },
      {
        key: "end_date",
        labelKey: "console.years.end",
        required: true,
        aliases: ["end", "end date", "fin", "fecha fin"],
      },
    ],
    async prepare() {
      await ensureSchoolYears();
      return { ok: true, ctx: {} };
    },
    resolve(get) {
      const name = get("name");
      if (!name) return { error: REQ("console.years.name") };
      const start = coerceDate(get("start_date"));
      const end = coerceDate(get("end_date"));
      if (!start || !end) return { error: t("console.import.errDates") };
      // Never activate on import — the admin sets the active year in the UI.
      return {
        payload: { name, start_date: start, end_date: end, is_active: false },
      };
    },
    previewCols: [
      { labelKey: "console.years.name", get: (p) => p.name },
      { labelKey: "console.years.start", get: (p) => fmtDate(p.start_date) },
      { labelKey: "console.years.end", get: (p) => fmtDate(p.end_date) },
    ],
  },

  gradingPeriods: {
    table: "grading_periods",
    titleKey: "console.import.entity.gradingPeriods",
    reload: () => loadYearPeriods(),
    uniqueFields: ["period_order"],
    existing: () => state._importPeriods ?? [],
    fields: [
      {
        key: "period_order",
        labelKey: "console.periods.order",
        required: true,
        aliases: ["order", "period", "número", "numero", "orden", "#"],
      },
      {
        key: "name",
        labelKey: "console.periods.name",
        required: true,
        aliases: ["name", "nombre", "period name"],
      },
      {
        key: "start_date",
        labelKey: "console.periods.start",
        required: true,
        aliases: ["start", "start date", "inicio"],
      },
      {
        key: "end_date",
        labelKey: "console.periods.end",
        required: true,
        aliases: ["end", "end date", "fin"],
      },
      {
        key: "weight",
        labelKey: "console.periods.weight",
        aliases: ["weight", "peso", "percent", "porcentaje"],
      },
    ],
    async prepare() {
      await ensureActiveYear();
      if (!state.activeYear)
        return { ok: false, error: t("console.periods.noYear") };
      state._importPeriods = await data.listPeriods(state.activeYear.id);
      return { ok: true, ctx: { activeYear: state.activeYear } };
    },
    resolve(get, ctx) {
      const name = get("name");
      const order = coerceInt(get("period_order"));
      if (order == null) return { error: REQ("console.periods.order") };
      if (!name) return { error: REQ("console.periods.name") };
      const start = coerceDate(get("start_date"));
      const end = coerceDate(get("end_date"));
      if (!start || !end) return { error: t("console.import.errDates") };
      return {
        payload: {
          name,
          period_order: order,
          start_date: start,
          end_date: end,
          weight: coerceNum(get("weight")) ?? 50,
          school_year_id: ctx.activeYear.id,
        },
      };
    },
    previewCols: [
      { labelKey: "console.periods.order", get: (p) => p.period_order },
      { labelKey: "console.periods.name", get: (p) => p.name },
    ],
  },

  sections: {
    table: "classes",
    titleKey: "console.import.entity.sections",
    reload: () => loadSections(),
    // Composite unique (grade + section within the active year).
    dedupKey: (p) => `${p.grade_level_id}|${p.section.toLowerCase()}`,
    existingKeys: () =>
      new Set(
        state.sections.map(
          (s) => `${s.grade_level_id}|${String(s.section).toLowerCase()}`,
        ),
      ),
    dupErrorKey: "console.import.errDupSection",
    fields: [
      {
        key: "grade",
        labelKey: "console.sections.grade",
        required: true,
        aliases: ["grade", "grade level", "grado", "nivel", "level"],
      },
      {
        key: "section",
        labelKey: "console.sections.section",
        required: true,
        aliases: ["section", "seccion", "sección", "group", "grupo"],
      },
      {
        key: "homeroom",
        labelKey: "console.sections.homeroom",
        aliases: [
          "homeroom",
          "homeroom teacher",
          "guia",
          "guía",
          "teacher",
          "docente",
        ],
      },
      {
        key: "room",
        labelKey: "console.sections.room",
        aliases: ["room", "aula", "classroom"],
      },
      {
        key: "max_capacity",
        labelKey: "console.sections.capacity",
        aliases: ["capacity", "max capacity", "capacidad", "cupo"],
      },
    ],
    async prepare() {
      await ensureActiveYear();
      if (!state.activeYear)
        return { ok: false, error: t("console.sections.noYear") };
      await ensureGradeLevels();
      if (!state.gradeLevels.length)
        return { ok: false, error: t("console.sections.needGrade") };
      await ensureTeachers();
      await ensureRooms();
      state.sections = await data.listSections(state.activeYear.id);
      return { ok: true, ctx: { activeYear: state.activeYear } };
    },
    resolve(get, ctx) {
      const sectionCode = get("section");
      const gradeRaw = get("grade");
      if (!sectionCode) return { error: REQ("console.sections.section") };
      if (!gradeRaw) return { error: REQ("console.sections.grade") };
      const gl = resolveGradeLevel(gradeRaw);
      if (!gl)
        return {
          error: t("console.import.errUnknownGrade", { value: gradeRaw }),
        };
      return {
        payload: {
          grade_level_id: gl.id,
          section: sectionCode,
          display_name: `${gl.numeric_level}${sectionCode}`,
          homeroom_teacher_id: resolveTeacherId(get("homeroom")),
          room_id: resolveRoomId(get("room")),
          max_capacity: coerceInt(get("max_capacity")) ?? 30,
          school_year_id: ctx.activeYear.id,
        },
      };
    },
    previewCols: [
      {
        labelKey: "console.sections.grade",
        get: (p) => gradeName(p.grade_level_id),
      },
      { labelKey: "console.sections.section", get: (p) => p.section },
      {
        labelKey: "console.sections.homeroom",
        get: (p) =>
          p.homeroom_teacher_id ? teacherName(p.homeroom_teacher_id) : "—",
      },
    ],
  },
};

let importCtx = null;

async function openImportModal(key) {
  const descriptor = IMPORT_DESCRIPTORS[key];
  if (!descriptor) return;
  let prep;
  try {
    prep = await descriptor.prepare();
  } catch (err) {
    showToast(errorText(err), "error");
    return;
  }
  if (!prep.ok) {
    showToast(prep.error, "error");
    return;
  }
  importCtx = {
    descriptor,
    ctx: prep.ctx ?? {},
    text: "",
    targetSection: "",
    parsed: null,
    mapping: null,
  };
  document.getElementById("import-title").textContent = t(descriptor.titleKey);
  importOverlay.classList.add("active");
  renderImportSource();
}

function closeImportModal() {
  importOverlay.classList.remove("active");
  importBody.innerHTML = "";
  importFooter.innerHTML = "";
  importCtx = null;
}

function importFooterButtons(buttons) {
  importFooter.innerHTML = "";
  buttons.forEach(({ label, kind, onClick, disabled }) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `btn ${kind}`;
    b.textContent = label;
    if (disabled) b.disabled = true;
    else b.addEventListener("click", onClick);
    importFooter.appendChild(b);
  });
}

// Step 1 — paste or upload; students also pick an optional target section.
function renderImportSource() {
  const d = importCtx.descriptor;
  const placeholder = d.fields.map((f) => f.key).join(",");
  const sectionBlock = d.targetSection
    ? `<div class="field-group">
         <label for="import-section">${escapeHtml(t("console.import.targetSection"))}</label>
         <select id="import-section">
           <option value="">${escapeHtml(t("console.import.noSection"))}</option>
           ${state.sections.map((s) => `<option value="${s.id}"${String(s.id) === String(importCtx.targetSection) ? " selected" : ""}>${escapeHtml(sectionName(s))}</option>`).join("")}
         </select>
       </div>`
    : "";

  importBody.innerHTML = `
    <p class="import-help">${escapeHtml(t("console.import.sourceHelp"))}</p>
    <div class="field-group">
      <label for="import-file">${escapeHtml(t("console.import.chooseFile"))}</label>
      <input type="file" id="import-file" accept=".csv,.tsv,.txt,text/csv" />
    </div>
    <div class="field-group">
      <label for="import-text">${escapeHtml(t("console.import.orPaste"))}</label>
      <textarea id="import-text" rows="6" placeholder="${escapeHtml(placeholder)}">${escapeHtml(importCtx.text)}</textarea>
    </div>
    ${sectionBlock}`;

  const fileInput = /** @type {HTMLInputElement} */ (
    document.getElementById("import-file")
  );
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    const text = await file.text();
    /** @type {HTMLTextAreaElement} */ (
      document.getElementById("import-text")
    ).value = text;
  });

  importFooterButtons([
    { label: t("common.cancel"), kind: "btn-ghost", onClick: closeImportModal },
    {
      label: t("console.import.next"),
      kind: "btn-primary",
      onClick: () => {
        importCtx.text = /** @type {HTMLTextAreaElement} */ (
          document.getElementById("import-text")
        ).value;
        if (d.targetSection) {
          importCtx.targetSection = /** @type {HTMLSelectElement} */ (
            document.getElementById("import-section")
          ).value;
        }
        const parsed = parseCsv(importCtx.text);
        if (!parsed.headers.length || !parsed.rows.length) {
          showToast(t("console.import.noData"), "error");
          return;
        }
        importCtx.parsed = parsed;
        const aliasMap = Object.fromEntries(
          d.fields.map((f) => [f.key, f.aliases ?? [f.key]]),
        );
        importCtx.mapping = autoMap(parsed.headers, aliasMap);
        renderImportMapping();
      },
    },
  ]);
}

// Step 2 — map each target field to a source column.
function renderImportMapping() {
  const d = importCtx.descriptor;
  const { headers, rows } = importCtx.parsed;
  const rowsHtml = d.fields
    .map((f) => {
      const opts = [
        `<option value="">${escapeHtml(t("common.none"))}</option>`,
        ...headers.map(
          (h) =>
            `<option value="${escapeHtml(h)}"${importCtx.mapping[f.key] === h ? " selected" : ""}>${escapeHtml(h)}</option>`,
        ),
      ].join("");
      return `<div class="map-row">
        <span class="map-label">${escapeHtml(t(f.labelKey))}${f.required ? ' <b class="req">*</b>' : ""}</span>
        <select data-field="${f.key}">${opts}</select>
      </div>`;
    })
    .join("");

  importBody.innerHTML = `
    <p class="import-help">${escapeHtml(t("console.import.mapHelp", { count: rows.length }))}</p>
    <div class="map-grid">${rowsHtml}</div>`;

  importBody.querySelectorAll("select[data-field]").forEach((sel) => {
    sel.addEventListener("change", (e) => {
      const el = /** @type {HTMLSelectElement} */ (e.target);
      importCtx.mapping[el.dataset.field] = el.value;
    });
  });

  importFooterButtons([
    {
      label: t("console.import.back"),
      kind: "btn-ghost",
      onClick: renderImportSource,
    },
    {
      label: t("console.import.preview"),
      kind: "btn-primary",
      onClick: renderImportPreview,
    },
  ]);
}

// Build normalized payloads + validation report from the current mapping.
function buildImportRows() {
  const d = importCtx.descriptor;
  const { rows } = importCtx.parsed;
  const map = importCtx.mapping;
  const rowGet = (row) => (key) =>
    map[key] ? (row[map[key]] ?? "").trim() : "";
  const ctx = { ...importCtx.ctx };
  if (d.targetSection)
    ctx.targetSection = importCtx.targetSection
      ? Number(importCtx.targetSection)
      : null;

  const uniqueFields = d.uniqueFields ?? [];
  const existingSets = {};
  const seen = {};
  uniqueFields.forEach((uf) => {
    existingSets[uf] = new Set(
      (d.existing?.() ?? [])
        .map((r) => r[uf])
        .filter((v) => v != null && v !== "")
        .map(String),
    );
    seen[uf] = new Set();
  });
  const existingKeys = d.existingKeys ? d.existingKeys() : null;
  const seenKeys = new Set();

  const valid = [];
  const errors = [];

  rows.forEach((row, i) => {
    const line = i + 2; // 1-based + header row
    const res = d.resolve(rowGet(row), ctx);
    if (res.error) {
      errors.push({ line, reason: res.error });
      return;
    }
    const p = res.payload;

    // Auto-generate a value where the source left a unique field blank.
    if (d.autogen) {
      const f = d.autogen.field;
      if (p[f] == null || p[f] === "") {
        let v;
        do {
          v = d.autogen.make(valid.length);
        } while (existingSets[f]?.has(String(v)) || seen[f]?.has(String(v)));
        p[f] = v;
      }
    }

    // Per-field uniqueness.
    let dup = false;
    for (const uf of uniqueFields) {
      const v = p[uf];
      if (v == null || v === "") continue;
      if (existingSets[uf].has(String(v)) || seen[uf].has(String(v))) {
        const label = d.fields.find((f) => f.key === uf)?.labelKey;
        errors.push({
          line,
          reason: t("console.import.errDuplicate", {
            field: label ? t(label) : uf,
            value: v,
          }),
        });
        dup = true;
        break;
      }
    }
    if (dup) return;

    // Composite uniqueness (e.g., grade+section).
    if (existingKeys) {
      const k = d.dedupKey(p);
      if (existingKeys.has(k) || seenKeys.has(k)) {
        errors.push({ line, reason: t(d.dupErrorKey) });
        return;
      }
      seenKeys.add(k);
    }

    uniqueFields.forEach((uf) => {
      if (p[uf] != null && p[uf] !== "") seen[uf].add(String(p[uf]));
    });
    valid.push(p);
  });
  return { valid, errors };
}

// Step 3 — preview valid rows + validation summary, then import.
function renderImportPreview() {
  const d = importCtx.descriptor;
  const { valid, errors } = buildImportRows();
  const preview = valid.slice(0, 8);
  const headHtml = d.previewCols
    .map((c) => `<th>${escapeHtml(t(c.labelKey))}</th>`)
    .join("");
  const previewRows = preview
    .map(
      (p) =>
        `<tr>${d.previewCols.map((c) => `<td>${escapeHtml(c.get(p) ?? "—")}</td>`).join("")}</tr>`,
    )
    .join("");
  const errorList = errors
    .slice(0, 8)
    .map(
      (e) =>
        `<li>${escapeHtml(t("console.import.lineLabel", { line: e.line }))}: ${escapeHtml(e.reason)}</li>`,
    )
    .join("");

  importBody.innerHTML = `
    <div class="import-summary">
      <span class="badge badge-success">${escapeHtml(t("console.import.willImport", { count: valid.length }))}</span>
      ${errors.length ? `<span class="badge badge-warning">${escapeHtml(t("console.import.willSkip", { count: errors.length }))}</span>` : ""}
    </div>
    ${
      valid.length
        ? `<div class="table-scroll"><table class="data-table">
            <thead><tr>${headHtml}</tr></thead><tbody>${previewRows}</tbody></table></div>
           ${valid.length > preview.length ? `<p class="import-help">${escapeHtml(t("console.import.andMore", { count: valid.length - preview.length }))}</p>` : ""}`
        : `<p class="import-help">${escapeHtml(t("console.import.nothingValid"))}</p>`
    }
    ${errors.length ? `<div class="import-errors"><h3>${escapeHtml(t("console.import.skippedRows"))}</h3><ul>${errorList}</ul>${errors.length > 8 ? `<p class="import-help">${escapeHtml(t("console.import.andMore", { count: errors.length - 8 }))}</p>` : ""}</div>` : ""}`;

  importFooterButtons([
    {
      label: t("console.import.back"),
      kind: "btn-ghost",
      onClick: renderImportMapping,
    },
    {
      label: t("console.import.doImport", { count: valid.length }),
      kind: "btn-primary",
      disabled: valid.length === 0,
      onClick: async () => {
        try {
          await data.bulkInsert(d.table, valid);
          showToast(t("console.import.done", { count: valid.length }));
          closeImportModal();
          d.reload();
        } catch (err) {
          showToast(errorText(err), "error");
        }
      },
    },
  ]);
}

// Wire every section's "Import CSV" button to its descriptor.
const IMPORT_BUTTONS = {
  "btn-import-csv": "students",
  "btn-import-teachers": "teachers",
  "btn-import-subjects": "subjects",
  "btn-import-grades": "gradeLevels",
  "btn-import-rooms": "rooms",
  "btn-import-sections": "sections",
  "btn-import-years": "schoolYears",
  "btn-import-periods": "gradingPeriods",
};
Object.entries(IMPORT_BUTTONS).forEach(([id, key]) => {
  document
    .getElementById(id)
    ?.addEventListener("click", () => openImportModal(key));
});
// Backdrop clicks are ignored here too — a pasted roster and its column
// mapping are exactly the kind of work a stray click used to destroy.
document
  .getElementById("import-close")
  .addEventListener("click", closeImportModal);

// Focus trap, Escape, focus-in on open and focus-back-to-trigger on close.
// The form and confirm dialogs register themselves in their own modules.
registerDialog(importOverlay, { close: closeImportModal });

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

// Read the school profile up front: the ID-field label it carries is needed by
// the teachers/students tables and their create forms, whichever loads first.
loadSchoolSettings().then(applyIdLabels);

loadOverview();
showSection("overview");
