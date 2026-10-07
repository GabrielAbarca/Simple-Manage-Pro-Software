import { t, formatDate } from "../i18n.js";
import { fetchStudentProfile, fetchOwnConduct } from "../supabaseQueries.js";
import { state, getGradingPeriods } from "../studentState.js";
import {
  conductBandClass,
  conductPassingScore,
  isConductPassing,
} from "../promotion.js";
import { toIso } from "../controls/dateUtils.js";
import { escapeHtml } from "./viewHelpers.js";

export async function initConductView() {
  const root = document.getElementById("conduct-root");
  if (!state.schoolYearId) {
    const profile = await fetchStudentProfile(state.studentId);
    state.schoolYearId = profile?.classes?.school_years?.id ?? null;
  }
  if (!state.schoolYearId) {
    root.innerHTML = `<p>${t("student.conduct.noPeriods")}</p>`;
    return;
  }
  const [periods, conduct] = /** @type {[any[], any]} */ (
    await Promise.all([getGradingPeriods(), fetchOwnConduct(state.studentId)])
  );
  if (!periods.length) {
    root.innerHTML = `<p>${t("student.conduct.noPeriods")}</p>`;
    return;
  }

  const periodOf = (date) =>
    periods.find((p) => date >= p.start_date && date <= p.end_date) ?? null;
  const yearStart = periods.reduce(
    (min, p) => (p.start_date < min ? p.start_date : min),
    periods[0].start_date,
  );
  const yearEnd = periods.reduce(
    (max, p) => (p.end_date > max ? p.end_date : max),
    periods[0].end_date,
  );
  const records = conduct.records.filter(
    (r) => r.date >= yearStart && r.date <= yearEnd,
  );

  root.innerHTML = `
    <p>${t("student.conduct.intro")}</p>
    <div class="recent-activity">
      <table id="conduct-periods-table">
        <thead>
          <tr>
            <th>${t("student.conduct.period")}</th>
            <th>${t("student.conduct.score")}</th>
            <th>${t("student.conduct.status")}</th>
            <th>${t("student.conduct.records")}</th>
          </tr>
        </thead>
        <tbody>${periodRows(periods, conduct, records, periodOf)}</tbody>
      </table>
    </div>
    <div class="recent-activity">
      <h2>${t("student.conduct.history")}</h2>
      <table id="conduct-records-table">
        <thead>
          <tr>
            <th>${t("student.conduct.date")}</th>
            <th>${t("student.conduct.period")}</th>
            <th>${t("student.conduct.type")}</th>
            <th>${t("student.conduct.description")}</th>
            <th>${t("student.conduct.points")}</th>
          </tr>
        </thead>
        <tbody>${recordRows(records, periodOf)}</tbody>
      </table>
    </div>`;
}

function periodRows(periods, { live, posted }, records, periodOf) {
  const today = toIso(new Date());
  const liveBy = new Map(live.map((r) => [r.grading_period_id, r]));
  const postedBy = new Map(
    posted.filter((r) => r.score != null).map((r) => [r.grading_period_id, r]),
  );
  return periods
    .map((p) => {
      const official = postedBy.get(p.id);
      const started = p.start_date <= today;
      const score = official
        ? official.score
        : started
          ? (liveBy.get(p.id)?.conduct_score ?? null)
          : null;
      const count = records.filter((r) => periodOf(r.date)?.id === p.id).length;
      return `<tr>
        <td>${escapeHtml(p.name)}</td>
        <td>${scoreCell(score, Boolean(official))}</td>
        <td>${statusCell(score, Boolean(official))}</td>
        <td>${count}</td>
      </tr>`;
    })
    .join("");
}

function scoreCell(score, official) {
  if (score == null) return "—";
  const source = t(
    official ? "student.conduct.posted" : "student.conduct.provisional",
  );
  return `<span class="${conductBandClass(score, state.school)}">${Number(score)}</span> <small>${source}</small>`;
}

// Only a posted mark carries a verdict. A provisional one below the floor is
// flagged as a warning, since a teacher can still correct the record behind it.
function statusCell(score, official) {
  if (score == null) return "—";
  const passing = isConductPassing(score, state.school);
  if (official) {
    return passing
      ? `<span class="status-badge status-pass">${t("enums.pass.pass")}</span>`
      : `<span class="status-badge status-fail">${t("student.conduct.failed")}</span>`;
  }
  if (passing) return "—";
  const mark = conductPassingScore(state.school);
  return `<span class="status-badge status-late">${t("student.conduct.below", { mark })}</span>`;
}

function recordRows(records, periodOf) {
  if (!records.length) {
    return `<tr><td colspan="5" class="loading-cell">${t("student.conduct.noRecords")}</td></tr>`;
  }
  return records
    .map((r) => {
      const points = Number(r.conduct_points) || 0;
      return `<tr>
        <td>${formatDate(r.date)}</td>
        <td>${escapeHtml(periodOf(r.date)?.name ?? "—")}</td>
        <td>${escapeHtml(r.type)}</td>
        <td>${escapeHtml(r.description || "—")}</td>
        <td>${points ? `−${points}` : "0"}</td>
      </tr>`;
    })
    .join("");
}
