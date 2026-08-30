/**
 * Shared session/navigation state for the teacher console. A single mutable
 * object rather than per-field getters/setters — every module imports the
 * same `state` reference and mutates it in place (same pattern as
 * studentState.js).
 * @type {{
 *   session: any,
 *   role: string | null,
 *   teacherId: number | null,
 *   activeYear: { id: number, name: string, is_active: boolean } | null,
 *   periods: Array<any>,
 *   myClassesCache: Array<object>,
 *   currentClass: { cstId: number, classId: number, subjectId: number,
 *     className: string, subjectName: string, color: string,
 *     gradeLevel: string } | null,
 *   loaded: { today: boolean, subjects: boolean, settings: boolean },
 * }}
 */
export const state = {
  session: null,
  role: null,
  teacherId: null,
  activeYear: null,
  periods: [],
  myClassesCache: [],
  currentClass: null,
  loaded: { today: false, subjects: false, settings: false },
};
