// ─────────────────────────────────────────────────────────────────
//  postConduct.js — post conducta modal: finalize a period's conducta to
//  the official report-card record.
//
//  The twin of postGrades.js, and posting means the same thing here: the
//  computed mark keeps moving as records are filed, the posted one does
//  not. That is what stops a deduction filed in October from silently
//  rewriting a conducta that went home on a report card in July.
//
//  Class-scoped rather than subject-scoped — conducta is one
//  institutional mark per period, so it is launched from the roster and
//  not from a gradebook.
// ─────────────────────────────────────────────────────────────────
import { registerDialog } from "../dialog.js";
import { t, tn } from "../i18n.js";
import { skeletonBlock } from "../ui.js";
import { db } from "../teacherData/index.js";
import { state } from "../teacherState.js";
import { showToast, errorText } from "../teacherFeedback.js";
import { renderErrorBlock, escapeHtml } from "../teacherTableHelpers.js";
import { conductCellHtml, getCurrentPeriodId } from "../teacherFormat.js";

const pcOverlay = document.getElementById("post-conduct-overlay");
const pcTitle = document.getElementById("pc-title");
const pcBody = document.getElementById("pc-body");
const pcSave = /** @type {HTMLButtonElement} */ (
  document.getElementById("pc-save")
);

document.getElementById("pc-close").addEventListener("click", closePostConduct);
document
  .getElementById("pc-cancel")
  .addEventListener("click", closePostConduct);
pcSave.addEventListener("click", savePostConduct);

let _postConductState = null;
let _onSaved = null;

/**
 * @param {() => any} [onSaved] called after a successful post, so the roster
 *   column refreshes without this module importing it back
 */
export async function openPostConduct(onSaved) {
  const classId = state.currentClass?.classId;
  const periodId = getCurrentPeriodId();
  if (!classId || !periodId) return;
  _onSaved = onSaved ?? null;

  const periodName = state.periods.find((p) => p.id === periodId)?.name ?? "";
  pcTitle.textContent = t("admin.pc.title", { period: periodName });
  pcBody.innerHTML = skeletonBlock();
  pcOverlay.classList.add("active");

  let students, computed, posted;
  try {
    [students, computed, posted] = await Promise.all([
      db.fetchRoster(classId),
      db.fetchPeriodConduct(classId, periodId),
      db.fetchPostedConduct(classId, periodId),
    ]);
  } catch (err) {
    console.error(err);
    renderErrorBlock(pcBody, () => openPostConduct(onSaved));
    return;
  }

  const computedById = Object.fromEntries(
    computed.map((c) => [c.student_id, c]),
  );
  const postedById = Object.fromEntries(posted.map((p) => [p.student_id, p]));
  _postConductState = { classId, periodId };

  if (!students.length) {
    pcBody.innerHTML = `<p class="drawer-muted">${t("admin.pc.noStudents")}</p>`;
    return;
  }

  const rows = students
    .map((s) => {
      const comp = computedById[s.id];
      const computedScore =
        comp && comp.conduct_score != null ? Number(comp.conduct_score) : null;
      const post = postedById[s.id];
      const postedScore =
        post && post.score != null ? Number(post.score) : null;
      const prefill =
        postedScore != null
          ? postedScore
          : computedScore != null
            ? computedScore
            : "";
      const note = post?.notes ?? "";
      return `
      <div class="pg-row">
        <span class="pg-cell pg-name">${escapeHtml(s.last_name)}, ${escapeHtml(s.first_name)}</span>
        <span class="pg-cell pg-center">${conductCellHtml(computedScore)}</span>
        <span class="pg-cell pg-center">${conductCellHtml(postedScore)}</span>
        <span class="pg-cell">
          <input class="pc-score" type="number" min="0" max="100" step="0.01"
            data-student="${s.id}" data-computed="${computedScore != null ? computedScore : ""}"
            value="${prefill}" placeholder="—"
            aria-label="${t("a11y.scoreFor", { name: `${s.last_name}, ${s.first_name}` })}" />
        </span>
        <span class="pg-cell">
          <input class="pc-note" type="text" data-student="${s.id}"
            value="${escapeHtml(note)}" placeholder="${t("admin.pc.commentPlaceholder")}"
            aria-label="${t("a11y.noteFor", { name: `${s.last_name}, ${s.first_name}` })}" />
        </span>
      </div>`;
    })
    .join("");

  pcBody.innerHTML = `
    <p class="sg-period">${t("admin.pc.intro", { period: escapeHtml(periodName) })}</p>
    <div class="sg-scroll">
      <div class="pg-grid">
        <div class="pg-row pg-head">
          <span class="pg-cell">${t("admin.pc.student")}</span>
          <span class="pg-cell pg-center">${t("admin.pc.computed")}</span>
          <span class="pg-cell pg-center">${t("admin.pc.posted")}</span>
          <span class="pg-cell">${t("admin.pc.toPost")}</span>
          <span class="pg-cell">${t("admin.pc.comment")}</span>
        </div>
        ${rows}
      </div>
    </div>
    <div class="pc-actions pg-actions">
      <button type="button" class="link-btn" id="pc-fill-computed">${t("admin.pc.reset")}</button>
    </div>`;

  document.getElementById("pc-fill-computed").addEventListener("click", () => {
    pcBody.querySelectorAll(".pc-score").forEach((el) => {
      const inp = /** @type {HTMLInputElement} */ (el);
      const c = inp.dataset.computed;
      if (c !== "") inp.value = c;
    });
  });
}

function closePostConduct() {
  pcOverlay.classList.remove("active");
  pcBody.innerHTML = "";
  _postConductState = null;
  _onSaved = null;
}

async function savePostConduct() {
  if (!_postConductState) return;
  const { periodId } = _postConductState;

  const rows = [];
  let errorMsg = null;
  const now = new Date().toISOString();

  pcBody.querySelectorAll(".pc-score").forEach((el) => {
    const input = /** @type {HTMLInputElement} */ (el);
    const studentId = Number(input.dataset.student);
    const noteInput = /** @type {HTMLInputElement | null} */ (
      pcBody.querySelector(`.pc-note[data-student="${studentId}"]`)
    );
    const scoreVal = input.value.trim();
    const noteVal = (noteInput?.value ?? "").trim();
    if (scoreVal === "") return; // skip students with no conducta to post

    const score = Number(scoreVal);
    if (Number.isNaN(score) || score < 0 || score > 100) {
      errorMsg ??= t("admin.validation.postRange");
      return;
    }
    rows.push({
      student_id: studentId,
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

  pcSave.disabled = true;
  try {
    await db.upsertConductGrades(rows);
    showToast(
      tn("admin.toast.conductPosted", rows.length, { count: rows.length }),
    );
    const done = _onSaved;
    closePostConduct();
    await done?.();
  } catch (err) {
    showToast(errorText(err), "error");
  } finally {
    pcSave.disabled = false;
  }
}

registerDialog(pcOverlay, { close: closePostConduct });
