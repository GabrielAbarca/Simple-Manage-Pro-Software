// ─────────────────────────────────────────────────────────────────
//  discipline.js — discipline record add/edit forms (item 2), opened from
//  the student drawer. Takes the student and a save callback as parameters
//  rather than reaching into the drawer's state, so this module has no
//  dependency on studentDrawer.js.
//
//  The points a teacher enters here ARE the conducta deduction (see
//  conduct.js). `severity` is kept for the register and carries no weight,
//  which the form says out loud so nobody expects it to move the grade.
// ─────────────────────────────────────────────────────────────────
import { t } from "../i18n.js";
import * as v from "../validate.js";
import { db } from "../teacherData/index.js";
import { state } from "../teacherState.js";
import { openModal } from "../teacherModal.js";
import { showToast } from "../teacherFeedback.js";
import { CONDUCT_MAX, conductAfter } from "../conduct.js";

// Discipline severity options, built at call time so labels follow the language.
function disciplineSeverityOptions() {
  return [
    { value: "low", label: t("enums.disciplineSeverity.low") },
    { value: "medium", label: t("enums.disciplineSeverity.medium") },
    { value: "high", label: t("enums.disciplineSeverity.high") },
  ];
}

/** Up to two decimals, without a trailing .0 on a whole mark. */
function fmtScore(n) {
  return String(Math.round(Number(n) * 100) / 100);
}

/**
 * The conducta this record is measured against: the period's mark with this
 * record's own points added back, so editing 5 down to 2 previews correctly.
 * Derived from the view's `deduction` rather than from the score, because a
 * score that floored at 0 cannot be un-floored by adding points back.
 * @param {{ deduction?: unknown } | null | undefined} conduct view row
 * @param {unknown} excludePoints this record's current points, when editing
 */
function baseConduct(conduct, excludePoints = 0) {
  const deducted = Number(conduct?.deduction);
  if (!Number.isFinite(deducted)) return CONDUCT_MAX;
  const own = Number(excludePoints);
  const without = deducted - (Number.isFinite(own) ? own : 0);
  return Math.max(CONDUCT_MAX - Math.max(without, 0), 0);
}

/**
 * Live "conducta would go from X to Y" under the points input. The modal
 * renders its fields synchronously, so the input exists by the time
 * openModal returns and no modal-level hook is needed. Takes a getter rather
 * than a number because the starting conducta can change while the form is
 * open: the Conduct tab's picker swaps the student.
 * @param {() => number} getBase
 */
function bindConductPreview(getBase) {
  const input = /** @type {HTMLInputElement | null} */ (
    document.getElementById("modal-field-conduct_points")
  );
  const help = input?.parentElement?.querySelector(".field-help");
  if (!input || !help) return;
  const render = () => {
    const base = getBase();
    help.textContent = t("admin.discipline.conductPreview", {
      from: fmtScore(base),
      to: fmtScore(conductAfter(base, input.value)),
    });
  };
  input.addEventListener("input", render);
  document
    .getElementById("modal-field-student_id")
    ?.addEventListener("change", render);
  render();
}

/**
 * The shared field list — add and edit must offer exactly the same record,
 * or a teacher can only set points on one of the two paths.
 */
function disciplineFields(record = {}) {
  return [
    {
      name: "date",
      label: t("admin.form.date"),
      type: "date",
      required: true,
      value: record.date ?? new Date().toISOString().split("T")[0],
    },
    {
      name: "type",
      label: t("admin.form.reason"),
      type: "text",
      required: true,
      value: record.type ?? "",
      placeholder: t("admin.discipline.typePlaceholder"),
    },
    {
      name: "severity",
      label: t("admin.form.severity"),
      type: "select",
      required: true,
      value: record.severity ?? "low",
      options: disciplineSeverityOptions(),
      help: t("admin.form.severityHelp"),
    },
    {
      name: "description",
      label: t("admin.form.description"),
      type: "textarea",
      value: record.description ?? "",
    },
    {
      name: "conduct_points",
      label: t("admin.form.conductPoints"),
      type: "number",
      min: 0,
      max: 100,
      step: 0.01,
      value: record.conduct_points ?? 0,
      rules: [v.percent()],
      // Replaced by bindConductPreview the moment the modal is open; the
      // static text is what a reader sees if the input never gets focus.
      help: t("admin.form.conductPointsHelp"),
    },
  ];
}

