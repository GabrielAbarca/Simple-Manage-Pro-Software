// ─────────────────────────────────────────────────────────────────
//  postGrades.js — post grades modal (item 1): finalize a period's
//  computed grade to the official report-card record.
// ─────────────────────────────────────────────────────────────────
import { registerDialog } from "../dialog.js";
import { t, tn } from "../i18n.js";
import { skeletonBlock } from "../ui.js";
import { db } from "../teacherData/index.js";
import { state } from "../teacherState.js";
import { showToast, errorText } from "../teacherFeedback.js";
import { renderErrorBlock, escapeHtml } from "../teacherTableHelpers.js";
import { gradeCellHtml, gradeBandClass } from "../teacherFormat.js";
import { getGradebookState } from "./gradebook.js";

// ── Post grades modal (item 1) ─────────────────────────────────
const pgOverlay = document.getElementById("post-grades-overlay");
const pgTitle = document.getElementById("pg-title");
const pgBody = document.getElementById("pg-body");
const pgSave = /** @type {HTMLButtonElement} */ (
  document.getElementById("pg-save")
);

document.getElementById("pg-close").addEventListener("click", closePostGrades);
document.getElementById("pg-cancel").addEventListener("click", closePostGrades);
pgSave.addEventListener("click", savePostGrades);

let _postGradesState = null;

export async function openPostGrades() {
  const gbState = getGradebookState();
  if (!gbState) return;
  const { cstId, periodId, students } = gbState;
  const periodName = state.periods.find((p) => p.id === periodId)?.name ?? "";
  pgTitle.textContent = t("admin.pg.title", { period: periodName });
  pgBody.innerHTML = skeletonBlock();
  pgOverlay.classList.add("active");

  let computed, posted;
  try {
    [computed, posted] = await Promise.all([
      db.fetchPeriodGrades(cstId, periodId),
      db.fetchPostedGrades(cstId, periodId),
    ]);
  } catch (err) {
    console.error(err);
    renderErrorBlock(pgBody, () => openPostGrades());
    return;
  }

  const computedById = Object.fromEntries(
    computed.map((c) => [c.student_id, c]),
  );
  const postedById = Object.fromEntries(posted.map((p) => [p.student_id, p]));
  _postGradesState = { cstId, periodId };

  if (!students.length) {
    pgBody.innerHTML = `<p class="drawer-muted">${t("admin.pg.noStudents")}</p>`;
    return;
  }

  const rows = students
    .map((s) => {
      const comp = computedById[s.id];
      const computedScore =
        comp && comp.period_score != null ? Number(comp.period_score) : null;
      const post = postedById[s.id];
      const postedScore =
        post && post.score != null ? Number(post.score) : null;
      const prefill =
        postedScore != null
          ? postedScore
          : computedScore != null
            ? computedScore.toFixed(1)
            : "";
      const note = post?.notes ?? "";
      const postedCell =
        postedScore != null
          ? `<b class="${gradeBandClass(postedScore)}">${postedScore.toFixed(1)}</b>`
          : '<span class="text-muted">—</span>';
      return `
      <div class="pg-row">
        <span class="pg-cell pg-name">${escapeHtml(s.last_name)}, ${escapeHtml(s.first_name)}</span>
        <span class="pg-cell pg-center">${gradeCellHtml(computedScore)}</span>
        <span class="pg-cell pg-center">${postedCell}</span>
        <span class="pg-cell">
          <input class="pg-score" type="number" min="0" max="100" step="0.01"
            data-student="${s.id}" data-computed="${computedScore != null ? computedScore.toFixed(2) : ""}"
            value="${prefill}" placeholder="—"
            aria-label="${t("a11y.scoreFor", { name: `${s.last_name}, ${s.first_name}` })}" />
        </span>
        <span class="pg-cell">
          <input class="pg-note" type="text" data-student="${s.id}"
            value="${escapeHtml(note)}" placeholder="${t("admin.pg.commentPlaceholder")}"
            aria-label="${t("a11y.noteFor", { name: `${s.last_name}, ${s.first_name}` })}" />
        </span>
      </div>`;
    })
    .join("");

  pgBody.innerHTML = `
    <p class="sg-period">${t("admin.pg.intro", { period: escapeHtml(periodName) })}</p>
    <div class="sg-scroll">
      <div class="pg-grid">
        <div class="pg-row pg-head">
          <span class="pg-cell">${t("admin.pg.student")}</span>
          <span class="pg-cell pg-center">${t("admin.pg.computed")}</span>
          <span class="pg-cell pg-center">${t("admin.pg.posted")}</span>
          <span class="pg-cell">${t("admin.pg.toPost")}</span>
          <span class="pg-cell">${t("admin.pg.comment")}</span>
        </div>
        ${rows}
      </div>
    </div>
    <div class="pg-actions">
      <button type="button" class="link-btn" id="pg-fill-computed">${t("admin.pg.reset")}</button>
    </div>`;

  document.getElementById("pg-fill-computed").addEventListener("click", () => {
    pgBody.querySelectorAll(".pg-score").forEach((inp) => {
      const c = inp.dataset.computed;
      if (c !== "") inp.value = Number(c).toFixed(1);
    });
  });
}

function closePostGrades() {
  pgOverlay.classList.remove("active");
  pgBody.innerHTML = "";
  _postGradesState = null;
}

async function savePostGrades() {
  if (!_postGradesState) return;
  const { cstId, periodId } = _postGradesState;

  const rows = [];
  let errorMsg = null;
  const now = new Date().toISOString();

  pgBody.querySelectorAll(".pg-score").forEach((input) => {
    const studentId = Number(input.dataset.student);
    const noteInput = pgBody.querySelector(
      `.pg-note[data-student="${studentId}"]`,
    );
    const scoreVal = input.value.trim();
    const noteVal = (noteInput?.value ?? "").trim();
    if (scoreVal === "") return; // skip students with no grade to post

    const score = Number(scoreVal);
    if (Number.isNaN(score) || score < 0 || score > 100) {
      errorMsg ??= t("admin.validation.postRange");
      return;
    }
    rows.push({
      student_id: studentId,
      class_subject_teacher_id: cstId,
      grading_period_id: periodId,
      score,
      notes: noteVal || null,
      submitted_at: now,
    });
  });

  if (errorMsg) {
    showToast(errorMsg, "error");
    return;
  }
  if (!rows.length) {
    showToast(t("admin.validation.atLeastOne"), "error");
    return;
  }

  pgSave.disabled = true;
  try {
    await db.upsertStudentGrades(rows);
    showToast(
      tn("admin.toast.gradesPosted", rows.length, { count: rows.length }),
    );
    closePostGrades();
  } catch (err) {
    showToast(errorText(err), "error");
  } finally {
    pgSave.disabled = false;
  }
}

registerDialog(pgOverlay, { close: closePostGrades });
