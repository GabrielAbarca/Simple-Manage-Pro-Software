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
 *   school: any,
 *   myClassesCache: Array<object>,
 *   currentClass: { cstId: number, classId: number, subjectId: number,
 *     className: string, subjectName: string, color: string,
 *     gradeLevel: string } | null,
 *   loaded: { today: boolean, subjects: boolean, settings: boolean },
 *   contextError: any,
 * }}
 */
export const state = {
  session: null,
  role: null,
  teacherId: null,
  activeYear: null,
  periods: [],
  // school_settings row: school identity + the MEP pass marks. Read once at
  // bootstrap so the synchronous grade-band helpers can resolve without
  // awaiting. Null on a project whose schema predates the table.
  school: null,
  myClassesCache: [],
  currentClass: null,
  loaded: { today: false, subjects: false, settings: false },
  // Set when resolveTeacherContext fails, so a null teacherId can be told
  // apart from an account that owns no teachers row.
  contextError: null,
};
