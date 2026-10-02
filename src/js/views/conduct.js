// ─────────────────────────────────────────────────────────────────
//  views/conduct.js — the class workspace's Conduct tab: each student's
//  conducta for a period, and the discipline records behind it.
//  The arithmetic lives in ../conduct.js and the live mark comes from the
//  student_period_conduct view; this module only renders.
// ─────────────────────────────────────────────────────────────────
import { t } from "../i18n.js";
import { skeletonBlock } from "../ui.js";
import { escapeHtml } from "../teacherTableHelpers.js";
import { state } from "../teacherState.js";
import { getCurrentPeriodId } from "../teacherFormat.js";

function icon(name) {
  return `<span class="material-symbols-outlined">
                <svg aria-hidden="true">
                    <use href="#icon-${name}"></use>
                </svg>
            </span>`;
}

export function renderConductTab(content) {
  const periodOptions = state.periods
    .map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`)
    .join("");

  content.innerHTML = `
    <div class="view-toolbar">
        <div class="toolbar-filters">
            <label for="conduct-period">${t("admin.gradebook.period")}</label>
            <select id="conduct-period">${periodOptions}</select>
        </div>
        <div class="toolbar-actions">
            <button class="btn btn-secondary" id="btn-conduct-students" aria-pressed="true">
                ${icon("group")} ${t("admin.conduct.byStudent")}
            </button>
            <button type="button" class="btn btn-ghost" id="btn-conduct-records" aria-pressed="false">
            ${icon("list_alt")} ${t("admin.conduct.allRecords")}
            </button>
            <button type="button" class="btn btn-primary" id="btn-conduct-add">
            ${icon("add")} ${t("admin.conduct.addRecord")}
            </button>
        </div>
    </div>
    <p class="text-muted" id="conduct-summary"></p>
     <div class="recent-activity">
      <div id="conduct-grid">${skeletonBlock(4)}</div>
    </div>
    <p class="text-muted">${icon("info")} ${t("admin.conduct.footnote")}</p>`;

  const periodSelect = /** @type {HTMLSelectElement} */ (
    document.getElementById("conduct-period")
  );
  periodSelect.value = String(getCurrentPeriodId());
}
