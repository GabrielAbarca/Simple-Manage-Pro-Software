// ─────────────────────────────────────────────────────────────────
//  studentGrades.js — per-student grade entry modal (detail view + grade
//  entry), opened by clicking a row in the gradebook table.
// ─────────────────────────────────────────────────────────────────
import { registerDialog } from "../dialog.js";
import { t, tn } from "../i18n.js";
import { skeletonBlock } from "../ui.js";
import { db } from "../teacherData/index.js";
import { state } from "../teacherState.js";
import { showToast, errorText } from "../teacherFeedback.js";
import { renderErrorBlock, escapeHtml } from "../teacherTableHelpers.js";
import { formatDate, gradeStatus } from "../teacherFormat.js";
import { getGradebookState, loadGradebook } from "./gradebook.js";

const sgOverlay = document.getElementById("student-grades-overlay");
const sgTitle = document.getElementById("sg-title");
const sgBody = document.getElementById("sg-body");
const sgSave = /** @type {HTMLButtonElement} */ (
  document.getElementById("sg-save")
);

document
  .getElementById("sg-close")
  .addEventListener("click", closeStudentGradesModal);
document
  .getElementById("sg-cancel")
  .addEventListener("click", closeStudentGradesModal);
sgSave.addEventListener("click", saveStudentGrades);

// Per-assignment grade unlock: clicking an Edit button unlocks ONLY that one
// score input (delegated because sgBody is re-rendered on every open).
sgBody.addEventListener("click", (e) => {
  const btn = e.target.closest(".sg-edit-btn");
  if (!btn) return;
  const input = sgBody.querySelector(
    `.sg-score[data-assignment="${btn.dataset.assignment}"]`,
  );
  if (input) {
    input.readOnly = false;
    input.classList.remove("sg-locked");
    input.focus();
    input.select();
  }
  btn.remove();
});

let _studentGradesState = null;

export async function openStudentGradesModal(student) {
  const gbState = getGradebookState();
  if (!gbState) return;
  const { assignments, periodId } = gbState;
  const periodName = state.periods.find((p) => p.id === periodId)?.name ?? "";

  _studentGradesState = { student, assignments, gradeByAssignment: {} };
  sgTitle.textContent = `${student.first_name} ${student.last_name}`;
  sgBody.innerHTML = skeletonBlock();
  sgOverlay.classList.add("active");

  if (!assignments.length) {
    sgBody.innerHTML = `<p class="drawer-muted">${t("admin.sg.noAssignments", { period: escapeHtml(periodName) })}</p>`;
    return;
  }

  let grades;
  try {
    grades = await db.fetchStudentAssignmentGrades(
      assignments.map((a) => a.id),
      student.id,
    );
  } catch (err) {
    console.error(err);
    renderErrorBlock(sgBody, () => openStudentGradesModal(student));
    return;
  }

  const gradeByAssignment = Object.fromEntries(
    grades.map((g) => [g.assignment_id, g]),
  );
  _studentGradesState.gradeByAssignment = gradeByAssignment;

  const rows = assignments
    .map((a) => {
      const g = gradeByAssignment[a.id];
      const score = g?.score ?? "";
      const note = g?.note ?? "";
      const status = gradeStatus(g, a.due_date);
      // Accidental-overwrite guard: an already-graded score renders locked
      // (read-only) behind a per-assignment Edit button. Ungraded scores stay
      // directly editable. This is per-assignment, never a whole-modal toggle.
      const graded = g && g.score != null;
      const scoreField = graded
        ? `<input class="sg-score sg-locked" type="number" min="0" max="${a.max_score}" step="0.01"
            data-assignment="${a.id}" data-original="${score}" value="${score}" readonly
            aria-label="${t("a11y.scoreFor", { name: a.name })}" />
          <button type="button" class="sg-edit-btn" data-assignment="${a.id}" title="${t("admin.sg.editScore")}" aria-label="${t("admin.sg.editScore")}">
            <span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-edit"></use></svg></span>
          </button>`
        : `<input class="sg-score" type="number" min="0" max="${a.max_score}" step="0.01"
            data-assignment="${a.id}" data-original="${score}" value="${score}" placeholder="—"
            aria-label="${t("a11y.scoreFor", { name: a.name })}" />`;
      return `
      <div class="sg-row">
        <span class="sg-cell sg-name" title="${escapeHtml(a.name)}">${escapeHtml(a.name)}</span>
        <span class="sg-cell sg-num">${a.max_score}</span>
        <span class="sg-cell sg-muted">${formatDate(a.due_date)}</span>
        <span class="sg-cell sg-score-cell">
          ${scoreField}
        </span>
        <span class="sg-cell"><span class="badge ${status.cls}">${status.label}</span></span>
        <span class="sg-cell sg-muted">${formatDate(g?.created_at)}</span>
        <span class="sg-cell sg-muted">${formatDate(g?.graded_at)}</span>
        <span class="sg-cell">
          <input class="sg-note" type="text" data-assignment="${a.id}"
            data-original="${escapeHtml(note)}" value="${escapeHtml(note)}" placeholder="${t("admin.sg.notePlaceholder")}"
            aria-label="${t("a11y.noteFor", { name: a.name })}" />
        </span>
      </div>`;
    })
    .join("");

  sgBody.innerHTML = `
    <p class="sg-period">${tn("admin.sg.periodLine", assignments.length, { period: escapeHtml(periodName), count: assignments.length })}</p>
    <div class="sg-scroll">
      <div class="sg-grid">
        <div class="sg-row sg-head">
          <span class="sg-cell">${t("admin.sg.assignment")}</span>
          <span class="sg-cell sg-num">${t("admin.sg.max")}</span>
          <span class="sg-cell">${t("admin.sg.due")}</span>
          <span class="sg-cell">${t("admin.sg.score")}</span>
          <span class="sg-cell">${t("admin.sg.status")}</span>
          <span class="sg-cell">${t("admin.sg.dateAdded")}</span>
          <span class="sg-cell">${t("admin.sg.dateGraded")}</span>
          <span class="sg-cell">${t("admin.sg.note")}</span>
        </div>
        ${rows}
      </div>
    </div>`;
}

