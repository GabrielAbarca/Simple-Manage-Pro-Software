// ─────────────────────────────────────────────────────────────────
//  lookups.js — id → display name, resolved against the reference
//  lists already in state. Split out of admin.js.
//
//  Every one of these is a read of state and nothing else, which is
//  what lets the screens, the schedules grid and the CSV import
//  preview all name the same record the same way.
// ─────────────────────────────────────────────────────────────────
import { t } from "../../i18n.js";
import { state } from "../state.js";

export function gradeName(id) {
  const g = state.gradeLevels.find((x) => x.id === id);
  return g ? g.name : "—";
}

export function roomName(id) {
  const r = state.rooms.find((x) => x.id === id);
  return r ? r.name : "—";
}

export function teacherName(id) {
  const tch = state.teachers.find((x) => x.id === id);
  return tch ? `${tch.first_name} ${tch.last_name}` : "—";
}

export function subjectName(id) {
  const s = state.subjects.find((x) => x.id === id);
  return s ? s.name : "—";
}

/**
 * Human-readable label for a section — "10th Grade — Section A", the same
 * phrasing the student portal uses. `display_name` is a storage code
 * (numeric level + section, e.g. "1010-1") and reads as noise in a picker,
 * so it is only the fallback for when grade levels aren't loaded yet.
 */
export function sectionName(sec) {
  const grade = state.gradeLevels.find((g) => g.id === sec.grade_level_id);
  if (!grade) return sec.display_name || String(sec.section ?? "—");
  return t("student.classLine", { grade: grade.name, section: sec.section });
}

export function sectionOptions() {
  return state.sections.map((s) => ({ value: s.id, label: sectionName(s) }));
}
