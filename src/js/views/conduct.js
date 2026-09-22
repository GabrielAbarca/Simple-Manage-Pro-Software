import { t } from "../i18n.js";
import { skeletonBlock } from "../ui.js";
import { renderErrorBlock, escapeHtml } from "../teacherTableHelpers.js";
import { db } from "../teacherData/index.js";
import { state } from "../teacherState.js";

export function renderConductTab(content) {
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
        <button class="btn btn-secondary" id="btn-manage-assignments">
          <span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-list_alt"></use></svg></span> ${t("By Student")}
        </button>
        <button class="btn btn-primary" id="btn-add-assignment">
          <span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-add"></use></svg></span> ${t("All Records")}
        </button>
        <button class="btn btn-primary" id="btn-post-grades">
          <span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-grading"></use></svg></span> ${t("Add Record")}
        </button>
      </div>
    </div>
    <div class="recent-activity">
        <div id="conduct-grid">${skeletonBlock(4)}</div>
    </div> 
  `;
}
