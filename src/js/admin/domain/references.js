import { state } from "../state.js";
import { data } from "../data.js";

export async function ensureSchoolYears() {
  state.schoolYears = await data.listSchoolYears();
  state.activeYear = state.schoolYears.find((y) => y.is_active) ?? null;
}

export async function ensureActiveYear() {
  if (!state.activeYear) await ensureSchoolYears();
}

export async function ensureGradeLevels() {
  if (!state.gradeLevels.length)
    state.gradeLevels = await data.listGradeLevels();
}

export async function ensureRooms() {
  if (!state.rooms.length) state.rooms = await data.listRooms();
}

export async function ensureTeachers() {
  if (!state.teachers.length) state.teachers = await data.listTeachers();
}
