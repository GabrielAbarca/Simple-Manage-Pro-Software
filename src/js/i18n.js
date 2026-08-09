// ─────────────────────────────────────────────────────────────────
//  i18n — lightweight, dependency-free interface translation.
//
//  English is the canonical base language and the ultimate fallback;
//  Spanish (Costa Rica) is built from it. Language is PER-VIEW: each
//  entry point calls initI18n(scope) with its own scope, and the
//  choice is persisted under a namespaced localStorage key so the
//  student and admin views never share state.
//
//  Mirrors theme.js: namespaced key, try/catch storage, init on load.
//  Switching language reloads the page (setLang → location.reload) so
//  every view re-renders cleanly in the new locale — no stale strings.
//
//  DB content (names, subject/class titles, stored values) is never
//  translated; only UI chrome and app-generated messages route here.
// ─────────────────────────────────────────────────────────────────

import en from "./i18n/en.js";
import es from "./i18n/es.js";

const DICTS = { en, es };

// Per-view storage keys. login has no settings panel → detection-only,
// so no key (null): it follows navigator.language each visit. The teacher
// key predates the admin console and keeps its historical name so stored
// choices survive the rename.
const STORAGE_KEYS = {
  student: "smp-lang-student",
  teacher: "smp-lang-admin",
  admin: "smp-lang-console",
  login: null,
};

// Intl locale tags per language. Spanish targets Costa Rica (the app's
// origin) for date/number conventions (24h time, comma decimals).
const LOCALE_TAGS = { en: "en-US", es: "es-CR" };

const DEFAULT_DATE_OPTS = { year: "numeric", month: "short", day: "numeric" };

let currentScope = "student";
let currentLang = "en";

// ── Storage ───────────────────────────────────────────────────────
function readStored(scope) {
  const key = STORAGE_KEYS[scope];
  if (!key) return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function persist(scope, lang) {
  const key = STORAGE_KEYS[scope];
  if (!key) return;
  try {
    localStorage.setItem(key, lang);
  } catch {
    /* storage unavailable (private mode) — choice just won't persist */
  }
}

// Default/detection precedence: (a) stored choice for this view →
// (b) Spanish browser → es → (c) English.
function resolveLang(scope) {
  const stored = readStored(scope);
  if (stored === "en" || stored === "es") return stored;
  const nav = (navigator.language || "").toLowerCase();
  if (nav.startsWith("es")) return "es";
  return "en";
}

// ── Public API ────────────────────────────────────────────────────

/** Resolve + activate this view's language. Call once, before rendering. */
export function initI18n(scope) {
  currentScope = scope;
  currentLang = resolveLang(scope);
  document.documentElement.lang = currentLang;
  return currentLang;
}

/** Current active language code ("en" | "es"). */
export function getLang() {
  return currentLang;
}

/** Persist a new language for this view and reload so the whole view re-renders. */
export function setLang(lang) {
  if (lang !== "en" && lang !== "es") return;
  if (lang === currentLang) return;
  persist(currentScope, lang);
  location.reload();
}

// Walk a dotted path ("admin.roster.title") into a dictionary object.
function resolve(root, key) {
  return key.split(".").reduce((o, k) => (o == null ? undefined : o[k]), root);
}

// Replace {token} placeholders from vars; unknown tokens are left intact.
function interpolate(str, vars) {
  return str.replace(/\{(\w+)\}/g, (m, name) =>
    name in vars ? String(vars[name]) : m,
  );
}

// Last-resort humanizer so a missing key never renders raw or blank.
function humanize(key) {
  const last = key.split(".").pop() || key;
  const spaced = last
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : key;
}

/**
 * Translate a key. Falls back to English when the active language lacks it,
 * then to a humanized last segment — never a raw key or empty string.
 * `vars` interpolates {token} placeholders.
 */
export function t(key, vars) {
  let val = resolve(DICTS[currentLang], key);
  if (typeof val !== "string") val = resolve(DICTS.en, key);
  if (typeof val !== "string") {
    if (import.meta.env?.DEV) console.warn(`[i18n] missing key: ${key}`);
    val = humanize(key);
  }
  return vars ? interpolate(val, vars) : val;
}

/**
 * Plural-aware translate. Looks up `${key}.one` / `${key}.other` based on
 * `count`, and exposes {count} to the chosen string.
 */
export function tn(key, count, vars = {}) {
  const sub = count === 1 ? "one" : "other";
  return t(`${key}.${sub}`, { ...vars, count });
}

/**
 * Translate the DOM in-place. Reads data-i18n (textContent) and
 * data-i18n-{placeholder,title,aria-label} (attributes).
 */
export function applyTranslations(root = document) {
  root.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.getAttribute("data-i18n"));
  });
  const attrMap = [
    ["data-i18n-placeholder", "placeholder"],
    ["data-i18n-title", "title"],
    ["data-i18n-aria-label", "aria-label"],
  ];
  attrMap.forEach(([dataAttr, prop]) => {
    root.querySelectorAll(`[${dataAttr}]`).forEach((el) => {
      el.setAttribute(prop, t(el.getAttribute(dataAttr)));
    });
  });
}

// ── Locale-aware formatting (Intl) ───────────────────────────────

/**
 * The BCP-47 tag for the active language ("en-US" / "es-CR").
 *
 * Exported so the custom date picker can drive Intl directly — month and
 * weekday names, field order and the first day of the week all come from
 * here rather than from translated strings, which keeps the calendar
 * bilingual without adding a single dictionary entry.
 */
export function localeTag() {
  return LOCALE_TAGS[currentLang] ?? "en-US";
}

// Anchor date-only strings to local midnight to avoid timezone drift.
function parseDate(value) {
  if (value instanceof Date) return value;
  const s = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s + "T00:00:00");
  return new Date(s);
}

/** Locale-aware date. Returns "" for empty, the raw string for unparseable. */
export function formatDate(value, opts) {
  if (value == null || value === "") return "";
  const d = parseDate(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return new Intl.DateTimeFormat(localeTag(), opts ?? DEFAULT_DATE_OPTS).format(
    d,
  );
}

/** Locale-aware time from "HH:MM" / "HH:MM:SS" (en → 12h, es → 24h). */
export function formatTime(value) {
  if (!value) return "";
  const [h, m] = String(value).split(":").map(Number);
  if (Number.isNaN(h)) return String(value);
  const d = new Date();
  d.setHours(h, Number.isNaN(m) ? 0 : m, 0, 0);
  return new Intl.DateTimeFormat(localeTag(), {
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

/** Locale-aware number (decimal/grouping separators per locale). */
export function formatNumber(value, opts = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  return new Intl.NumberFormat(localeTag(), opts).format(n);
}
