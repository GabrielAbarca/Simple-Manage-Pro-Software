import { t, formatDate } from "../i18n.js";
import {
  fetchStudentProfile,
  fetchDashboardStats,
} from "../supabaseQueries.js";
import { state, getEvents, getGradingPeriods } from "../studentState.js";
import { scoreHtml, statusLabel } from "./viewHelpers.js";

export async function initDashboard() {
  // Warm the events request now so it overlaps the profile + stats fetches
  // below; renderUpcomingEvents() awaits this same in-flight promise.
  getEvents();

  state.profile = await fetchStudentProfile(state.studentId);
  if (!state.profile) {
    document.getElementById("student-name").textContent = t(
      "student.errorLoadingProfile",
    );
    return;
  }

  const cls = state.profile.classes;
  state.schoolYearId = cls?.school_years?.id;
  state.classId = cls?.id;

  // Needed before the Grade Overview table renders — its columns are one per
  // period. Warmed here, after schoolYearId is known and before the stats await.
  state.periods = await getGradingPeriods();

  document.getElementById("student-name").textContent =
    `${state.profile.first_name} ${state.profile.last_name}`;
  document.getElementById("student-class").textContent = t(
    "student.classLine",
    {
      grade: cls?.grade_levels?.name ?? "—",
      section: cls?.display_name ?? "—",
    },
  );
  document.getElementById("student-year").textContent =
    cls?.school_years?.name ?? "—";
  document.getElementById("student-status").textContent = statusLabel(
    state.profile.status,
  );

  document.getElementById("welcome-name").textContent =
    state.profile.first_name;

  const stats = await fetchDashboardStats(state.studentId, state.classId);

  document.getElementById("attendance-fraction").textContent =
    `${stats.attendance.present}/${stats.attendance.total}`;
  document.getElementById("attendance-pct").textContent =
    `${stats.attendance.percentage}%`;
  setCircleProgress("circle-attendance", stats.attendance.percentage);

  document.getElementById("grade-avg").textContent = stats.grades.average;
  document.getElementById("grade-pct").textContent =
    `${Math.round(stats.grades.average)}%`;
  setCircleProgress("circle-grade", stats.grades.average);

  if (stats.nextClass) {
    document.getElementById("next-class-subject").textContent =
      stats.nextClass.subjects?.name ?? "—";
    document.getElementById("next-class-day").textContent = dayNameFull(
      stats.nextClass.day_of_week,
    );
  } else {
    document.getElementById("next-class-subject").textContent =
      t("student.next.none");
    document.getElementById("next-class-day").textContent = t(
      "student.next.enjoyBreak",
    );
  }

  renderDashboardGradeTable(stats.allGrades);

  await renderUpcomingEvents();

  renderSubjectAnalytics(stats.allGrades);
}

// Subject × period header for the Grade Overview: the year's periods by their
// own names, then Average. Called before the body so an empty-state colspan
// still matches the column count.
function renderDashboardGradeHead() {
  const head = document.getElementById("dashboard-grade-head");
  if (!head) return;
  // Built as nodes rather than innerHTML: period names come from the database,
  // and textContent escapes them without this module needing an escapeHtml of
  // its own (the helper is private to admin.js/teacher.js).
  head.replaceChildren(
    ...[
      t("student.dash.subject"),
      ...state.periods.map((p) => p.name),
      t("student.dash.average"),
    ].map((label) => {
      const th = document.createElement("th");
      th.textContent = label;
      return th;
    }),
  );
}

function renderDashboardGradeTable(grades) {
  const tbody = document.getElementById("dashboard-grades-body");

  renderDashboardGradeHead();
  const cols = state.periods.length + 2;

  if (!grades || grades.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${cols}" class="loading-cell">${t("student.grades.dashEmpty")}</td></tr>`;
    return;
  }

  const bySubject = {};
  grades.forEach((g) => {
    const subj = g.class_subject_teachers?.subjects;
    const key = subj?.id ?? "unknown";
    if (!bySubject[key]) {
      bySubject[key] = {
        name: subj?.name ?? "—",
        code: subj?.code ?? "",
        color: subj?.color ?? "#7380ec",
        periods: {},
      };
    }
    const periodOrder = g.grading_periods?.period_order;
    if (periodOrder) {
      bySubject[key].periods[periodOrder] = Number(g.score);
    }
  });

  tbody.innerHTML = Object.values(bySubject)
    .map((subj) => {
      const scores = state.periods
        .map((p) => subj.periods[p.period_order])
        .filter((s) => s !== undefined);
      const avg =
        scores.length > 0
          ? Math.round(
              (scores.reduce((a, b) => a + b, 0) / scores.length) * 10,
            ) / 10
          : null;

      return `<tr>
      <td style="text-align:left;">
        <span class="subject-dot" style="background:${subj.color}"></span>${subj.name}
      </td>
      ${state.periods
        .map((p) => {
          const score = subj.periods[p.period_order];
          return `<td>${score !== undefined ? scoreHtml(score) : "—"}</td>`;
        })
        .join("")}
      <td>${avg !== null ? scoreHtml(avg) : "—"}</td>
    </tr>`;
    })
    .join("");
}

