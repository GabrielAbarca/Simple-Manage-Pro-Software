// ─────────────────────────────────────────────────────────────────
//  validate.js — declarative field validation for the admin console.
//
//  The create/edit forms used to lean on the browser's own validation,
//  which surfaces errors as native popups (unstyled, untranslatable, one
//  at a time) and lets anything it can't express through — a letter in a
//  numeric field became NaN on its way to the database.
//
//  This module owns the rules. Each rule is a small function of
//  (value, siblingValues) that returns either null or a MESSAGE
//  DESCRIPTOR — an i18n key plus its interpolation vars, never a
//  translated string. Keeping translation out means the rules stay pure
//  and unit-testable, and the caller (admin.js) renders each message
//  inline under its field via t().
//
//  Every rule tolerates a blank value except required(): "optional but
//  well-formed if present" is the common case (national ID, phone).
// ─────────────────────────────────────────────────────────────────

/**
 * An untranslated validation message: an i18n key plus its {token} vars.
 * @typedef {{ key: string, vars?: Record<string, string|number> }} Message
 */

/**
 * A single check. Receives the field's raw string value plus every other
 * value in the form, so cross-field rules (end after start, capacity within
 * the chosen room) work the same way as single-field ones.
 * @typedef {(value: string, values: Record<string, any>) => Message | null} Rule
 */

/** Same shape the login form accepts — one @, one dot, no whitespace. */
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Digits, spaces, + and - only (LatAm numbers are written many ways). */
export const PHONE_RE = /^[\d+\-\s]+$/;

/** Supabase Auth's minimum password length. */
export const MIN_PASSWORD_LENGTH = 6;

/**
 * @param {string} key i18n key
 * @param {Record<string, any>} [vars] interpolation values
 * @returns {Message}
 */
function msg(key, vars) {
  return { key, ...(vars ? { vars } : {}) };
}

/** Blank means "absent" — only required() treats it as a failure. */
function isBlank(/** @type {any} */ value) {
  return value == null || String(value).trim() === "";
}

const normalize = (/** @type {any} */ v) => String(v ?? "").trim();

// ── Presence ─────────────────────────────────────────────────────

/** @returns {Rule} */
export const required = () => (v) =>
  isBlank(v) ? msg("validation.required") : null;

// ── Formats ──────────────────────────────────────────────────────

/** @returns {Rule} */
export const email = () => (v) =>
  isBlank(v) || EMAIL_RE.test(normalize(v)) ? null : msg("validation.email");

/** @returns {Rule} */
export const phone = () => (v) => {
  if (isBlank(v)) return null;
  const s = normalize(v);
  // Must be made of the allowed characters AND actually contain a number,
  // so "+ - " alone is rejected.
  return PHONE_RE.test(s) && /\d/.test(s) ? null : msg("validation.phone");
};

// ── Numbers ──────────────────────────────────────────────────────

/** @returns {Rule} */
export const integer = () => (v) => {
  if (isBlank(v)) return null;
  return /^-?\d+$/.test(normalize(v)) ? null : msg("validation.integer");
};

/** @returns {Rule} */
export const numeric = () => (v) => {
  if (isBlank(v)) return null;
  return Number.isFinite(Number(normalize(v)))
    ? null
    : msg("validation.number");
};

/**
 * Value must be >= `limit`.
 * @param {number} limit
 * @returns {Rule}
 */
export const min = (limit) => (v) => {
  if (isBlank(v)) return null;
  const n = Number(normalize(v));
  if (!Number.isFinite(n)) return msg("validation.number");
  return n < limit ? msg("validation.min", { min: limit }) : null;
};

/**
 * Value must not exceed a ceiling. `limit` may be a plain number or a
 * function of the sibling values — a section's ceiling is whichever room is
 * currently selected, which is only known at submit time.
 * @param {number | ((values: Record<string, any>) => number|null|undefined)} limit
 * @param {string} [messageKey]
 * @param {(n: number, cap: number, values: Record<string, any>) => Record<string, any>} [makeVars]
 * @returns {Rule}
 */
export const atMost =
  (limit, messageKey = "validation.max", makeVars) =>
  (v, values) => {
    if (isBlank(v)) return null;
    const n = Number(normalize(v));
    const cap = typeof limit === "function" ? limit(values) : limit;
    if (!Number.isFinite(n) || cap == null || !Number.isFinite(Number(cap))) {
      return null;
    }
    const ceiling = Number(cap);
    if (n <= ceiling) return null;
    return msg(
      messageKey,
      makeVars ? makeVars(n, ceiling, values) : { max: ceiling },
    );
  };

