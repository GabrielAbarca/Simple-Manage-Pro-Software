// ─────────────────────────────────────────────────────────────────
//  adminData.js — data layer for the admin console.
//
//  Two pieces:
//    • a generic table Gateway (select / insert / update / remove),
//      with a Supabase-backed implementation; the demo overlay in
//      adminDemoDb.js is an alternate Gateway.
//    • createAdminData(gateway): declarative read/write methods for the
//      academic-structure tables. Reads are FLAT (one table each) so the
//      demo overlay stays a simple per-table delta store; the controller
//      composes joins from the small reference lists it already holds.
// ─────────────────────────────────────────────────────────────────

import { supabase } from "./supabaseClient.js";

/**
 * @typedef {Object} SelectOpts
 * @property {Record<string, string|number|boolean>} [match] equality filters (col → value)
 * @property {{ column: string, values: Array<string|number> }} [inList] membership filter
 * @property {{ column: string, ascending?: boolean }} [order] sort (ascending defaults true)
 */

/**
 * A minimal table access contract. The real gateway talks to Supabase; the
 * demo gateway (adminDemoDb.js) records writes locally and overlays reads.
 * @typedef {Object} Gateway
 * @property {(table: string, opts?: SelectOpts) => Promise<any[]>} select
 * @property {(table: string, row: object) => Promise<any>} insert returns the created row (with id)
 * @property {(table: string, rows: object[]) => Promise<any[]>} insertMany bulk insert (CSV import)
 * @property {(table: string, id: number, patch: object) => Promise<void>} update
 * @property {(table: string, id: number) => Promise<void>} remove
 */

