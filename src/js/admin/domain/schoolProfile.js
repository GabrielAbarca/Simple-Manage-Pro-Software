import { t } from "../../i18n.js";
import { state } from "../state.js";
import { data } from "../data.js";

/** True once the settings row has been read (or found unavailable). */
let schoolLoaded = false;

/**
 * Read the single school_settings row. A project that predates the table
 * (its schema is applied by hand) must keep working, so a failed read is
 * downgraded to "no settings" and the defaults apply.
 */
export async function loadSchoolSettings() {
  if (schoolLoaded) return state.school;
  schoolLoaded = true;
  try {
    state.school = await data.getSchoolSettings();
  } catch (err) {
    console.warn("loadSchoolSettings: school_settings unavailable:", err);
    state.school = null;
  }
  return state.school;
}

/**
 * Label for the national-ID field: the school's own wording when set,
 * otherwise the translated default.
 * @param {"teachers" | "students"} scope which form/table is asking
 */
export function idLabel(scope) {
  const configured = String(state.school?.id_label ?? "").trim();
  return configured || t(`console.${scope}.nationalId`);
}

/** Point the two ID column headers at the configured label. */
export function applyIdLabels() {
  const heads = {
    "th-teachers-national-id": "teachers",
    "th-students-national-id": "students",
  };
  Object.entries(heads).forEach(([id, scope]) => {
    const el = document.getElementById(id);
    if (el)
      el.textContent = idLabel(/** @type {"teachers"|"students"} */ (scope));
  });
}
