import {
  fetchGradingPeriods,
  fetchEvents,
  fetchSchoolSettings,
} from "./supabaseQueries.js";

/**
 * Shared session state for the student portal views. A single mutable
 * object rather than per-field getters/setters — every view module imports
 * the same `state` reference and mutates it in place.
 * @type {{
 *   studentId: number | null,
 *   profile: object | null,
 *   schoolYearId: number | null,
 *   classId: number | null,
 *   periods: Array<object>,
 *   school: object | null,
 * }}
 */
export const state = {
  studentId: null,
  profile: null,
  schoolYearId: null,
  classId: null,
  periods: [],
  // school_settings row: school identity + the MEP pass marks. Read once at
  // bootstrap so the synchronous render helpers can band a score without
  // awaiting. Stays null on a project whose schema predates the table.
  school: null,
};

// Events feed both the dashboard "Upcoming" widget and the Events view.
// Memoized so navigating between them reuses a single round-trip instead of
// re-fetching.
let eventsPromise = null;

/** @returns {Promise<Array<object>>} */
export function getEvents() {
  if (!eventsPromise) eventsPromise = fetchEvents();
  return eventsPromise;
}

// The year's grading periods, shared by the dashboard's Grade Overview
// columns and the Grades view's period picker. Memoized for the same reason
// as events. How many there are is a property of the school year — Costa
// Rica's MEP calendar runs two periodos — so nothing downstream may assume a
// count.
let periodsPromise = null;

/** @returns {Promise<Array<object>>} */
export function getGradingPeriods() {
  if (!periodsPromise) {
    periodsPromise = fetchGradingPeriods(state.schoolYearId);
  }
  return periodsPromise;
}

/**
 * Load the school settings into `state.school`. Called once at bootstrap,
 * before any view renders, so the synchronous score helpers can read the
 * pass mark off state instead of awaiting it mid-render.
 * @returns {Promise<object | null>}
 */
export async function loadSchoolSettings() {
  state.school = await fetchSchoolSettings();
  return state.school;
}