function closeStudentGradesModal() {
  sgOverlay.classList.remove("active");
  sgBody.innerHTML = "";
  _studentGradesState = null;
}

async function saveStudentGrades() {
  if (!_studentGradesState) return;
  const { student, assignments, gradeByAssignment } = _studentGradesState;
  const maxMap = Object.fromEntries(
    assignments.map((a) => [a.id, Number(a.max_score)]),
  );

  const rows = [];
  let errorMsg = null;

  document.querySelectorAll("#sg-body .sg-score").forEach((input) => {
    const aId = Number(input.dataset.assignment);
    const noteInput = document.querySelector(
      `#sg-body .sg-note[data-assignment="${aId}"]`,
    );
    const scoreVal = input.value.trim();
    const noteVal = (noteInput?.value ?? "").trim();
    const scoreChanged = scoreVal !== (input.dataset.original ?? "");
    const noteChanged = noteVal !== (noteInput?.dataset.original ?? "");
    if (!scoreChanged && !noteChanged) return;

    let score = null;
    if (scoreVal !== "") {
      score = Number(scoreVal);
      const max = maxMap[aId];
      if (Number.isNaN(score) || score < 0 || score > max) {
        errorMsg ??= t("admin.validation.scoreRange", { max });
        return;
      }
    }

    const existing = gradeByAssignment[aId];
    rows.push({
      assignment_id: aId,
      student_id: student.id,
      score,
      note: noteVal || null,
      // Re-stamp graded_at only when the score itself changes; otherwise keep
      // the existing timestamp (note-only edits shouldn't move "Date graded").
      graded_at: scoreChanged
        ? score == null
          ? null
          : new Date().toISOString()
        : (existing?.graded_at ?? null),
    });
  });

  if (errorMsg) {
    showToast(errorMsg, "error");
    return;
  }
  if (!rows.length) {
    showToast(t("admin.validation.noChanges"), "error");
    return;
  }

  sgSave.disabled = true;
  try {
    await db.upsertAssignmentGrades(rows);
    showToast(
      tn("admin.toast.gradesSaved", rows.length, {
        count: rows.length,
        name: student.first_name,
      }),
    );
    closeStudentGradesModal();
    loadGradebook(); // refresh current-period grade + completion from the view
  } catch (err) {
    showToast(errorText(err), "error");
  } finally {
    sgSave.disabled = false;
  }
}

registerDialog(sgOverlay, { close: closeStudentGradesModal });
