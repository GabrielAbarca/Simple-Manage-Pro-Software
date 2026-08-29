import { t } from "../i18n.js";
import { fetchStudentProfile, fetchStudentGrades } from "../supabaseQueries.js";
import { skeletonRows } from "../ui.js";
import { state, getGradingPeriods } from "../studentState.js";
import { scoreHtml } from "./viewHelpers.js";

export async function initGrades() {
  if (!state.schoolYearId) {
    const profile = await fetchStudentProfile(state.studentId);
    state.schoolYearId = profile?.classes?.school_years?.id;
  }

  const periods = await getGradingPeriods();
  const select = document.getElementById("period-select");
  periods.forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.name;
    select.appendChild(opt);
  });

  await loadGradesTable();

  select.addEventListener("change", () => loadGradesTable());
}

async function loadGradesTable() {
  const select = document.getElementById("period-select");
  const periodId = select.value === "all" ? null : Number(select.value);

  const tbody = document.getElementById("grades-body");
  const tfoot = document.getElementById("grades-footer");
  tbody.innerHTML = skeletonRows(4, 6);
  tfoot.innerHTML = "";

  const grades = await fetchStudentGrades(state.studentId, periodId);

  if (!grades || grades.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="loading-cell">${t("student.grades.empty")}</td></tr>`;
    tfoot.innerHTML = "";
    return;
  }

  tbody.innerHTML = grades
    .map((g) => {
      const subj = g.class_subject_teachers?.subjects;
      const teacher = g.class_subject_teachers?.teachers;
      const score = Number(g.score);
      const pass = score >= 50;

      return `<tr>
      <td style="text-align:left;">
        <span class="subject-dot" style="background:${subj?.color ?? "#7380ec"}"></span>${subj?.name ?? "—"}
      </td>
      <td>${subj?.code ?? "—"}</td>
      <td>${teacher ? `${teacher.first_name} ${teacher.last_name}` : "—"}</td>
      <td>${scoreHtml(score)}</td>
      <td><span class="status-badge ${pass ? "status-pass" : "status-fail"}">${pass ? t("enums.pass.pass") : t("enums.pass.fail")}</span></td>
      <td>${g.grading_periods?.name ?? "—"}</td>
    </tr>`;
    })
    .join("");

  const scores = grades
    .filter((g) => g.score !== null)
    .map((g) => Number(g.score));
  const avg =
    scores.length > 0
      ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) /
        10
      : "—";
  tfoot.innerHTML = `<tr>
    <td colspan="3" style="text-align:right; font-weight:700;">${t("student.grades.periodAverage")}</td>
    <td>${typeof avg === "number" ? scoreHtml(avg) : avg}</td>
    <td colspan="2"></td>
  </tr>`;
}