/** Blank or unusable points cost nothing, matching conduct.js. */
function pointsFrom(formData) {
  const n = Number(formData.conduct_points);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** The row both add paths insert, so a new column is added in one place. */
function insertPayload(studentId, formData) {
  return {
    student_id: studentId,
    date: formData.date,
    type: formData.type.trim(),
    severity: formData.severity,
    description: formData.description?.trim() || null,
    conduct_points: pointsFrom(formData),
    reported_by_teacher: state.teacherId,
  };
}

/**
 * @param {any} student
 * @param {{ deduction?: unknown } | null} conduct the student's view row for
 *   the period being looked at, for the live preview
 * @param {() => any} onSaved called after a successful insert (e.g. to
 *   refresh the drawer the record was added from)
 */
export function openAddDiscipline(student, conduct, onSaved) {
  openModal({
    title: t("admin.discipline.addTitle", {
      name: `${student.first_name} ${student.last_name}`,
    }),
    submitLabel: t("admin.discipline.addRecord"),
    fields: disciplineFields(),
    onSubmit: async (formData) => {
      await db.insertDiscipline(insertPayload(student.id, formData));
      showToast(t("admin.toast.disciplineAdded"));
      await onSaved?.();
    },
  });
  bindConductPreview(() => baseConduct(conduct));
}

/**
 * @param {any} record
 * @param {{ deduction?: unknown } | null} conduct
 * @param {() => any} onSaved called after a successful update
 */
export function openEditDiscipline(record, conduct, onSaved) {
  openModal({
    title: t("admin.discipline.editTitle"),
    submitLabel: t("common.save"),
    fields: disciplineFields(record),
    onSubmit: async (formData) => {
      await db.updateDiscipline(record.id, {
        date: formData.date,
        type: formData.type.trim(),
        severity: formData.severity,
        description: formData.description?.trim() || null,
        conduct_points: pointsFrom(formData),
      });
      showToast(t("admin.toast.disciplineUpdated"));
      await onSaved?.();
    },
  });
  bindConductPreview(() => baseConduct(conduct, record.conduct_points));
}

function studentField(students) {
  return {
    name: "student_id",
    label: t("admin.conduct.student"),
    type: "select",
    required: true,
    options: students.map((s) => ({
      value: s.id,
      label: `${s.last_name}, ${s.first_name}`,
    })),
  };
}

/**
 * Add a record when the student is not known up front (the Conduct tab's
 * toolbar). Same fields as openAddDiscipline, plus a student picker.
 * @param {any[]} students
 * @param {Map<number, { deduction?: unknown }>} conductByStudent
 * @param {() => any} onSaved
 */
export function openAddDisciplineFor(students, conductByStudent, onSaved) {
  openModal({
    title: t("admin.conduct.addRecord"),
    submitLabel: t("admin.discipline.addRecord"),
    fields: [studentField(students), ...disciplineFields()],
    onSubmit: async (formData) => {
      const studentId = Number(formData.student_id);
      await db.insertDiscipline(insertPayload(studentId, formData));
      showToast(t("admin.toast.disciplineAdded"));
      await onSaved?.();
    },
  });
  bindConductPreview(() => {
    const select = /** @type {HTMLSelectElement | null} */ (
      document.getElementById("modal-field-student_id")
    );
    return baseConduct(conductByStudent.get(Number(select?.value)) ?? null);
  });
}
