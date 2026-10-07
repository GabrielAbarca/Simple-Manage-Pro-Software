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
import {
  studentTableHtml,
  emptyStateHtml,
  recordsTableHtml,
} from "./conductTables.js";
import { openAddDiscipline, openEditDiscipline } from "./discipline.js";

let conductState = null;
let latestLoad = 0;

let conductView = "students";

const VIEW_BUTTONS = {
  students: "btn-conduct-students",
  records: "btn-conduct-records",
};

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
    conductState = buildConductState(
      data,
      `${state.currentClass.classId}|${period.id}`,
    );
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

function buildConductState(
  { students, conductRows, records, teachers },
  scope,
) {
  return {
    scope,
    students,
    conductByStudent: new Map(conductRows.map((row) => [row.student_id, row])),
    recordsByStudent: groupRecordsByStudent(records),
    allRecords: records,
    teacherNames: new Map(
      teachers.map((t) => [t.id, `${t.first_name} ${t.last_name}`]),
    ),
    studentNames: new Map(
      students.map((s) => [s.id, `${s.last_name}, ${s.first_name}`]),
    ),
    expanded: conductState?.scope === scope ? conductState.expanded : new Set(),
  };
}

function studentRows() {
  const { students, recordsByStudent, expanded } = conductState;
  return students.map((student) => ({
    student,
    score: scoreOf(student.id),
    records: recordsByStudent.get(student.id) ?? [],
    isExpanded: expanded.has(student.id),
  }));
}

function tableContext() {
  return {
    school: state.school,
    teacherId: state.teacherId,
    teacherNames: conductState.teacherNames,
    studentNames: conductState.studentNames,
  };
}

const VIEW_RENDERERS = {
  students: () => studentTableHtml(studentRows(), tableContext()),
  records: () => recordsTableHtml(conductState.allRecords, tableContext()),
};

function renderConduct() {
  const grid = document.getElementById("conduct-grid");
  if (!grid) return;
  renderSummary();
  if (!conductState.students.length) {
    grid.innerHTML = `<div class="loading-cell">${t("admin.conduct.noStudents")}</div>`;
    return;
  }
  if (!conductState.allRecords.length) {
    grid.innerHTML = emptyStateHtml();
    return;
  }
  grid.innerHTML = VIEW_RENDERERS[conductView]();
}

function setView(view) {
  if (view === conductView) return;
  conductView = view;
  syncViewButtons();
  if (conductState) renderConduct();
}

function syncViewButtons() {
  for (const [view, buttonId] of Object.entries(VIEW_BUTTONS)) {
    const button = document.getElementById(buttonId);
    if (!button) continue;
    const isActive = view === conductView;
    button.classList.toggle("btn-secondary", isActive);
    button.classList.toggle("btn-ghost", !isActive);
    button.setAttribute("aria-pressed", String(isActive));
  }
}

const GRID_ACTIONS = {
  "add-record": (button) => openAddRecordFor(Number(button.dataset.student)),
  "toggle-student": (button) => toggleStudent(Number(button.dataset.student)),
  "edit-record": (button) => openEditRecord(Number(button.dataset.record)),
};

function onGridClick(event) {
  const target = /** @type {Element | null} */ (event.target);
  if (!target) return;
  const button = /** @type {HTMLElement | null} */ (
    target.closest("[data-action]")
  );
  if (!button || !conductState) return;
  GRID_ACTIONS[button.dataset.action]?.(button);
}

function toggleStudent(studentId) {
  const { expanded } = conductState;
  if (expanded.has(studentId)) expanded.delete(studentId);
  else expanded.add(studentId);
  renderConduct();
  document
    .querySelector(
      `[data-action="toggle-student"][data-student="${studentId}"]`,
    )
    ?.focus();
}

function openEditRecord(recordId) {
  const record = conductState.allRecords.find((r) => r.id === recordId);
  if (!record) return;
  const conductRow =
    conductState.conductByStudent.get(record.student_id) ?? null;
  openEditDiscipline(record, conductRow, conductLoad);
}

function openAddRecordFor(studentId) {
  const student = conductState.students.find((s) => s.id === studentId);
  if (!student) return;
  const conductRow = conductState.conductByStudent.get(studentId) ?? null;
  openAddDiscipline(student, conductRow, conductLoad);
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
  document
    .getElementById("conduct-grid")
    .addEventListener("click", onGridClick);
  for (const [view, buttonId] of Object.entries(VIEW_BUTTONS)) {
    document
      .getElementById(buttonId)
      .addEventListener("click", () => setView(view));
  }
  syncViewButtons();
  conductLoad();
}
