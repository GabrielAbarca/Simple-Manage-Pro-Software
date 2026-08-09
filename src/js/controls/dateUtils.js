// ─────────────────────────────────────────────────────────────────
//  dateUtils.js — the date logic behind the custom picker, with no DOM.
//
//  Split out so it can be unit-tested directly. The component itself
//  reaches the DOM through popover.js, which touches `document` at
//  import time; importing that into a Node test environment would fail,
//  and the project deliberately ships no jsdom. Keeping the arithmetic
//  here means the parts most likely to be subtly wrong — locale field
//  order, month-grid boundaries, DST-safe ISO handling — are the parts
//  that are cheapest to test.
// ─────────────────────────────────────────────────────────────────

/** @param {Date} d @returns {string} yyyy-mm-dd in LOCAL time */
export function toIso(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * ISO string → Date at LOCAL midnight.
 * `new Date("2026-09-01")` parses as UTC and can land on the previous day
 * west of Greenwich, which would show the wrong day selected.
 * @param {string} iso
 */
export function fromIso(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? "").trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Which order this locale writes day, month and year in.
 * Derived from Intl rather than hardcoded, so adding a language needs no
 * change here.
 * @param {string} locale
 * @returns {Array<"day"|"month"|"year">}
 */
export function dateFieldOrder(locale) {
  const parts = new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(new Date(2000, 0, 2));
  return /** @type {any} */ (
    parts
      .filter((p) => ["day", "month", "year"].includes(p.type))
      .map((p) => p.type)
  );
}

/** First day of the week: 0 = Sunday. es-CR starts Monday, en-US Sunday. */
export function firstDayOfWeek(locale) {
  try {
    // getWeekInfo is not in every engine's typings yet, and is genuinely
    // absent in older ones — hence the cast and the catch.
    const loc = /** @type {any} */ (new Intl.Locale(locale));
    const info = loc.getWeekInfo?.() ?? loc.weekInfo;
    // Intl reports 1..7 with Monday = 1; JS getDay() has Sunday = 0.
    if (info?.firstDay) return info.firstDay % 7;
  } catch {
    /* older engines: fall through */
  }
  return locale.startsWith("en") ? 0 : 1;
}

/**
 * Parse what a human typed. Liberal on purpose (Postel): accepts the
 * locale's own order, ISO regardless of locale, one- or two-digit day and
 * month, and any of . / - or space as a separator. Returns ISO or null;
 * null is left to the existing inline validation rather than silently
 * discarded, so a typo does not quietly become an empty date.
 * @param {string} text
 * @param {string} locale
 */
export function parseDisplay(text, locale) {
  const raw = String(text ?? "").trim();
  if (!raw) return "";
  const nums = raw.split(/[^\d]+/).filter(Boolean);
  if (nums.length !== 3) return null;

  let y, mo, d;
  if (nums[0].length === 4) {
    // ISO-ish, whatever the locale — page.fill() and pasted values land here.
    [y, mo, d] = nums.map(Number);
  } else {
    const order = dateFieldOrder(locale);
    const got = {};
    order.forEach((field, i) => (got[field] = Number(nums[i])));
    y = got.year;
    mo = got.month;
    d = got.day;
    if (String(y).length <= 2) y = 2000 + y; // "26" → 2026
  }
  if (!y || !mo || !d || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const date = new Date(y, mo - 1, d);
  // Rejects 31 February rather than letting Date roll it into March.
  if (
    date.getFullYear() !== y ||
    date.getMonth() !== mo - 1 ||
    date.getDate() !== d
  ) {
    return null;
  }
  return toIso(date);
}

/** ISO → the locale's own written form. */
export function formatDisplay(iso, locale) {
  const d = fromIso(iso);
  if (!d) return "";
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);
}

/**
 * The 6x7 cell grid for a month, including the leading/trailing days that
 * complete the first and last weeks. Always 42 cells so the popover does
 * not change height between months.
 * @param {number} year @param {number} month 0-indexed @param {number} weekStart
 */
export function monthGrid(year, month, weekStart) {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() - weekStart + 7) % 7;
  const start = new Date(year, month, 1 - lead);
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(
      start.getFullYear(),
      start.getMonth(),
      start.getDate() + i,
    );
    cells.push({
      iso: toIso(d),
      day: d.getDate(),
      outside: d.getMonth() !== month,
    });
  }
  return cells;
}

/** Is `iso` inside the field's min/max, when either is set? */
export function withinRange(iso, min, max) {
  if (min && iso < min) return false;
  if (max && iso > max) return false;
  return true;
}
