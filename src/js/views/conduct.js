// ─────────────────────────────────────────────────────────────────
//  views/conduct.js — the class workspace's Conduct tab: each student's
//  conducta for a period, and the discipline records behind it.
//  The arithmetic lives in ../conduct.js and the live mark comes from the
//  student_period_conduct view; this module only renders.
// ─────────────────────────────────────────────────────────────────
import { t, tn } from "../i18n.js";
import { skeletonBlock } from "../ui.js";
import { escapeHtml, renderErrorBlock } from "../teacherTableHelpers.js";
import { state } from "../teacherState.js";
import { getCurrentPeriodId } from "../teacherFormat.js";
import { db } from "../teacherData/index.js";
import { CONDUCT_MAX, groupRecordsByStudent } from "../conduct.js";
import { conductPassingScore, isConductPassing } from "../promotion.js";

let conductState = null;
let latestLoad = 0;

async function conductLoad() {
  const grid = document.getElementById("conduct-grid");
  const period = getSelectedPeriod();
  if (!period) {
    grid.innerHTML = `<div class="loading-cell">${t("admin.conduct.noPeriod")}</div>`;
    return;
  }
  const thisLoad = ++latestLoad;
  grid.innerHTML = skeletonBlock(4);
  try {
    const data = await fetchConductData(state.currentClass.classId, period);
    if (thisLoad !== latestLoad) return;
    conductState = buildConductState(data);
    renderConduct();
  } catch (err) {
    console.error(err);
    if (thisLoad === latestLoad) renderErrorBlock(grid, conductLoad);
  }
}

function icon(name) {
  return `<span class="material-symbols-outlined">
                <svg aria-hidden="true">
                    <use href="#icon-${name}"></use>
                </svg>
            </span>`;
}

function getSelectedPeriod() {
  const select = /** @type {HTMLSelectElement} */ (
    document.getElementById("conduct-period")
  );
  const periodId = Number(select.value);
  return state.periods.find((p) => p.id === periodId) ?? null;
}

async function fetchConductData(classId, period) {
  const roster = await db.fetchRoster(classId);
  const students = roster.filter((s) => s.status === "active");
  const [conductRows, records, teachers] = await Promise.all([
    db.fetchPeriodConduct(classId, period.id),
    db.fetchClassDiscipline(
      students.map((s) => s.id),
      period,
    ),
    db.fetchTeachers(),
  ]);
  return { students, conductRows, records, teachers };
}

function buildConductState({ students, conductRows, records, teachers }) {
  return {
    students,
    conductByStudent: new Map(conductRows.map((row) => [row.student_id, row])),
    recordsByStudent: groupRecordsByStudent(records),
    allRecords: records,
    teacherNames: new Map(
      teachers.map((t) => [t.id, `${t.first_name} ${t.last_name}`]),
    ),
    view: conductState?.view ?? "students",
    expanded: new Set(),
  };
}

function renderConduct() {
  const grid = document.getElementById("conduct-grid");
  if (!grid) return;
  renderSummary();
  grid.innerHTML = `<div class="loading-cell">${conductState.students.length} students, ${conductState.allRecords.length} records loaded.</div>`;
}

function scoreOf(studentId) {
  return (
    conductState.conductByStudent.get(studentId)?.conduct_score ?? CONDUCT_MAX
  );
}

function renderSummary() {
  const summary = document.getElementById("conduct-summary");
  const { students, allRecords } = conductState;
  const belowCount = students.filter(
    (s) => !isConductPassing(scoreOf(s.id), state.school),
  ).length;
  const parts = [tn("admin.conduct.recordCount", allRecords.length)];
  if (belowCount > 0) {
    const mark = conductPassingScore(state.school);
    parts.push(tn("admin.conduct.belowCount", belowCount, { mark }));
  }
  summary.textContent = parts.join(" · ");
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
            <button type="button" class="btn btn-secondary" id="btn-conduct-students" aria-pressed="true">
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
  periodSelect.addEventListener("change", conductLoad);
  conductLoad();
}
