import { loadGradeLevels } from "./gradeLevels.js";
import { loadRooms } from "./rooms.js";
import { loadSections } from "./sections.js";

export async function loadGradesSections() {
  await Promise.all([loadGradeLevels(), loadRooms()]);
  await loadSections();
}