async function renderUpcomingEvents() {
  const events = await getEvents();
  const card = document.getElementById("upcoming-events-card");

  const upcoming = events.slice(0, 4);

  if (upcoming.length === 0) {
    card.innerHTML = `<div class="update">
      <div class="profile-photo"><span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-event_busy"></use></svg></span></div>
      <div class="message"><p>${t("student.panel.noUpcomingEvents")}</p></div>
    </div>`;
    return;
  }

  card.innerHTML = upcoming
    .map(
      (ev) => `
    <div class="update">
      <div class="profile-photo">
        <span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-event"></use></svg></span>
      </div>
      <div class="message">
        <p><b>${ev.title}</b></p>
        <small class="text-muted">${formatDate(ev.start_date)}${ev.end_date ? " → " + formatDate(ev.end_date) : ""}</small>
      </div>
    </div>
  `,
    )
    .join("");
}

function renderSubjectAnalytics(grades) {
  const container = document.getElementById("subject-analytics-list");

  if (!grades || grades.length === 0) {
    container.innerHTML = `<p class="text-muted" style="padding:1rem;">${t("student.panel.noData")}</p>`;
    return;
  }

  const bySubject = {};
  grades.forEach((g) => {
    const subj = g.class_subject_teachers?.subjects;
    const key = subj?.id ?? "unknown";
    if (!bySubject[key]) {
      bySubject[key] = {
        name: subj?.name ?? "—",
        color: subj?.color ?? "#7380ec",
        scores: [],
      };
    }
    if (g.score !== null) bySubject[key].scores.push(Number(g.score));
  });

  const subjectIcons = {
    Matemáticas: "calculate",
    Español: "menu_book",
    Historia: "history_edu",
    "Ciencias Naturales": "biotech",
    Inglés: "translate",
    Física: "science",
    "Educación Física": "fitness_center",
    Arte: "palette",
    Geografía: "public",
    Química: "science",
  };

  container.innerHTML = Object.values(bySubject)
    .map((subj) => {
      const avg =
        subj.scores.length > 0
          ? Math.round(
              (subj.scores.reduce((a, b) => a + b, 0) / subj.scores.length) *
                10,
            ) / 10
          : 0;
      const icon = subjectIcons[subj.name] ?? "book";
      const fillColor =
        avg >= 70
          ? "var(--color-success)"
          : avg >= 50
            ? "var(--color-warning)"
            : "var(--color-danger)";

      return `<div class="item">
      <div class="icon" style="background:${subj.color}">
        <span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-${icon}"></use></svg></span>
      </div>
      <div class="right-content">
        <div class="info">
          <h3>${subj.name}</h3>
          <div class="grade-bar">
            <div class="grade-fill" style="width:${avg}%; background:${fillColor}"></div>
          </div>
        </div>
        <span class="score-display ${avg >= 70 ? "score-high" : avg >= 50 ? "score-mid" : "score-low"}">${avg}</span>
      </div>
    </div>`;
    })
    .join("");
}

function setCircleProgress(circleId, pct) {
  const circle = document.getElementById(circleId);
  if (!circle) return;
  const circumference = 2 * Math.PI * 37;
  const offset = circumference - (pct / 100) * circumference;
  circle.style.strokeDasharray = `${circumference}`;
  circle.style.strokeDashoffset = `${offset}`;
}

// Full weekday name (1=Mon … 5=Fri) for the "next class" card.
function dayNameFull(dow) {
  const keys = ["", "monday", "tuesday", "wednesday", "thursday", "friday"];
  return keys[dow] ? t(`common.days.${keys[dow]}`) : "";
}
