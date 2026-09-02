// ─────────────────────────────────────────────────────────────────
//  discipline.js — discipline record add/edit forms (item 2), opened from
//  the student drawer. Takes the student and a save callback as parameters
//  rather than reaching into the drawer's state, so this module has no
//  dependency on studentDrawer.js.
// ─────────────────────────────────────────────────────────────────
import { t } from "../i18n.js";
import { db } from "../teacherData/index.js";
import { state } from "../teacherState.js";
import { openModal } from "../teacherModal.js";
import { showToast } from "../teacherFeedback.js";

// Discipline severity options, built at call time so labels follow the language.
function disciplineSeverityOptions() {
  return [
    { value: "low", label: t("enums.disciplineSeverity.low") },
    { value: "medium", label: t("enums.disciplineSeverity.medium") },
    { value: "high", label: t("enums.disciplineSeverity.high") },
  ];
}

/**
 * @param {any} student
 * @param {() => any} onSaved called after a successful insert (e.g. to
 *   refresh the drawer the record was added from)
 */
export function openAddDiscipline(student, onSaved) {
  const today = new Date().toISOString().split("T")[0];
  openModal({
    title: t("admin.discipline.addTitle", {
      name: `${student.first_name} ${student.last_name}`,
    }),
    submitLabel: t("admin.discipline.addRecord"),
    fields: [
      {
        name: "date",
        label: t("admin.form.date"),
        type: "date",
        required: true,
        value: today,
      },
      {
        name: "type",
        label: t("admin.form.type"),
        type: "text",
        required: true,
        placeholder: t("admin.discipline.typePlaceholder"),
      },
      {
        name: "severity",
        label: t("admin.form.severity"),
        type: "select",
        required: true,
        value: "low",
        options: disciplineSeverityOptions(),
      },
      {
        name: "description",
        label: t("admin.form.description"),
        type: "textarea",
      },
    ],
    onSubmit: async (formData) => {
      await db.insertDiscipline({
        student_id: student.id,
        date: formData.date,
        type: formData.type.trim(),
        severity: formData.severity,
        description: formData.description?.trim() || null,
        reported_by_teacher: state.teacherId,
      });
      showToast(t("admin.toast.disciplineAdded"));
      await onSaved?.();
    },
  });
}

/**
 * @param {any} record
 * @param {() => any} onSaved called after a successful update
 */
export function openEditDiscipline(record, onSaved) {
  openModal({
    title: t("admin.discipline.editTitle"),
    submitLabel: t("common.save"),
    fields: [
      {
        name: "date",
        label: t("admin.form.date"),
        type: "date",
        required: true,
        value: record.date ?? "",
      },
      {
        name: "type",
        label: t("admin.form.type"),
        type: "text",
        required: true,
        value: record.type ?? "",
      },
      {
        name: "severity",
        label: t("admin.form.severity"),
        type: "select",
        required: true,
        value: record.severity ?? "low",
        options: disciplineSeverityOptions(),
      },
      {
        name: "description",
        label: t("admin.form.description"),
        type: "textarea",
        value: record.description ?? "",
      },
      {
        name: "resolved",
        label: t("admin.form.status"),
        type: "select",
        value: record.resolved ? "yes" : "no",
        options: [
          { value: "no", label: t("enums.disciplineState.open") },
          { value: "yes", label: t("enums.disciplineState.resolved") },
        ],
      },
      {
        name: "resolution",
        label: t("admin.form.resolutionIf"),
        type: "textarea",
        value: record.resolution ?? "",
      },
    ],
    onSubmit: async (formData) => {
      const resolved = formData.resolved === "yes";
      await db.updateDiscipline(record.id, {
        date: formData.date,
        type: formData.type.trim(),
        severity: formData.severity,
        description: formData.description?.trim() || null,
        resolved,
        resolution: resolved ? formData.resolution?.trim() || null : null,
      });
      showToast(t("admin.toast.disciplineUpdated"));
      await onSaved?.();
    },
  });
}
