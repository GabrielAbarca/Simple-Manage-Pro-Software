// ─────────────────────────────────────────────────────────────────
//  resolvers.js — name → id lookups for CSV import. A spreadsheet
//  names a grade, a teacher or a room the way a person would; these
//  turn that into the foreign key the row needs, or null when nothing
//  matches (which the caller reports as a skipped line).
// ─────────────────────────────────────────────────────────────────
import { state } from "../state.js";

export function resolveGradeLevel(raw) {
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

export function resolveTeacherId(raw) {
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

export function resolveRoomId(raw) {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (!s) return null;
  const r = state.rooms.find((x) => x.name.toLowerCase() === s);
  return r ? r.id : null;
}
