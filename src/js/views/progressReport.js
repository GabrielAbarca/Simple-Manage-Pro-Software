// ─────────────────────────────────────────────────────────────────
//  progressReport.js — printable per-student progress report (item 6),
//  triggered from the student drawer's print button. Takes the student and
//  the already-loaded attendance/discipline rows as parameters instead of
//  reading the drawer's private state.
// ─────────────────────────────────────────────────────────────────
import { t, tn, formatDate as i18nFormatDate } from "../i18n.js";
import { db } from "../teacherData/index.js";
import { state } from "../teacherState.js";
import { formatDate, genderLabel } from "../teacherFormat.js";
import { escapeHtml } from "../teacherTableHelpers.js";
import { showToast } from "../teacherFeedback.js";

/**
 * @param {any} student
 * @param {any[]} attendance
 * @param {any[]} discipline
 */
export async function printStudentReport(student, attendance, discipline) {
  let grades = [];
  try {
    grades = await db.fetchStudentAllSubjectGrades(student.id);
  } catch {
    /* degrade — report prints without the grade table */
  }

  const win = window.open("", "_blank");
  if (!win) {
    showToast(t("admin.toast.popupBlocked"), "error");
    return;
  }
  win.document.write(buildReportHtml(student, grades, attendance, discipline));
  win.document.close();
  win.focus();
  win.print();
}

function buildReportHtml(student, grades, attendance, discipline) {
  const esc = escapeHtml;
  const periods = state.periods
    .slice()
    .sort((a, b) => a.period_order - b.period_order);

  // Pivot posted grades into subject × period.
  const bySubject = {};
  grades.forEach((g) => {
    const subj = g.class_subject_teachers?.subjects?.name ?? "—";
    (bySubject[subj] ??= {})[g.grading_period_id] = g.score;
  });
  const periodHeads = periods.map((p) => `<th>${esc(p.name)}</th>`).join("");
  const gradeRows =
    Object.keys(bySubject).sort().length === 0
      ? `<tr><td colspan="${periods.length + 1}">${t("admin.report.noGrades")}</td></tr>`
      : Object.keys(bySubject)
          .sort()
          .map((subj) => {
            const cells = periods
              .map((p) => {
                const s = bySubject[subj][p.id];
                return `<td>${s == null ? "—" : Number(s).toFixed(1)}</td>`;
              })
              .join("");
            return `<tr><td class="subj">${esc(subj)}</td>${cells}</tr>`;
          })
          .join("");

  // Attendance summary.
  const ac = { present: 0, absent: 0, late: 0, excused: 0 };
  attendance.forEach((r) => {
    if (ac[r.status] != null) ac[r.status] += 1;
  });
  const totalDays = attendance.length;
  const rate = totalDays
    ? Math.round(((ac.present + ac.late) / totalDays) * 100)
    : null;

  const discRows = discipline.length
    ? discipline
        .map(
          (d) =>
            `<tr><td>${esc(formatDate(d.date))}</td><td>${esc(d.type ?? "")}</td><td>${esc(
              d.severity ? t(`enums.disciplineSeverity.${d.severity}`) : "",
            )}</td><td>${d.resolved ? t("enums.disciplineState.resolved") : t("enums.disciplineState.open")}</td><td>${esc(
              d.description ?? "",
            )}</td></tr>`,
        )
        .join("")
    : `<tr><td colspan="5">${t("admin.report.noDiscipline")}</td></tr>`;

  const teacherName =
    document.getElementById("teacher-name")?.textContent ?? "";
  const printed = i18nFormatDate(new Date(), {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const fullName = `${student.first_name} ${student.last_name}`;
  return `<!doctype html>
<html lang="${document.documentElement.lang || "en"}"><head><meta charset="utf-8" />
<title>${esc(t("admin.report.title", { name: fullName }))}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; color: #1a1a1a; margin: 2.2rem; }
  h1 { font-size: 1.4rem; margin: 0; }
  h2 { font-size: 0.95rem; text-transform: uppercase; letter-spacing: .04em; color: #555; border-bottom: 1px solid #ddd; padding-bottom: .3rem; margin: 1.6rem 0 .7rem; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #333; padding-bottom: .8rem; }
  .muted { color: #666; font-size: .85rem; }
  .ident { display: grid; grid-template-columns: 1fr 1fr; gap: .2rem .8rem; font-size: .9rem; margin-top: .4rem; }
  table { width: 100%; border-collapse: collapse; font-size: .85rem; }
  th, td { border: 1px solid #ddd; padding: .45rem .6rem; text-align: center; }
  th { background: #f4f4f4; }
  td.subj, th:first-child { text-align: left; }
  .att span { display: inline-block; margin-right: 1rem; font-size: .9rem; }
  footer { margin-top: 2rem; font-size: .8rem; color: #888; display: flex; justify-content: space-between; }
  @media print { body { margin: 1rem; } }
</style></head>
<body>
  <div class="head">
    <div>
      <h1>${esc(fullName)}</h1>
      <div class="muted">${esc(
        state.activeYear?.name
          ? t("admin.report.headerWithYear", { year: state.activeYear.name })
          : t("admin.report.header"),
      )}</div>
    </div>
    <div class="muted">${esc(t("admin.report.printed", { date: printed }))}</div>
  </div>

  <div class="ident">
    <div><b>${t("admin.report.enrollment")}</b> ${esc(student.enrollment_number ?? "—")}</div>
    <div><b>${t("admin.report.nationalId")}</b> ${esc(student.national_id ?? "—")}</div>
    <div><b>${t("admin.report.dob")}</b> ${esc(formatDate(student.date_of_birth))}</div>
    <div><b>${t("admin.report.gender")}</b> ${esc(genderLabel(student.gender))}</div>
    <div><b>${t("admin.report.status")}</b> ${esc(student.status ? t(`enums.studentStatus.${student.status}`) : "—")}</div>
    <div><b>${t("admin.report.email")}</b> ${esc(student.email ?? "—")}</div>
  </div>

  <h2>${t("admin.report.gradesBySubject")}</h2>
  <table><thead><tr><th>${t("admin.report.subject")}</th>${periodHeads}</tr></thead><tbody>${gradeRows}</tbody></table>

  <h2>${t("admin.report.attendance")}</h2>
  <div class="att">
    <span><b>${ac.present}</b> ${t("enums.attendanceWord.present")}</span>
    <span><b>${ac.absent}</b> ${t("enums.attendanceWord.absent")}</span>
    <span><b>${ac.late}</b> ${t("enums.attendanceWord.late")}</span>
    <span><b>${ac.excused}</b> ${t("enums.attendanceWord.excused")}</span>
    ${rate != null ? `<span><b>${rate}%</b> ${tn("admin.report.attendanceRate", totalDays, { count: totalDays })}</span>` : ""}
  </div>

  <h2>${t("admin.report.discipline")}</h2>
  <table><thead><tr><th>${t("admin.report.date")}</th><th>${t("admin.report.type")}</th><th>${t("admin.report.severity")}</th><th>${t("admin.report.statusCol")}</th><th>${t("admin.report.description")}</th></tr></thead><tbody>${discRows}</tbody></table>

  <footer>
    <span>${t("admin.report.teacher")} ${esc(teacherName)}</span>
    <span>${t("admin.report.signature")}</span>
  </footer>
</body></html>`;
}
