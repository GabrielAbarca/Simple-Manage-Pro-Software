// ─────────────────────────────────────────────────────────────────
//  studentDrawer.js — the student-360 read-only detail drawer, opened
//  from the roster. Discipline records are filed and edited from the
//  Conduct tab; the drawer still loads them for the print trigger, which
//  passes the loaded data into progressReport.js so that module never
//  imports this one back.
// ─────────────────────────────────────────────────────────────────
import { registerDialog } from "../dialog.js";
import { t, tn } from "../i18n.js";
import { skeletonBlock } from "../ui.js";
import { db } from "../teacherData/index.js";
import { state } from "../teacherState.js";
import {
  gradeBandClass,
  conductCellHtml,
  formatDate,
  genderLabel,
  getCurrentPeriodId,
} from "../teacherFormat.js";
import { isConductPassing } from "../promotion.js";
import { escapeHtml } from "../teacherTableHelpers.js";
import { printStudentReport } from "./progressReport.js";

// ── Student drawer ─────────────────────────────────────────────
const drawerOverlay = document.getElementById("drawer-overlay");
const drawerTitle = document.getElementById("drawer-title");
const drawerBody = document.getElementById("drawer-body");

function openDrawer() {
  drawerOverlay.classList.add("active");
}
function closeDrawer() {
  drawerOverlay.classList.remove("active");
}
document.getElementById("drawer-close").addEventListener("click", closeDrawer);
// The only dialog that still closes on a backdrop click: this drawer is a
// read-only detail view with nothing to lose, and dismissing a drawer that
// way is what users expect. Every dialog holding input requires an explicit
// close instead.
drawerOverlay.addEventListener("click", (e) => {
  if (e.target === drawerOverlay) closeDrawer();
});

let _drawerStudent = null;
let _drawerData = {};

export async function openStudentDrawer(student) {
  _drawerStudent = student;
  drawerTitle.textContent = `${student.first_name} ${student.last_name}`;
  drawerBody.innerHTML = skeletonBlock();
  openDrawer();

  const periodId = getCurrentPeriodId();
  const periodName = state.periods.find((p) => p.id === periodId)?.name ?? "";

  // Each section degrades independently — one failure shouldn't blank the rest.
  const [
    contacts,
    attendance,
    discipline,
    subjectGrades,
    conduct,
    postedConduct,
  ] = await Promise.all([
    db.fetchStudentContacts(student.id).catch(() => []),
    db.fetchStudentAttendance(student.id).catch(() => []),
    db.fetchStudentDiscipline(student.id).catch(() => []),
    db.fetchStudentSubjectGrades(student.id, periodId).catch(() => []),
    db.fetchStudentConduct(student.id).catch(() => []),
    db.fetchStudentPostedConduct(student.id).catch(() => []),
  ]);
  // The period the drawer is showing, so the conducta section agrees with
  // the grades above it.
  const conductRow =
    conduct.find((r) => r.grading_period_id === periodId) ?? null;
  const postedRow =
    postedConduct.find((r) => r.grading_period_id === periodId) ?? null;
  _drawerData = {
    contacts,
    attendance,
    discipline,
    subjectGrades,
    conduct: conductRow,
    postedConduct: postedRow,
  };

  const photo = student.photo_url
    ? `<img class="drawer-photo" src="${escapeHtml(student.photo_url)}" alt="" referrerpolicy="no-referrer" />`
    : `<div class="drawer-photo drawer-photo-empty"><span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-person"></use></svg></span></div>`;

  drawerBody.innerHTML = `
    <div class="drawer-section drawer-identity">
      ${photo}
      <ul class="drawer-contact">
        <li><span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-badge"></use></svg></span> ${escapeHtml(student.enrollment_number ?? "—")}</li>
        <li><span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-fingerprint"></use></svg></span> ${escapeHtml(student.national_id ?? "—")}</li>
        <li><span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-cake"></use></svg></span> ${escapeHtml(formatDate(student.date_of_birth))}</li>
        <li><span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-wc"></use></svg></span> ${escapeHtml(genderLabel(student.gender))}</li>
        <li><span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-mail"></use></svg></span> ${escapeHtml(student.email ?? "—")}</li>
        <li><span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-call"></use></svg></span> ${escapeHtml(student.phone ?? "—")}</li>
        <li><span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-home"></use></svg></span> ${escapeHtml(student.address ?? "—")}</li>
        <li><span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-info"></use></svg></span> ${escapeHtml(student.status ?? "—")}</li>
      </ul>
    </div>
    <div class="drawer-section">
      <h3>${t("admin.drawer.attendance")}</h3>
      ${renderDrawerAttendance(attendance)}
    </div>
    <div class="drawer-section">
      <h3>${periodName ? t("admin.drawer.gradesWithPeriod", { period: escapeHtml(periodName) }) : t("admin.drawer.grades")}</h3>
      ${renderDrawerSubjectGrades(subjectGrades)}
    </div>
    <div class="drawer-section">
      <h3>${periodName ? t("admin.drawer.conductWithPeriod", { period: escapeHtml(periodName) }) : t("admin.drawer.conduct")}</h3>
      ${renderDrawerConduct(conductRow, postedRow)}
    </div>
    <div class="drawer-section">
      <h3>${t("admin.drawer.guardians")}</h3>
      ${renderDrawerGuardians(contacts)}
    </div>`;
}

