// ─────────────────────────────────────────────────────────────────
//  gradebook.js — the class workspace's Gradebook tab hub: renders the
//  per-student grade table and owns `gradebookState` (single writer here).
//  Sibling gradebook features (assignments, per-student grades, categories,
//  post grades, column entry) read it via `getGradebookState()` and refresh
//  it via `loadGradebook()` rather than each threading their own params —
//  see the split-monolith plan for why this pair of modules is allowed to
//  import each other (every cross-call happens inside an event handler,
//  never at module top-level).
// ─────────────────────────────────────────────────────────────────
import { t } from "../i18n.js";
import { skeletonBlock } from "../ui.js";
import { db } from "../teacherData/index.js";
import { state } from "../teacherState.js";
import { renderErrorBlock, escapeHtml } from "../teacherTableHelpers.js";
import { getCurrentPeriodId, gradeCellHtml } from "../teacherFormat.js";
import {
  openAddAssignment,
  openManageAssignments,
  renderManageAssignmentsIfOpen,
} from "./assignments.js";
import { openStudentGradesModal } from "./studentGrades.js";
import { openCategoriesModal } from "./categories.js";
import { openPostGrades } from "./postGrades.js";

let gradebookState = null; // { cstId, periodId, assignments, students, categories }

export function getGradebookState() {
  return gradebookState;
}

// Category dropdown options for the assignment form, from the loaded gradebook.
export function categoryOptions() {
  return (gradebookState?.categories ?? []).map((c) => ({
    value: c.id,
    label: `${c.name} (${Number(c.weight)}%)`,
  }));
}

export function renderGradebookTab(content) {
  const periodOptions = state.periods
    .map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`)
    .join("");

  content.innerHTML = `
    <div class="view-toolbar">
      <div class="toolbar-filters">
        <label for="gradebook-period">${t("admin.gradebook.period")}</label>
        <select id="gradebook-period">${periodOptions}</select>
      </div>
      <div class="toolbar-actions">
        <button class="btn btn-ghost" id="btn-categories">
          <span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-category"></use></svg></span> ${t("admin.gradebook.categories")}
        </button>
        <button class="btn btn-secondary" id="btn-manage-assignments">
          <span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-list_alt"></use></svg></span> ${t("admin.gradebook.manage")}
        </button>
        <button class="btn btn-primary" id="btn-add-assignment">
          <span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-add"></use></svg></span> ${t("admin.gradebook.addAssignment")}
        </button>
        <button class="btn btn-primary" id="btn-post-grades">
          <span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-grading"></use></svg></span> ${t("admin.gradebook.postGrades")}
        </button>
      </div>
    </div>
    <div class="recent-activity">
      <div id="gradebook-grid">${skeletonBlock(4)}</div>
    </div>`;

  const periodSelect = document.getElementById("gradebook-period");
  periodSelect.value = getCurrentPeriodId();
  periodSelect.addEventListener("change", loadGradebook);

  document
    .getElementById("btn-add-assignment")
    .addEventListener("click", openAddAssignment);
  document
    .getElementById("btn-manage-assignments")
    .addEventListener("click", openManageAssignments);
  document
    .getElementById("btn-categories")
    .addEventListener("click", openCategoriesModal);
  document
    .getElementById("btn-post-grades")
    .addEventListener("click", openPostGrades);

  loadGradebook();
}

export async function loadGradebook() {
  const grid = document.getElementById("gradebook-grid");
  const periodId = Number(document.getElementById("gradebook-period").value);
  const cstId = state.currentClass.cstId;
  grid.innerHTML = skeletonBlock(4);

  try {
    const [assignments, roster, periodGrades, categories] = await Promise.all([
      db.fetchAssignments(cstId, periodId),
      db.fetchRoster(state.currentClass.classId),
      db.fetchPeriodGrades(cstId, periodId),
      db.fetchCategories(cstId),
    ]);
    const students = roster.filter((s) => s.status === "active");

    gradebookState = { cstId, periodId, assignments, students, categories };
    renderGradebook(assignments, students, periodGrades);

    // Keep an open Manage Assignments list in sync after add/edit/delete.
    renderManageAssignmentsIfOpen();
  } catch (err) {
    console.error(err);
    renderErrorBlock(grid, loadGradebook);
  }
}

// Clean, scannable table: one row per student → name, current-period grade
// (colored by the standard bands), completion count. Grade entry lives in the
// per-student modal opened by clicking the row.
function renderGradebook(assignments, students, periodGrades) {
  const grid = document.getElementById("gradebook-grid");

  if (!assignments.length) {
    grid.innerHTML = `
      <div class="empty-state">
        <span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-assignment"></use></svg></span>
        <p>${t("admin.gradebook.noAssignments")}</p>
        <p class="empty-sub">${t("admin.gradebook.noAssignmentsSub")}</p>
      </div>`;
    return;
  }
  if (!students.length) {
    grid.innerHTML = `<div class="loading-cell">${t("admin.gradebook.noActiveStudents")}</div>`;
    return;
  }

  const overallMap = {};
  periodGrades.forEach((p) => {
    overallMap[p.student_id] = p;
  });
  const total = assignments.length;

  const bodyRows = students
    .map((s) => {
      const o = overallMap[s.id];
      const score = o && o.period_score != null ? Number(o.period_score) : null;
      const graded = o ? o.graded_count : 0;
      return `<tr class="row-clickable" data-student="${s.id}">
        <td>${escapeHtml(s.last_name)}, ${escapeHtml(s.first_name)}</td>
        <td>${gradeCellHtml(score)}</td>
        <td class="text-muted">${t("admin.gradebook.gradedCount", { graded, total })}</td>
      </tr>`;
    })
    .join("");

  grid.innerHTML = `
    <table class="data-table gradebook-table">
      <thead>
        <tr><th>${t("admin.gradebook.student")}</th><th>${t("admin.gradebook.grade")}</th><th>${t("admin.gradebook.completion")}</th></tr>
      </thead>
      <tbody>${bodyRows}</tbody>
    </table>`;

  grid.querySelectorAll("tr.row-clickable").forEach((tr) => {
    tr.addEventListener("click", () => {
      const s = students.find((x) => String(x.id) === tr.dataset.student);
      if (s) openStudentGradesModal(s);
    });
  });
}
