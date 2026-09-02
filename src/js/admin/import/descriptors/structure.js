// ─────────────────────────────────────────────────────────────────
//  structure.js — CSV import descriptors for the calendar and the
//  sections hung off it. Split out of admin.js.
//
//  These three all bind to the active school year, and sections also
//  resolve grade levels, teachers and rooms by name.
// ─────────────────────────────────────────────────────────────────
import { t } from "../../../i18n.js";
import { state } from "../../state.js";
import { data } from "../../data.js";
import { coerceInt, coerceNum, coerceDate } from "../../domain/enums.js";
import { fmtDate } from "../../ui/format.js";
import { gradeName, teacherName } from "../../domain/lookups.js";
import {
  ensureSchoolYears,
  ensureActiveYear,
  ensureGradeLevels,
  ensureRooms,
  ensureTeachers,
} from "../../domain/references.js";
import { loadYearPeriods } from "../../screens/years.js";
import { loadSections } from "../../screens/sections.js";
import {
  resolveGradeLevel,
  resolveTeacherId,
  resolveRoomId,
} from "../resolvers.js";
import { REQ } from "./messages.js";

export const schoolYears = {
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
};

export const gradingPeriods = {
  table: "grading_periods",
  titleKey: "console.import.entity.gradingPeriods",
  reload: () => loadYearPeriods(),
  uniqueFields: ["period_order"],
  existing: () => state.importPeriods,
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
    state.importPeriods = await data.listPeriods(state.activeYear.id);
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
};

export const sections = {
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
};