/** Supabase-backed gateway (real writes). @type {Gateway} */
export const supabaseGateway = {
  async select(table, opts = {}) {
    let q = supabase.from(table).select("*");
    if (opts.match) {
      for (const [col, val] of Object.entries(opts.match)) q = q.eq(col, val);
    }
    if (opts.inList) q = q.in(opts.inList.column, opts.inList.values);
    if (opts.order) {
      q = q.order(opts.order.column, {
        ascending: opts.order.ascending !== false,
      });
    }
    const { data, error } = await q;
    if (error) throw error;
    return data ?? [];
  },

  async insert(table, row) {
    const { data, error } = await supabase
      .from(table)
      .insert(row)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async insertMany(table, rows) {
    const { data, error } = await supabase.from(table).insert(rows).select();
    if (error) throw error;
    return data ?? [];
  },

  async update(table, id, patch) {
    const { error } = await supabase.from(table).update(patch).eq("id", id);
    if (error) throw error;
  },

  async remove(table, id) {
    const { error } = await supabase.from(table).delete().eq("id", id);
    if (error) throw error;
  },
};

/**
 * Declarative admin data methods over a Gateway.
 * @param {Gateway} gateway
 */
export function createAdminData(gateway) {
  return {
    // ── School years ──────────────────────────────────────────
    listSchoolYears: () =>
      gateway.select("school_years", {
        order: { column: "start_date", ascending: false },
      }),
    createSchoolYear: (/** @type {object} */ row) =>
      gateway.insert("school_years", row),
    updateSchoolYear: (/** @type {number} */ id, /** @type {object} */ patch) =>
      gateway.update("school_years", id, patch),
    deleteSchoolYear: (/** @type {number} */ id) =>
      gateway.remove("school_years", id),

    /**
     * Mark one year active, clearing any others (a school has a single active
     * year). `previouslyActive` are the ids currently flagged is_active.
     * @param {number} id
     * @param {number[]} [previouslyActive]
     */
    async setActiveYear(id, previouslyActive = []) {
      for (const prev of previouslyActive) {
        if (prev !== id)
          await gateway.update("school_years", prev, { is_active: false });
      }
      await gateway.update("school_years", id, { is_active: true });
    },

    // ── Grading periods ───────────────────────────────────────
    listPeriods: (/** @type {number} */ yearId) =>
      gateway.select("grading_periods", {
        match: { school_year_id: yearId },
        order: { column: "period_order" },
      }),
    createPeriod: (/** @type {object} */ row) =>
      gateway.insert("grading_periods", row),
    updatePeriod: (/** @type {number} */ id, /** @type {object} */ patch) =>
      gateway.update("grading_periods", id, patch),
    deletePeriod: (/** @type {number} */ id) =>
      gateway.remove("grading_periods", id),

    // ── Grade levels ──────────────────────────────────────────
    listGradeLevels: () =>
      gateway.select("grade_levels", { order: { column: "numeric_level" } }),
    createGradeLevel: (/** @type {object} */ row) =>
      gateway.insert("grade_levels", row),
    updateGradeLevel: (/** @type {number} */ id, /** @type {object} */ patch) =>
      gateway.update("grade_levels", id, patch),
    deleteGradeLevel: (/** @type {number} */ id) =>
      gateway.remove("grade_levels", id),

    // ── Rooms ─────────────────────────────────────────────────
    listRooms: () => gateway.select("rooms", { order: { column: "name" } }),
    createRoom: (/** @type {object} */ row) => gateway.insert("rooms", row),
    updateRoom: (/** @type {number} */ id, /** @type {object} */ patch) =>
      gateway.update("rooms", id, patch),
    deleteRoom: (/** @type {number} */ id) => gateway.remove("rooms", id),

    // ── Sections (classes) ────────────────────────────────────
    listSections: (/** @type {number} */ yearId) =>
      gateway.select("classes", {
        match: { school_year_id: yearId },
        order: { column: "grade_level_id" },
      }),
    createSection: (/** @type {object} */ row) =>
      gateway.insert("classes", row),
    updateSection: (/** @type {number} */ id, /** @type {object} */ patch) =>
      gateway.update("classes", id, patch),
    deleteSection: (/** @type {number} */ id) => gateway.remove("classes", id),

    // ── Subjects ──────────────────────────────────────────────
    listSubjects: () =>
      gateway.select("subjects", { order: { column: "name" } }),
    createSubject: (/** @type {object} */ row) =>
      gateway.insert("subjects", row),
    updateSubject: (/** @type {number} */ id, /** @type {object} */ patch) =>
      gateway.update("subjects", id, patch),
    deleteSubject: (/** @type {number} */ id) => gateway.remove("subjects", id),

    // ── Grade-level ↔ subject mapping ─────────────────────────
    listGradeLevelSubjects: () => gateway.select("grade_level_subjects"),
    createGradeLevelSubject: (/** @type {object} */ row) =>
      gateway.insert("grade_level_subjects", row),
    deleteGradeLevelSubject: (/** @type {number} */ id) =>
      gateway.remove("grade_level_subjects", id),

    // ── MEP grade-component templates ─────────────────────────
    // Admin-owned schemes (cotidiano, tareas, pruebas, …) that teachers
    // instantiate into a gradebook's grade_categories.
    listComponentTemplates: () =>
      gateway.select("grade_component_templates", {
        order: { column: "name" },
      }),
    createComponentTemplate: (/** @type {object} */ row) =>
      gateway.insert("grade_component_templates", row),
    updateComponentTemplate: (
      /** @type {number} */ id,
      /** @type {object} */ patch,
    ) => gateway.update("grade_component_templates", id, patch),
    deleteComponentTemplate: (/** @type {number} */ id) =>
      gateway.remove("grade_component_templates", id),

    /**
     * Mark one template the school default, clearing the others (mirrors
     * setActiveYear — a single default, enforced in the app not the schema).
     * @param {number} id
     * @param {number[]} [previouslyDefault] ids currently flagged is_default
     */
    async setDefaultTemplate(id, previouslyDefault = []) {
      for (const prev of previouslyDefault) {
        if (prev !== id)
          await gateway.update("grade_component_templates", prev, {
            is_default: false,
          });
      }
      await gateway.update("grade_component_templates", id, {
        is_default: true,
      });
    },

    listTemplateItems: (/** @type {number} */ templateId) =>
      gateway.select("grade_component_template_items", {
        match: { template_id: templateId },
        order: { column: "item_order" },
      }),
    createTemplateItem: (/** @type {object} */ row) =>
      gateway.insert("grade_component_template_items", row),
    updateTemplateItem: (
      /** @type {number} */ id,
      /** @type {object} */ patch,
    ) => gateway.update("grade_component_template_items", id, patch),
    deleteTemplateItem: (/** @type {number} */ id) =>
      gateway.remove("grade_component_template_items", id),

    // ── Teachers (records; auth accounts are Phase 3) ─────────
    listTeachers: () =>
      gateway.select("teachers", { order: { column: "last_name" } }),
    createTeacher: (/** @type {object} */ row) =>
      gateway.insert("teachers", row),
    updateTeacher: (/** @type {number} */ id, /** @type {object} */ patch) =>
      gateway.update("teachers", id, patch),
    deleteTeacher: (/** @type {number} */ id) => gateway.remove("teachers", id),

    // ── Class ↔ subject ↔ teacher assignments ─────────────────
    listAssignments: (/** @type {number} */ yearId) =>
      gateway.select("class_subject_teachers", {
        match: { school_year_id: yearId },
      }),
    createAssignment: (/** @type {object} */ row) =>
      gateway.insert("class_subject_teachers", row),
    // Reassigning the teacher is an update, not a delete-and-recreate: grades,
    // assignments and grade categories all cascade off this row's id, so
    // recreating it would take a term's marks with it.
    updateAssignment: (/** @type {number} */ id, /** @type {object} */ patch) =>
      gateway.update("class_subject_teachers", id, patch),
    deleteAssignment: (/** @type {number} */ id) =>
      gateway.remove("class_subject_teachers", id),

    // ── Schedules ─────────────────────────────────────────────
    listSchedules: (/** @type {number} */ classId) =>
      gateway.select("schedules", {
        match: { class_id: classId },
        order: { column: "day_of_week" },
      }),
    /**
     * Every entry of a school year, for cross-section conflict detection.
     * `schedules` has no school_year_id — the year is implied through the
     * class — so the controller passes the year's section ids.
     * @param {number[]} classIds
     */
    listYearSchedules: (classIds) =>
      classIds?.length
        ? gateway.select("schedules", {
            inList: { column: "class_id", values: classIds },
            order: { column: "day_of_week" },
          })
        : Promise.resolve([]),
    createSchedule: (/** @type {object} */ row) =>
      gateway.insert("schedules", row),
    updateSchedule: (/** @type {number} */ id, /** @type {object} */ patch) =>
      gateway.update("schedules", id, patch),
    deleteSchedule: (/** @type {number} */ id) =>
      gateway.remove("schedules", id),

    // ── Schedule configuration (one row per school year) ──────
    /** The year's config, or null before the school has set one. */
    async getScheduleConfig(/** @type {number} */ yearId) {
      const rows = await gateway.select("schedule_configs", {
        match: { school_year_id: yearId },
      });
      return rows[0] ?? null;
    },
    createScheduleConfig: (/** @type {object} */ row) =>
      gateway.insert("schedule_configs", row),
    updateScheduleConfig: (
      /** @type {number} */ id,
      /** @type {object} */ patch,
    ) => gateway.update("schedule_configs", id, patch),

    // ── Bell schedules (reusable time-block templates) ────────
    listBellSchedules: () =>
      gateway.select("bell_schedules", { order: { column: "name" } }),
    createBellSchedule: (/** @type {object} */ row) =>
      gateway.insert("bell_schedules", row),
    updateBellSchedule: (
      /** @type {number} */ id,
      /** @type {object} */ patch,
    ) => gateway.update("bell_schedules", id, patch),
    deleteBellSchedule: (/** @type {number} */ id) =>
      gateway.remove("bell_schedules", id),

    /** Blocks of one template, in running order. */
    listBellBlocks: (/** @type {number} */ bellScheduleId) =>
      gateway.select("bell_schedule_blocks", {
        match: { bell_schedule_id: bellScheduleId },
        order: { column: "block_order" },
      }),
    /** Every block, so the template list can show block counts. */
    listAllBellBlocks: () =>
      gateway.select("bell_schedule_blocks", {
        order: { column: "block_order" },
      }),
    createBellBlock: (/** @type {object} */ row) =>
      gateway.insert("bell_schedule_blocks", row),
    updateBellBlock: (/** @type {number} */ id, /** @type {object} */ patch) =>
      gateway.update("bell_schedule_blocks", id, patch),
    deleteBellBlock: (/** @type {number} */ id) =>
      gateway.remove("bell_schedule_blocks", id),

    // ── Students & enrollment ─────────────────────────────────
    listStudents: () =>
      gateway.select("students", { order: { column: "last_name" } }),
    createStudent: (/** @type {object} */ row) =>
      gateway.insert("students", row),
    updateStudent: (/** @type {number} */ id, /** @type {object} */ patch) =>
      gateway.update("students", id, patch),
    deleteStudent: (/** @type {number} */ id) => gateway.remove("students", id),
    /** Bulk-create students (CSV roster import). @param {object[]} rows */
    bulkCreateStudents: (rows) => gateway.insertMany("students", rows),

    /**
     * Bulk-create rows into any structure table (generic CSV import).
     * @param {string} table
     * @param {object[]} rows
     */
    bulkInsert: (table, rows) => gateway.insertMany(table, rows),

    // ── School settings (single row: name, logo, ID label) ────
    /** The settings row, or null when the table is empty. */
    async getSchoolSettings() {
      const rows = await gateway.select("school_settings");
      return rows[0] ?? null;
    },
    /** Seed the row on a project where it is missing. @param {object} row */
    createSchoolSettings: (row) => gateway.insert("school_settings", row),
    updateSchoolSettings: (
      /** @type {number} */ id,
      /** @type {object} */ patch,
    ) => gateway.update("school_settings", id, patch),

    // ── Overview (school-wide reads) ──────────────────────────
    /** All attendance rows. Aggregated client-side into both overview
     *  figures: the month's rate and the at-risk count. */
    listAllAttendance: () => gateway.select("attendance"),
  };
}
