// ─────────────────────────────────────────────────────────────────
//  gradesSections.js — the Grades & Sections tab, which stacks three
//  independent tables. Grade levels and rooms are unordered so they
//  load together; sections names records from both, so it goes last.
// ─────────────────────────────────────────────────────────────────
import { loadGradeLevels } from "./gradeLevels.js";
import { loadRooms } from "./rooms.js";
import { loadSections } from "./sections.js";

export async function loadGradesSections() {
  await Promise.all([loadGradeLevels(), loadRooms()]);
  await loadSections();
}
