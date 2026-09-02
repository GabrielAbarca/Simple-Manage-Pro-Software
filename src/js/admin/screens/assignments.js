// ─────────────────────────────────────────────────────────────────
//  assignments.js — who teaches which subject in which section.
//  Split out of admin.js.
// ─────────────────────────────────────────────────────────────────
import { t } from "../../i18n.js";
import { state } from "../state.js";
import { data } from "../data.js";
import { escapeHtml, num } from "../ui/format.js";
import { showToast, openConfirm } from "../ui/feedback.js";
import { openModal } from "../ui/modal.js";
import {
  renderMessageRow,
  renderEmptyRow,
  renderErrorRow,
  iconBtn,
  markSaved,
  applySavedFlash,
  tableRow,
  optionsFrom,
} from "../ui/tables.js";
import { subjectName, teacherName, sectionName } from "../domain/lookups.js";
import { ensureTeachers } from "../domain/references.js";

export async function loadAssignments() {
  const label = document.getElementById("assignments-year-label");
  const addBtn = /** @type {HTMLButtonElement} */ (
    document.getElementById("btn-add-assignment")
  );
  if (!state.activeYear) {
    const years = await data.listSchoolYears();
    state.activeYear = years.find((y) => y.is_active) ?? null;
  }
  if (!state.activeYear) {
    label.textContent = t("console.assignments.noYear");
    addBtn.disabled = true;
    renderEmptyRow("assignments-body", 4, t("console.assignments.noYear"));
    return;
  }
  addBtn.disabled = false;
  label.textContent = state.activeYear.name;
  renderMessageRow("assignments-body", 4, t("common.loading"));
  try {
    // Assignments is its own tab now, so it can be the first thing opened —
    // it has to fetch the teachers it names rather than inherit them from
    // whichever section happened to load first.
    await ensureTeachers();
    const [assignments, sectionsList, subjects] = await Promise.all([
      data.listAssignments(state.activeYear.id),
      data.listSections(state.activeYear.id),
      state.subjects.length
        ? Promise.resolve(state.subjects)
        : data.listSubjects(),
    ]);
    state.sections = sectionsList;
    state.subjects = subjects;
    if (!state.gradeLevels.length)
      state.gradeLevels = await data.listGradeLevels();
    renderAssignments(assignments);
  } catch (err) {
    console.error("loadAssignments:", err);
    renderErrorRow("assignments-body", 4, loadAssignments);
  }
}

function renderAssignments(list) {
  const tbody = document.getElementById("assignments-body");
  tbody.innerHTML = "";
  if (!list.length) {
    renderEmptyRow("assignments-body", 4, t("console.assignments.empty"));
    return;
  }
  list.forEach((a) => {
    const sec = state.sections.find((s) => s.id === a.class_id);
    tbody.appendChild(
      tableRow(
        [
          escapeHtml(sec ? sectionName(sec) : "—"),
          escapeHtml(subjectName(a.subject_id)),
          escapeHtml(teacherName(a.teacher_id)),
        ],
        [
          iconBtn("edit", t("common.edit"), () => openAssignmentForm(a)),
          iconBtn("delete", t("common.delete"), () => confirmDelete(a), true),
        ],
        a.id,
      ),
    );
  });
  applySavedFlash("assignments-body");
}

function confirmDelete(assignment) {
  openConfirm(t("console.assignments.confirmDelete"), async () => {
    await data.deleteAssignment(assignment.id);
    showToast(t("common.deleted"));
    loadAssignments();
  });
}

function teacherField(assignment) {
  return {
    name: "teacher_id",
    label: t("console.assignments.teacher"),
    type: "select",
    required: true,
    value: assignment?.teacher_id,
    options: optionsFrom(
      state.teachers,
      (tch) => `${tch.first_name} ${tch.last_name}`,
    ),
  };
}

/**
 * Reassign an existing row's teacher.
 *
 * Editing is deliberately limited to the teacher. Section and subject identify
 * the assignment — changing them would silently re-parent the grades,
 * assignments and categories that cascade off this row, and can collide with
 * the (class, subject, year) unique key. Correcting either of those is a
 * delete-and-recreate, which is safe precisely when there is nothing to lose.
 */
function openReassignForm(assignment) {
  const sec = state.sections.find((s) => s.id === assignment.class_id);
  openModal({
    // The pair being reassigned is named in the title rather than shown as
    // dead form controls, so nothing on screen invites an edit that is not on
    // offer.
    title: t("console.assignments.editTitle", {
      section: sec ? sectionName(sec) : "—",
      subject: subjectName(assignment.subject_id),
    }),
    fields: [teacherField(assignment)],
    onSubmit: async (values) => {
      await data.updateAssignment(assignment.id, {
        teacher_id: num(values.teacher_id),
      });
      markSaved("assignments-body", assignment.id);
      showToast(t("common.saved"));
      loadAssignments();
    },
  });
}

/**
 * Create an assignment, or reassign an existing one's teacher.
 * @param {any} [assignment] the row to reassign; omit to create
 */
export function openAssignmentForm(assignment = null) {
  if (
    !state.sections.length ||
    !state.subjects.length ||
    !state.teachers.length
  ) {
    showToast(t("console.assignments.needData"), "error");
    return;
  }

  if (assignment) {
    openReassignForm(assignment);
    return;
  }

  openModal({
    title: t("console.assignments.addTitle"),
    fields: [
      {
        name: "class_id",
        label: t("console.assignments.section"),
        type: "select",
        required: true,
        options: optionsFrom(state.sections, (s) => sectionName(s)),
      },
      {
        name: "subject_id",
        label: t("console.assignments.subject"),
        type: "select",
        required: true,
        options: optionsFrom(state.subjects, (s) => s.name),
      },
      teacherField(null),
    ],
    onSubmit: async (values) => {
      const created = await data.createAssignment({
        class_id: num(values.class_id),
        subject_id: num(values.subject_id),
        teacher_id: num(values.teacher_id),
        school_year_id: state.activeYear.id,
      });
      markSaved("assignments-body", created?.id);
      showToast(t("common.saved"));
      loadAssignments();
    },
  });
}

document
  .getElementById("btn-add-assignment")
  .addEventListener("click", () => openAssignmentForm());
