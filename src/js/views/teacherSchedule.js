// ─────────────────────────────────────────────────────────────────
//  teacherSchedule.js — the class workspace's Schedule tab (read-only).
//  Timetables are authored in the admin console's Schedules tab, the only
//  surface that checks for double-booked teachers and rooms across
//  sections; here a teacher just reads their week.
// ─────────────────────────────────────────────────────────────────
import { t } from "../i18n.js";
import { skeletonBlock } from "../ui.js";
import { db } from "../teacherData/index.js";
import { state } from "../teacherState.js";
import { renderErrorBlock, escapeHtml } from "../teacherTableHelpers.js";
import { dayName } from "../teacherFormat.js";

export function renderScheduleTab(content) {
  content.innerHTML = `
    <div class="view-toolbar">
      <div class="toolbar-filters">
        <label>${t("admin.schedule.weeklyFor", { class: escapeHtml(state.currentClass.className) })}</label>
      </div>
    </div>
    <div class="recent-activity">
      <div id="schedule-grid">${skeletonBlock(4)}</div>
    </div>`;

  loadSchedule();
}

async function loadSchedule() {
  const container = document.getElementById("schedule-grid");
  try {
    const entries = await db.fetchScheduleByClass(state.currentClass.classId);
    renderScheduleTable(entries);
  } catch (err) {
    console.error(err);
    renderErrorBlock(container, loadSchedule);
  }
}

function renderScheduleTable(entries) {
  const container = document.getElementById("schedule-grid");
  if (!entries.length) {
    container.innerHTML = `<div class="loading-cell">${t("admin.schedule.empty")}</div>`;
    return;
  }

  const table = document.createElement("table");
  table.className = "data-table";
  table.innerHTML = `
    <thead>
      <tr>
        <th>${t("admin.schedule.day")}</th><th>${t("admin.schedule.start")}</th><th>${t("admin.schedule.end")}</th>
        <th>${t("admin.schedule.subject")}</th><th>${t("admin.schedule.teacher")}</th><th>${t("admin.schedule.room")}</th>
      </tr>
    </thead>`;
  const tbody = document.createElement("tbody");

  entries.forEach((entry) => {
    const tr = document.createElement("tr");
    const dot = entry.subjects?.color
      ? `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;
           background:${entry.subjects.color};margin-right:6px;vertical-align:middle;"></span>`
      : "";

    tr.innerHTML = `
      <td>${dayName(entry.day_of_week) || entry.day_of_week}</td>
      <td>${escapeHtml(entry.start_time)}</td>
      <td>${escapeHtml(entry.end_time)}</td>
      <td>${dot}${escapeHtml(entry.subjects?.name ?? "—")}</td>
      <td>${entry.teachers ? escapeHtml(entry.teachers.first_name + " " + entry.teachers.last_name) : "—"}</td>
      <td>${escapeHtml(entry.rooms?.name ?? "—")}</td>`;
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  container.innerHTML = "";
  container.appendChild(table);
}
