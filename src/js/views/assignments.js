// ─────────────────────────────────────────────────────────────────
//  assignments.js — assignment add/edit/delete forms and the Manage
//  Assignments modal (the gradebook's assignment list). Reads gradebook
//  context via gradebook.js's getGradebookState()/loadGradebook() rather
//  than taking it as parameters (see gradebook.js's header comment).
// ─────────────────────────────────────────────────────────────────
import { registerDialog } from "../dialog.js";
import { t } from "../i18n.js";
import { db } from "../teacherData/index.js";
import { state } from "../teacherState.js";
import { openModal } from "../teacherModal.js";
import { showToast, openConfirm } from "../teacherFeedback.js";
import { makeActionBtn, escapeHtml } from "../teacherTableHelpers.js";
import { formatDate } from "../teacherFormat.js";
import {
  getGradebookState,
  loadGradebook,
  categoryOptions,
} from "./gradebook.js";
import { openColumnGrades } from "./columnGrades.js";

// ── Gradebook: Manage Assignments modal ─────────────────────────
const assignmentsOverlay = document.getElementById("assignments-overlay");
const manageTitle = document.getElementById("manage-title");
const manageBody = document.getElementById("manage-body");

document
  .getElementById("manage-close")
  .addEventListener("click", closeManageAssignments);
document
  .getElementById("manage-done")
  .addEventListener("click", closeManageAssignments);
document
  .getElementById("manage-add")
  .addEventListener("click", () => openAddAssignment());

export function openAddAssignment() {
  const { periodId } = getGradebookState();
  openModal({
    title: t("admin.form.addAssignmentTitle", {
      subject: state.currentClass.subjectName,
      class: state.currentClass.className,
    }),
    submitLabel: t("admin.gradebook.addAssignment"),
    fields: [
      {
        name: "name",
        label: t("admin.form.name"),
        type: "text",
        required: true,
        placeholder: t("admin.form.assignmentNamePlaceholder"),
      },
      { name: "due_date", label: t("admin.form.dueDate"), type: "date" },
      {
        name: "max_score",
        label: t("admin.form.maxScore"),
        type: "number",
        required: true,
        value: "100",
        min: 1,
        step: "0.01",
      },
      {
        name: "category_id",
        label: t("admin.form.category"),
        type: "select",
        options: categoryOptions(),
        help: t("admin.form.categoryHelp"),
      },
      { name: "note", label: t("admin.form.note"), type: "textarea" },
    ],
    onSubmit: async (formData) => {
      await db.insertAssignment({
        class_subject_teacher_id: state.currentClass.cstId,
        grading_period_id: periodId,
        name: formData.name.trim(),
        due_date: formData.due_date || null,
        max_score: Number(formData.max_score),
        category_id: formData.category_id ? Number(formData.category_id) : null,
        note: formData.note?.trim() || null,
      });
      showToast(t("admin.toast.assignmentCreated", { name: formData.name }));
      loadGradebook();
    },
  });
}

export function openEditAssignment(assignment) {
  openModal({
    title: t("admin.form.editAssignmentTitle"),
    submitLabel: t("admin.form.saveChanges"),
    fields: [
      {
        name: "name",
        label: t("admin.form.name"),
        type: "text",
        required: true,
        value: assignment.name,
      },
      {
        name: "due_date",
        label: t("admin.form.dueDate"),
        type: "date",
        value: assignment.due_date ?? "",
      },
      {
        name: "max_score",
        label: t("admin.form.maxScore"),
        type: "number",
        required: true,
        value: assignment.max_score,
        min: 1,
        step: "0.01",
      },
      {
        name: "category_id",
        label: t("admin.form.category"),
        type: "select",
        value: assignment.category_id ?? "",
        options: categoryOptions(),
      },
      {
        name: "note",
        label: t("admin.form.note"),
        type: "textarea",
        value: assignment.note ?? "",
      },
    ],
    onSubmit: async (formData) => {
      await db.updateAssignment(assignment.id, {
        name: formData.name.trim(),
        due_date: formData.due_date || null,
        max_score: Number(formData.max_score),
        category_id: formData.category_id ? Number(formData.category_id) : null,
        note: formData.note?.trim() || null,
      });
      showToast(t("admin.toast.assignmentUpdated", { name: formData.name }));
      loadGradebook();
    },
  });
}

export function confirmDeleteAssignment(assignment) {
  openConfirm(
    t("admin.confirm.deleteAssignment", { name: assignment.name }),
    async () => {
      await db.deleteAssignment(assignment.id);
      showToast(t("admin.toast.assignmentDeleted", { name: assignment.name }));
      loadGradebook();
    },
  );
}

// Assignment add/edit/delete moved here when the gradebook became student
// rows. Reuses the same add/edit/delete flows; the generic form modal stacks
// on top, and loadGradebook() re-renders this list while it's open.
export function openManageAssignments() {
  renderManageAssignments();
  assignmentsOverlay.classList.add("active");
}

function closeManageAssignments() {
  assignmentsOverlay.classList.remove("active");
}

function renderManageAssignments() {
  const gbState = getGradebookState();
  const assignments = gbState?.assignments ?? [];
  const periodName =
    state.periods.find((p) => p.id === gbState?.periodId)?.name ?? "";
  manageTitle.textContent = t("admin.manage.title", { period: periodName });

  if (!assignments.length) {
    manageBody.innerHTML = `<p class="drawer-muted">${t("admin.manage.empty")}</p>`;
    return;
  }

  const catById = Object.fromEntries(
    (gbState?.categories ?? []).map((c) => [c.id, c.name]),
  );

  manageBody.innerHTML = "";
  assignments.forEach((a) => {
    const item = document.createElement("div");
    item.className = "manage-item";

    const catName = a.category_id ? catById[a.category_id] : null;
    const info = document.createElement("div");
    info.className = "manage-item-info";
    info.innerHTML = `
      <b>${escapeHtml(a.name)}</b>
      <span class="manage-item-meta">/ ${a.max_score}${
        a.due_date ? " · due " + formatDate(a.due_date) : ""
      }${catName ? " · " + escapeHtml(catName) : ""}</span>`;

    const actions = document.createElement("div");
    actions.className = "manage-item-actions";
    actions.appendChild(
      makeActionBtn("edit_note", t("admin.manage.enterScores"), () =>
        openColumnGrades(a),
      ),
    );
    actions.appendChild(
      makeActionBtn("edit", t("common.edit"), () => openEditAssignment(a)),
    );
    actions.appendChild(
      makeActionBtn(
        "delete",
        t("common.delete"),
        () => confirmDeleteAssignment(a),
        true,
      ),
    );

    item.append(info, actions);
    manageBody.appendChild(item);
  });
}

/** Keep an open Manage Assignments list in sync after a gradebook reload. */
export function renderManageAssignmentsIfOpen() {
  if (assignmentsOverlay.classList.contains("active"))
    renderManageAssignments();
}

registerDialog(assignmentsOverlay, { close: closeManageAssignments });
