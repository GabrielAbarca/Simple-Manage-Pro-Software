// ─────────────────────────────────────────────────────────────────
//  classExports.js — the class workspace's exports: the gradebook of
//  the period on screen, and the subject's attendance for the year.
// ─────────────────────────────────────────────────────────────────
import { t, tn } from "../i18n.js";
import { db } from "../teacherData/index.js";
import { state } from "../teacherState.js";
import { openModal } from "../teacherModal.js";
import { showToast } from "../teacherFeedback.js";
import { exportTable, fileNamePart, formatField } from "../tableExport.js";
import {
  gradebookRows,
  attendanceSummaryRows,
  attendanceLogRows,
} from "../classExportRows.js";

/** Today by the device's clock, as YYYY-MM-DD. */
function localToday() {
  const d = new Date();
  const pad = (/** @type {number} */ n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** e.g. "gradebook - Mathematics - 7A - I Periodo - 2026-10-07" */
function fileName(kind, ...parts) {
  return [
    t(`admin.export.${kind}File`),
    state.currentClass.subjectName,
    state.currentClass.className,
    ...parts,
    localToday(),
  ]
    .map(fileNamePart)
    .filter(Boolean)
    .join(" - ");
}

/**
 * @param {{ cstId: number, periodId: number, assignments: any[], students: any[] } | null} gradebook
 *   the gradebook as loaded on screen
 */
export function openGradebookExport(gradebook) {
  if (!gradebook) {
    showToast(t("admin.export.notLoaded"), "error");
    return;
  }
  const { cstId, periodId, assignments, students } = gradebook;
  const period =
    state.periods.find((p) => String(p.id) === String(periodId))?.name ?? "";
  openModal({
    title: t("admin.export.gradebookTitle"),
    submitLabel: t("common.export.download"),
    confirmDiscard: false,
    fields: [
      formatField(
        tn("admin.export.gradebookHelp", students.length, { period }),
      ),
    ],
    onSubmit: async (values, isCurrent) => {
      const [periodGrades, posted, ...columns] = await Promise.all([
        db.fetchPeriodGrades(cstId, periodId),
        db.fetchPostedGrades(cstId, periodId),
        ...assignments.map((a) => db.fetchAssignmentColumn(a.id)),
      ]);
      if (!isCurrent()) return;
      exportTable(
        gradebookRows({ assignments, students, columns, periodGrades, posted }),
        {
          filename: fileName("gradebook", period),
          sheetName: period,
          format: values.format,
        },
      );
    },
  });
}

export function openAttendanceExport() {
  const { cstId, classId, subjectName } = state.currentClass;
  openModal({
    title: t("admin.export.attendanceTitle"),
    submitLabel: t("common.export.download"),
    confirmDiscard: false,
    fields: [
      {
        name: "content",
        type: "select",
        label: t("admin.export.content"),
        value: "summary",
        required: true,
        options: ["summary", "log"].map((value) => ({
          value,
          label: t(`admin.export.contents.${value}`),
        })),
      },
      formatField(t("admin.export.attendanceHelp", { subject: subjectName })),
    ],
    onSubmit: async (values, isCurrent) => {
      const [records, roster] = await Promise.all([
        db.fetchCstAttendance(cstId),
        db.fetchRoster(classId),
      ]);
      if (!isCurrent()) return;
      const rows =
        values.content === "log"
          ? attendanceLogRows(records, roster)
          : attendanceSummaryRows(records, roster);
      exportTable(rows, {
        filename: fileName("attendance"),
        sheetName: subjectName,
        format: values.format,
      });
    },
  });
}