function renderDrawerGuardians(contacts) {
  if (!contacts.length)
    return `<p class="drawer-muted">${t("admin.drawer.noGuardians")}</p>`;
  return contacts
    .map((c) => {
      const g = c.guardians ?? {};
      const primary = c.is_primary
        ? `<span class="badge badge-primary">${t("admin.drawer.primary")}</span>`
        : "";
      return `
      <div class="drawer-card">
        <div class="drawer-card-head">
          <b>${escapeHtml(g.first_name ?? "")} ${escapeHtml(g.last_name ?? "")}</b>
          <span class="drawer-rel">${escapeHtml(g.relationship ?? t("admin.drawer.guardianRel"))}</span>
          ${primary}
        </div>
        <ul class="drawer-contact">
          ${g.phone ? `<li><span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-call"></use></svg></span> ${escapeHtml(g.phone)}</li>` : ""}
          ${g.alt_phone ? `<li><span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-call"></use></svg></span> ${escapeHtml(g.alt_phone)} (${t("admin.drawer.alt")})</li>` : ""}
          ${g.email ? `<li><span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-mail"></use></svg></span> ${escapeHtml(g.email)}</li>` : ""}
        </ul>
      </div>`;
    })
    .join("");
}

function renderDrawerAttendance(rows) {
  if (!rows.length)
    return `<p class="drawer-muted">${t("admin.drawer.noAttendance")}</p>`;
  const counts = { present: 0, absent: 0, late: 0, excused: 0 };
  rows.forEach((r) => {
    if (counts[r.status] != null) counts[r.status] += 1;
  });
  const rate = Math.round(((counts.present + counts.late) / rows.length) * 100);
  return `
    <div class="drawer-attendance">
      <span class="att-chip att-present">${counts.present} ${t("enums.attendanceWord.present")}</span>
      <span class="att-chip att-absent">${counts.absent} ${t("enums.attendanceWord.absent")}</span>
      <span class="att-chip att-late">${counts.late} ${t("enums.attendanceWord.late")}</span>
      <span class="att-chip att-excused">${counts.excused} ${t("enums.attendanceWord.excused")}</span>
    </div>
    <p class="drawer-muted">${tn("admin.drawer.attendanceRate", rows.length, { rate, count: rows.length })}</p>`;
}

function renderDrawerSubjectGrades(rows) {
  if (!rows.length)
    return `<p class="drawer-muted">${t("admin.drawer.noGrades")}</p>`;
  return `<ul class="drawer-grades">${rows
    .map((r) => {
      const subject = r.class_subject_teachers?.subjects?.name ?? "—";
      const score = r.score;
      const cell =
        score == null
          ? '<span class="text-muted">—</span>'
          : `<b class="${gradeBandClass(score)}">${Number(score).toFixed(1)}</b>`;
      return `<li><span>${escapeHtml(subject)}</span>${cell}</li>`;
    })
    .sort()
    .join("")}</ul>`;
}

/**
 * The period's conducta: the live mark, what is posted if anything, and the
 * aplazado verdict. Deliberately banded against the conduct floor, not the
 * subject pass mark — a school may set the two apart.
 */
function renderDrawerConduct(live, posted) {
  if (!live)
    return `<p class="drawer-muted">${t("admin.drawer.noConduct")}</p>`;
  const score = live.conduct_score;
  const failing = !isConductPassing(score, state.school);
  const verdict = failing
    ? `<span class="badge badge-danger">${t("admin.drawer.conductFailed")}</span>`
    : "";
  const postedChip =
    posted && posted.score != null
      ? `<span class="badge badge-success">${t("admin.drawer.conductPosted", { score: String(Number(posted.score)) })}</span>`
      : `<span class="badge badge-warning">${t("admin.drawer.conductUnposted")}</span>`;
  return `
    <div class="drawer-attendance">
      ${conductCellHtml(score)}
      ${postedChip}
      ${verdict}
    </div>
    <p class="drawer-muted">${tn("admin.drawer.conductIncidents", live.incident_count, { count: live.incident_count, points: Number(live.deduction ?? 0) })}</p>`;
}

// Print progress report from the open student drawer (item 6).
document.getElementById("drawer-print").addEventListener("click", () => {
  if (!_drawerStudent) return;
  printStudentReport(
    _drawerStudent,
    _drawerData.attendance ?? [],
    _drawerData.discipline ?? [],
  );
});

registerDialog(drawerOverlay, { close: closeDrawer });
