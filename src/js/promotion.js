// ─────────────────────────────────────────────────────────────────
//  promotion.js — the MEP pass mark, in one place.
//
//  Costa Rica's REAC 2026 sets the promotion minimum at 70 for III ciclo
//  and Educación Diversificada. The number is per-school rather than a
//  constant because primaria runs at 65, so it lives in
//  school_settings.passing_score and everything here resolves against
//  that row.
//
//  Pure on purpose: every function takes the settings row explicitly so
//  it is unit-testable without a portal, a DOM or a session. The portals
//  hold the row in their own state module and pass it in.
// ─────────────────────────────────────────────────────────────────

/**
 * Fallback when the settings row is unreadable or predates the column.
 * School schemas are applied by hand, so a project that has not run
 * incremental_school_settings.sql must still render a correct verdict —
 * and 70 is the secondary-school minimum this product ships for.
 */
export const DEFAULT_PASSING_SCORE = 70;

/** Conducta carries the same floor in secondary. @see DEFAULT_PASSING_SCORE */
export const DEFAULT_CONDUCT_PASSING_SCORE = 70;

// How far above the pass mark a score has to sit to read as comfortable
// rather than borderline. Preserves the teacher console's original 70/75
// colour split now that the lower bound is configurable.
const MERIT_MARGIN = 5;

/**
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function resolveMark(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : fallback;
}

/**
 * The school's promotion minimum.
 * @param {{ passing_score?: unknown } | null | undefined} settings school_settings row
 * @returns {number}
 */
export function passingScore(settings) {
  return resolveMark(settings?.passing_score, DEFAULT_PASSING_SCORE);
}

/**
 * The school's conducta minimum.
 * @param {{ conduct_passing_score?: unknown } | null | undefined} settings
 * @returns {number}
 */
export function conductPassingScore(settings) {
  return resolveMark(
    settings?.conduct_passing_score,
    DEFAULT_CONDUCT_PASSING_SCORE,
  );
}

/**
 * Whether a score promotes. An ungraded subject is not a failure.
 * @param {unknown} score
 * @param {{ passing_score?: unknown } | null | undefined} settings
 * @returns {boolean}
 */
export function isPassing(score, settings) {
  if (score === null || score === undefined || score === "") return false;
  const n = Number(score);
  return Number.isFinite(n) && n >= passingScore(settings);
}

/**
 * Colour band for a score, relative to the school's pass mark. Returns the
 * shared .score-low / .score-mid / .score-high classes from style.css, or
 * "" when there is no score to colour (never a coloured zero).
 * @param {unknown} score
 * @param {{ passing_score?: unknown } | null | undefined} settings
 * @returns {string}
 */
export function bandClass(score, settings) {
  if (score === null || score === undefined || score === "") return "";
  const n = Number(score);
  if (!Number.isFinite(n)) return "";
  const mark = passingScore(settings);
  if (n < mark) return "score-low";
  if (n < mark + MERIT_MARGIN) return "score-mid";
  return "score-high";
}
