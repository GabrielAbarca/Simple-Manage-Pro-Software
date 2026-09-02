// ─────────────────────────────────────────────────────────────────
//  columnGrades.js — column grade entry modal (item 4): one assignment,
//  every student, opened from the Manage Assignments list.
// ─────────────────────────────────────────────────────────────────
import { registerDialog } from "../dialog.js";
import { t, tn } from "../i18n.js";
import { skeletonBlock } from "../ui.js";
import { db } from "../teacherData/index.js";
import { showToast, errorText } from "../teacherFeedback.js";
import { renderErrorBlock, escapeHtml } from "../teacherTableHelpers.js";
import { formatDate } from "../teacherFormat.js";
import { getGradebookState, loadGradebook } from "./gradebook.js";

const cgOverlay = document.getElementById("column-grades-overlay");
const cgTitle = document.getElementById("cg-title");
const cgBody = document.getElementById("cg-body");
const cgSave = /** @type {HTMLButtonElement} */ (
  document.getElementById("cg-save")
);

document
  .getElementById("cg-close")
  .addEventListener("click", closeColumnGrades);
document
  .getElementById("cg-cancel")
  .addEventListener("click", closeColumnGrades);
cgSave.addEventListener("click", saveColumnGrades);

let _columnState = null;

export async function openColumnGrades(assignment) {
  const gbState = getGradebookState();
  if (!gbState) return;
  const students = gbState.students; // active students only
  cgTitle.textContent = t("admin.cg.title", { assignment: assignment.name });
  cgBody.innerHTML = skeletonBlock();
  cgOverlay.classList.add("active");

  let existing;
  try {
    existing = await db.fetchAssignmentColumn(assignment.id);
  } catch (err) {
    console.error(err);
    renderErrorBlock(cgBody, () => openColumnGrades(assignment));
    return;
  }
  const byStudent = Object.fromEntries(existing.map((g) => [g.student_id, g]));
  _columnState = { assignment, byStudent };

  if (!students.length) {
    cgBody.innerHTML = `<p class="drawer-muted">${t("admin.pg.noStudents")}</p>`;
    return;
  }

  const rows = students
    .map((s) => {
      const g = byStudent[s.id];
      const score = g?.score ?? "";
      const note = g?.note ?? "";
      return `
      <div class="cg-row">
        <span class="cg-cell cg-name">${escapeHtml(s.last_name)}, ${escapeHtml(s.first_name)}</span>
        <span class="cg-cell">
          <input class="cg-score" type="number" min="0" max="${assignment.max_score}" step="0.01"
            data-student="${s.id}" data-original="${score}" value="${score}" placeholder="—"
            aria-label="${t("a11y.scoreFor", { name: `${s.last_name}, ${s.first_name}` })}" />
        </span>
        <span class="cg-cell">
          <input class="cg-note" type="text" data-student="${s.id}"
            data-original="${escapeHtml(note)}" value="${escapeHtml(note)}" placeholder="${t("admin.cg.notePlaceholder")}"
            aria-label="${t("a11y.noteFor", { name: `${s.last_name}, ${s.first_name}` })}" />
        </span>
      </div>`;
    })
    .join("");

  cgBody.innerHTML = `
    <p class="sg-period">${t("admin.cg.outOf", { max: assignment.max_score })}${
      assignment.due_date
        ? " · " + t("admin.cg.dueOn", { date: formatDate(assignment.due_date) })
        : ""
    } · ${tn("admin.students", students.length)}</p>
    <div class="sg-scroll">
      <div class="cg-grid">
        <div class="cg-row cg-head">
          <span class="cg-cell">${t("admin.cg.student")}</span>
          <span class="cg-cell">${t("admin.cg.score")}</span>
          <span class="cg-cell">${t("admin.cg.note")}</span>
        </div>
        ${rows}
      </div>
    </div>`;
}

function closeColumnGrades() {
  cgOverlay.classList.remove("active");
  cgBody.innerHTML = "";
  _columnState = null;
}

async function saveColumnGrades() {
  if (!_columnState) return;
  const { assignment, byStudent } = _columnState;
  const max = Number(assignment.max_score);

  const rows = [];
  let errorMsg = null;

  cgBody.querySelectorAll(".cg-score").forEach((input) => {
    const studentId = Number(input.dataset.student);
    const noteInput = cgBody.querySelector(
      `.cg-note[data-student="${studentId}"]`,
    );
    const scoreVal = input.value.trim();
    const noteVal = (noteInput?.value ?? "").trim();
    const scoreChanged = scoreVal !== (input.dataset.original ?? "");
    const noteChanged = noteVal !== (noteInput?.dataset.original ?? "");
    if (!scoreChanged && !noteChanged) return;

    let score = null;
    if (scoreVal !== "") {
      score = Number(scoreVal);
      if (Number.isNaN(score) || score < 0 || score > max) {
        errorMsg ??= t("admin.validation.scoreRange", { max });
        return;
      }
    }
    const existing = byStudent[studentId];
    rows.push({
      assignment_id: assignment.id,
      student_id: studentId,
      score,
      note: noteVal || null,
      // Same graded_at rule as the per-student modal: re-stamp only on a score
      // change; null it when the score is cleared.
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

  cgSave.disabled = true;
  try {
    await db.upsertAssignmentGrades(rows);
    showToast(
      tn("admin.toast.scoresSaved", rows.length, { count: rows.length }),
    );
    closeColumnGrades();
    loadGradebook();
  } catch (err) {
    showToast(errorText(err), "error");
  } finally {
    cgSave.disabled = false;
  }
}

registerDialog(cgOverlay, { close: closeColumnGrades });
