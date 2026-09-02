// ─────────────────────────────────────────────────────────────────
//  enums.js — the console's closed value sets and the coercions that
//  map free-form input onto them. Split out of admin.js.
//
//  Shared deliberately: the add/edit forms build their <select> options
//  from these lists, and the CSV import reads spreadsheet text through
//  the same coercions, so a pasted "Masculino" and a picked "Male" land
//  on the identical stored value.
// ─────────────────────────────────────────────────────────────────
import { t } from "../../i18n.js";

export const ROOM_TYPES = [
  "classroom",
  "lab",
  "gym",
  "library",
  "auditorium",
  "office",
];

export const TEACHER_STATUSES = ["active", "inactive", "on_leave"];

export const STUDENT_STATUSES = [
  "active",
  "inactive",
  "graduated",
  "transferred",
  "withdrawn",
];

export function genderLabel(g) {
  return g ? t(`enums.gender.${g}`) : "—";
}

export function coerceGender(raw) {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (["m", "male", "masculino", "hombre", "h"].includes(s)) return "M";
  if (["f", "female", "femenino", "mujer"].includes(s)) return "F";
  if (s === "o" || s === "other" || s === "otro") return "O";
  return null;
}

/** Normalize a birthdate to ISO yyyy-mm-dd; null if unparseable. */
export function coerceDate(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/); // dd/mm/yyyy
  if (m) {
    const [, d, mo, y] = m;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return null;
}

export function coerceInt(v) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = parseInt(s, 10);
  return Number.isNaN(n) ? null : n;
}

export function coerceNum(v) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isNaN(n) ? null : n;
}

export function coerceEnum(v, allowed, dflt) {
  const s = String(v ?? "")
    .trim()
    .toLowerCase();
  return allowed.find((a) => a.toLowerCase() === s) ?? dflt;
}