/**
 * Value must fit within `limit` characters. Mirrors the column width so an
 * over-long entry fails inline here rather than reaching Postgres, which
 * answers 22001 with text no school director should ever be shown.
 * @param {number} limit
 * @returns {Rule}
 */
export const maxLen = (limit) => (v) => {
  if (isBlank(v)) return null;
  return normalize(v).length > limit
    ? msg("validation.maxLength", { max: limit })
    : null;
};

/** A percentage between 0 and 100. @returns {Rule} */
export const percent = () => (v) => {
  if (isBlank(v)) return null;
  const n = Number(normalize(v));
  if (!Number.isFinite(n)) return msg("validation.percent");
  return n < 0 || n > 100 ? msg("validation.percent") : null;
};

// ── Dates (ISO yyyy-mm-dd strings compare correctly as strings) ───

/**
 * Date must fall inside a parent entity's range. `labels` carries the
 * already-formatted bounds for the message — formatting is the caller's job
 * so this module stays free of i18n.
 * @param {string|null|undefined} start ISO lower bound
 * @param {string|null|undefined} end ISO upper bound
 * @param {{ start: string, end: string }} labels display strings
 * @returns {Rule}
 */
export const dateWithin = (start, end, labels) => (v) => {
  if (isBlank(v)) return null;
  const s = normalize(v);
  if ((start && s < start) || (end && s > end)) {
    return msg("validation.dateWithin", {
      start: labels?.start ?? start ?? "",
      end: labels?.end ?? end ?? "",
    });
  }
  return null;
};

/**
 * This field (an end date) must be strictly after another field's value.
 * @param {string} startField name of the sibling start-date field
 * @returns {Rule}
 */
export const endAfterStart = (startField) => (v, values) => {
  const end = normalize(v);
  const start = normalize(values?.[startField]);
  if (!end || !start) return null;
  return end <= start ? msg("validation.endAfterStart") : null;
};

/**
 * This field (an end date) may not come before another field's value; the
 * same day is allowed.
 * @param {string} startField name of the sibling start-date field
 * @returns {Rule}
 */
export const endNotBeforeStart = (startField) => (v, values) => {
  const end = normalize(v);
  const start = normalize(values?.[startField]);
  if (!end || !start) return null;
  return end < start ? msg("validation.endBeforeStart") : null;
};

/**
 * Date may not be in the future (a birthdate, a hire date).
 * @param {string} [todayIso] defaults to today — passed explicitly in tests
 * @returns {Rule}
 */
export const notFuture = (todayIso) => (v) => {
  if (isBlank(v)) return null;
  const today = todayIso ?? new Date().toISOString().slice(0, 10);
  return normalize(v) > today ? msg("validation.futureDate") : null;
};

// ── Uniqueness ───────────────────────────────────────────────────

/**
 * Value must not collide with one already in use. Mirrors the database's
 * unique constraints so the clash reads as an inline field message instead
 * of a raw Postgres error in a toast.
 * @param {Array<any>} existing values already taken
 * @param {{ current?: any, messageKey?: string }} [opts] `current` is the row's
 *   own value, excluded so editing a record doesn't collide with itself
 * @returns {Rule}
 */
export const unique = (existing, opts = {}) => {
  const { current, messageKey = "validation.unique" } = opts;
  const key = (/** @type {any} */ x) => normalize(x).toLowerCase();
  const taken = new Set(
    (existing ?? [])
      .filter((x) => !isBlank(x))
      .map(key)
      .filter((x) => x !== key(current)),
  );
  return (v) => {
    if (isBlank(v)) return null;
    return taken.has(key(v)) ? msg(messageKey, { value: normalize(v) }) : null;
  };
};

// ── Passwords ────────────────────────────────────────────────────

/** @returns {Rule} */
export const password = () => (v) => {
  if (isBlank(v)) return null;
  return normalize(v).length < MIN_PASSWORD_LENGTH
    ? msg("validation.password")
    : null;
};

// ── Runner ───────────────────────────────────────────────────────

/**
 * Run a field → rules map over submitted values. Stops at the first failing
 * rule per field, so a field shows one message at a time (the most specific
 * failure, given rules are listed cheapest-first).
 * @param {Record<string, Rule[]>} rulesByField
 * @param {Record<string, any>} values
 * @returns {Record<string, Message>} only the fields that failed
 */
export function runRules(rulesByField, values) {
  /** @type {Record<string, Message>} */
  const errors = {};
  for (const [field, rules] of Object.entries(rulesByField ?? {})) {
    for (const rule of rules ?? []) {
      const failure = rule(values?.[field] ?? "", values ?? {});
      if (failure) {
        errors[field] = failure;
        break;
      }
    }
  }
  return errors;
}
