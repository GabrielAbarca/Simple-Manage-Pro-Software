// ─────────────────────────────────────────────────────────────────
//  classWorkspace.js — the class workspace shell: opens a class into its
//  own view and dispatches its sub-tabs (roster/gradebook/attendance/
//  schedule) to their respective renderers.
// ─────────────────────────────────────────────────────────────────
import { state } from "../teacherState.js";
import { showSection } from "../teacherNav.js";
import { className } from "../teacherFormat.js";
import { renderRosterTab } from "./roster.js";
import { renderGradebookTab } from "./gradebook.js";
import { renderAttendanceTab } from "./teacherAttendance.js";
import { renderScheduleTab } from "./teacherSchedule.js";

export function openClassWorkspace(cst, initialTab = "roster") {
  state.currentClass = {
    cstId: cst.id,
    classId: cst.class_id,
    subjectId: cst.subject_id,
    className: className(cst.classes),
    subjectName: cst.subjects?.name ?? "—",
    color: cst.subjects?.color || "var(--color-primary)",
    gradeLevel: cst.classes?.grade_levels?.name ?? "",
  };

  document.getElementById("class-ws-title").textContent =
    `${state.currentClass.subjectName} · ${state.currentClass.className}`;
  // The title now spells the grade out ("10th Grade — Section A"), so the
  // subtitle drops the grade it used to repeat and carries the year alone.
  document.getElementById("class-ws-subtitle").textContent =
    state.activeYear.name;
  document.getElementById("class-ws-dot").style.background =
    state.currentClass.color;

  showSection("class");
  openClassTab(initialTab);
}

export function openClassTab(tab) {
  document
    .querySelectorAll(".class-subtab")
    .forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));

  const content = document.getElementById("class-tab-content");
  const renderers = {
    roster: renderRosterTab,
    gradebook: renderGradebookTab,
    attendance: renderAttendanceTab,
    schedule: renderScheduleTab,
  };
  (renderers[tab] ?? renderRosterTab)(content);
}
