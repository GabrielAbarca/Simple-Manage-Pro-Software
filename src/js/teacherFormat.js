// ─────────────────────────────────────────────────────────────────
//  teacherFormat.js — pure display/formatting helpers shared across the
//  teacher console's views. No DOM access. Split out of teacher.js.
// ─────────────────────────────────────────────────────────────────
import { t, formatDate as i18nFormatDate } from "./i18n.js";
import { dayKey } from "./scheduleLogic.js";
import { state } from "./teacherState.js";

/**
 * Human-readable label for a class — "10th Grade — Section A".
 *
 * `classes.display_name` is a STORAGE code (numeric level + section, e.g.
 * "1010-1"). The admin console has rendered the readable form for a while
 * via its own sectionName(); this console was still printing the raw code on
 * every class card, every workspace header, the Today list and every class
 * picker. Same phrasing and same i18n key as the other two surfaces, so a
 * section reads identically wherever it appears.
 *
 * Falls back to the code only when the joined grade level is missing, which
 * is strictly better than showing nothing.
 *
 * @param {{ display_name?: string|null, section?: string|number|null,
 *   grade_levels?: { name?: string|null } | null } | null | undefined} cls
 */
export function className(cls) {
  const grade = cls?.grade_levels?.name;
  if (grade && cls?.section != null) {
    return t("student.classLine", { grade, section: cls.section });
  }
  return cls?.display_name ?? "—";
}

// Weekday label for a day_of_week (1=Mon … 7=Sun). Resolved at call time so
// the active language applies (rebuilt fresh on the post-switch reload).
export function dayName(dow) {
  const key = dayKey(Number(dow));
  return key ? t(`common.days.${key}`) : "";
}

// Current grading period = the one whose date range contains today,
// otherwise the first period (demo seed dates may be in the past).
// Single source of truth for the gradebook default AND the roster Overall.
export function getCurrentPeriodId() {
  const today = new Date().toISOString().split("T")[0];
  const inRange = state.periods.find(
    (p) => p.start_date <= today && today <= p.end_date,
  );
  return (inRange ?? state.periods[0])?.id ?? "";
}

// Grade colour band: red <70, amber 70–74.99, green ≥75. Reuses the
// shared .score-low / .score-mid / .score-high classes from style.css.
export function gradeBandClass(score) {
  if (score == null) return "";
  const n = Number(score);
  if (n < 70) return "score-low";
  if (n < 75) return "score-mid";
  return "score-high";
}

// Render one grade cell: colored value, or a neutral placeholder when ungraded
// (never a colored zero). Used by the roster grade columns + Overall.
export function gradeCellHtml(score) {
  return score == null
    ? '<span class="text-muted">—</span>'
    : `<b class="${gradeBandClass(score)}">${Number(score).toFixed(1)}</b>`;
}

// Weighted Overall across the periods that have a grade, renormalizing the
// grading_periods.weight values so a missing period is excluded (never 0).
export function weightedOverall(scoreByOrder) {
  let sum = 0;
  let wTot = 0;
  state.periods.forEach((p) => {
    const s = scoreByOrder[p.period_order];
    if (s == null) return;
    const w = Number(p.weight) || 0;
    sum += Number(s) * w;
    wTot += w;
  });
  return wTot > 0 ? sum / wTot : null;
}

// Display status for one (student, assignment) grade record. No submission date
// exists in the schema, so "Late" derives from graded_at vs the due_date.
export function gradeStatus(grade, dueDate) {
  if (!grade || grade.score == null)
    return { label: t("enums.gradeStatus.notGraded"), cls: "badge-neutral" };
  if (dueDate && grade.graded_at && grade.graded_at.slice(0, 10) > dueDate)
    return { label: t("enums.gradeStatus.late"), cls: "badge-warning" };
  return { label: t("enums.gradeStatus.graded"), cls: "badge-success" };
}

// "2024-12-13" / ISO timestamp → locale-aware friendly date, or "—" when absent.
export function formatDate(value) {
  if (!value) return "—";
  return i18nFormatDate(value);
}

// Gender select options, built at call time so labels follow the active language.
export function genderOptions() {
  return [
    { value: "M", label: t("enums.gender.M") },
    { value: "F", label: t("enums.gender.F") },
    { value: "O", label: t("enums.gender.O") },
  ];
}

export function genderLabel(g) {
  return g === "M" || g === "F" || g === "O" ? t(`enums.gender.${g}`) : "—";
}
