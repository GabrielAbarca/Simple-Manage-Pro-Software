// ─────────────────────────────────────────────────────────────────
//  roster.js — the class workspace's Roster tab: the student list (with
//  per-period + Overall grade columns). Add/edit/delete forms live in
//  studentForm.js.
// ─────────────────────────────────────────────────────────────────
import { t } from "../i18n.js";
import { skeletonBlock } from "../ui.js";
import { db } from "../teacherData/index.js";
import { state } from "../teacherState.js";
import { bindAdminAction } from "../teacherAuth.js";
import {
  renderErrorBlock,
  makeActionBtn,
  escapeHtml,
} from "../teacherTableHelpers.js";
import { weightedOverall, gradeCellHtml } from "../teacherFormat.js";
import { openStudentDrawer } from "./studentDrawer.js";
import {
  openAddStudent,
  openEditStudent,
  confirmDeleteStudent,
} from "./studentForm.js";

// The roster is a CSS grid, so the column count has to reach the stylesheet:
// one grade column per grading period the year actually has, plus Overall.
// Costa Rica's MEP year runs two periodos, but a private colegio on three
// trimestres is equally valid — so the count comes from the data, never a
// literal. Kept in sync with the header/row cells, which map over state.periods.
function rosterColsStyle() {
  return `--roster-cols: ${state.periods.length + 1}`;
}

export function renderRosterTab(content) {
  content.innerHTML = `
    <div class="view-toolbar">
      <div class="search-bar">
        <span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-search"></use></svg></span>
        <input type="search" id="roster-search" placeholder="${t("admin.roster.searchPlaceholder")}" aria-label="${t("admin.roster.searchLabel")}" />
      </div>
      <button class="btn btn-primary" id="btn-add-student">
        <span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-person_add"></use></svg></span> ${t("admin.roster.addStudent")}
      </button>
    </div>
    <div class="recent-activity">
      <div class="roster-list" id="roster-list" style="${rosterColsStyle()}">
        <div class="roster-head">
          <div class="roster-row-cells">
            <span>${t("admin.roster.name")}</span>
            ${state.periods.map((p) => `<span>${escapeHtml(p.name)}</span>`).join("")}
            <span>${t("admin.roster.overall")}</span>
          </div>
        </div>
        <div id="roster-body">
          ${skeletonBlock(5)}
        </div>
      </div>
    </div>`;

  bindAdminAction(document.getElementById("btn-add-student"), openAddStudent);

  let searchTimeout;
  document.getElementById("roster-search").addEventListener("input", (e) => {
    clearTimeout(searchTimeout);
    const q = e.target.value.trim().toLowerCase();
    searchTimeout = setTimeout(() => renderRosterTable(filterRoster(q)), 250);
  });

  loadRoster();
}

let _rosterCache = [];
let _rosterPeriodGrades = {}; // student_id → { [period_order]: period_score }

export async function loadRoster() {
  try {
    const [roster, periodGrades] = await Promise.all([
      db.fetchRoster(state.currentClass.classId),
      db.fetchAllPeriodGrades(state.currentClass.cstId),
    ]);
    _rosterCache = roster;

    const orderByPeriodId = Object.fromEntries(
      state.periods.map((p) => [p.id, p.period_order]),
    );
    _rosterPeriodGrades = {};
    periodGrades.forEach((g) => {
      const order = orderByPeriodId[g.grading_period_id];
      if (order == null) return;
      (_rosterPeriodGrades[g.student_id] ??= {})[order] = g.period_score;
    });

    renderRosterTable(_rosterCache);
  } catch (err) {
    console.error(err);
    renderErrorBlock(document.getElementById("roster-body"), loadRoster);
  }
}

function filterRoster(q) {
  if (!q) return _rosterCache;
  return _rosterCache.filter(
    (s) =>
      s.first_name?.toLowerCase().includes(q) ||
      s.last_name?.toLowerCase().includes(q) ||
      s.email?.toLowerCase().includes(q) ||
      s.enrollment_number?.toLowerCase().includes(q),
  );
}

function renderRosterTable(students) {
  const body = document.getElementById("roster-body");
  if (!body) return;
  if (!students.length) {
    body.innerHTML = `<div class="loading-cell">${t("admin.roster.empty")}</div>`;
    return;
  }

  body.innerHTML = "";
  students.forEach((student) => {
    const fullName = `${student.last_name}, ${student.first_name}`;
    const scores = _rosterPeriodGrades[student.id] ?? {};
    const overall = weightedOverall(scores);

    const row = document.createElement("div");
    row.className = "roster-row";

    // Clickable unit — the whole cells block opens the student-360 drawer.
    const cells = document.createElement("div");
    cells.className = "roster-row-cells";
    cells.setAttribute("role", "button");
    cells.tabIndex = 0;
    cells.innerHTML = `
      <span class="roster-name">${escapeHtml(fullName)}</span>
      ${state.periods
        .map(
          (p) =>
            `<span class="roster-grade">${gradeCellHtml(scores[p.period_order])}</span>`,
        )
        .join("")}
      <span class="roster-grade">${gradeCellHtml(overall)}</span>`;
    cells.addEventListener("click", () => openStudentDrawer(student));
    cells.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openStudentDrawer(student);
      }
    });

    // Action rail — lives outside the clickable cells; revealed on hover/focus.
    const rail = document.createElement("div");
    rail.className = "roster-row-rail";
    rail.appendChild(
      makeActionBtn(
        "edit",
        t("common.edit"),
        (e) => {
          e.stopPropagation();
          openEditStudent(student);
        },
        false,
        true,
      ),
    );
    rail.appendChild(
      makeActionBtn(
        "delete",
        t("common.delete"),
        (e) => {
          e.stopPropagation();
          confirmDeleteStudent(
            student.id,
            `${student.first_name} ${student.last_name}`,
          );
        },
        true,
        true,
      ),
    );

    row.append(cells, rail);
    body.appendChild(row);
  });
}
