// ─────────────────────────────────────────────────────────────────
//  state.js — shared session + reference state for the admin console.
//  A single mutable object every module imports and mutates in place,
//  the same pattern as teacherState.js / studentState.js.
// ─────────────────────────────────────────────────────────────────

/** Reference lists reused across screens, refreshed by the loaders that own them. */
export const state = {
  /** @type {any} */ session: null,
  /** @type {string|null} */ role: null,
  /** @type {any} */ profile: null, // the signed-in admin's profiles row
  /** @type {{ settings: boolean }} */ loaded: { settings: false },

  /** @type {any} */ activeYear: null,
  /** @type {any[]} */ gradeLevels: [],
  /** @type {any[]} */ rooms: [],
  /** @type {any[]} */ teachers: [],
  /** @type {any[]} */ subjects: [],
  /** @type {any[]} */ sections: [],
  /** @type {any[]} */ students: [],
  /** @type {any[]} */ accounts: [], // login accounts (Accounts screen)
  /** @type {any[]} */ componentTemplates: [], // MEP grade-component schemes
  /** @type {Record<number, any[]>} */ templateItems: {}, // template id → items
  /** @type {any[]} */ schoolYears: [],
  /** @type {any[]} */ periods: [], // active year's grading periods (weight total)
  /** @type {any} */ school: null, // school_settings row: name + ID-field label
  /** @type {string} */ studentFilter: "all", // "all" | "unassigned" | section id
  /** @type {any[]} */ importPeriods: [], // active year's periods, for the import wizard

  // ── Schedules tab ──
  /** @type {any} */ scheduleConfig: null, // active year's structure + school days
  /** @type {any[]} */ bellSchedules: [], // time-block templates
  /** @type {Record<number, any[]>} */ bellBlocks: {}, // template id → its blocks
  /** @type {any[]} */ yearSchedules: [], // every entry of the active year
  /** @type {number|null} */ schedSectionId: null, // section being edited
  /** @type {number|null} */ schedTemplateId: null, // template laying out the grid
  /** @type {number|null} */ schedBellId: null, // template whose blocks are open
};
