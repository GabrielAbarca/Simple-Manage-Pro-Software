import "./errorHandler.js";
import "./speedInsights.js";
import { getSession, signOut } from "./auth.js";
import {
  fetchRole,
  fetchStudentId,
  portalPath,
  haltForRedirect,
} from "./role.js";
import { supabase } from "./supabaseClient.js";
import { DEMO_MODE } from "./demoMode.js";
import { initTheme, bindThemeToggle } from "./theme.js";
import { skeletonRows, initSidebarToggle, errorState, errorRow } from "./ui.js";
import { renderSettings } from "./settings.js";
import {
  initI18n,
  applyTranslations,
  t,
  formatDate,
  formatTime,
} from "./i18n.js";
import {
  fetchStudentProfile,
  fetchGradingPeriods,
  fetchStudentGrades,
  fetchStudentAttendance,
  fetchClassSchedule,
  fetchTeachers,
  fetchEvents,
  fetchDashboardStats,
} from "./supabaseQueries.js";
import { DEFAULT_ACTIVE_DAYS, dayKeyShort } from "./scheduleLogic.js";

const session = await getSession();
if (!session) haltForRedirect("/login.html", "Unauthenticated");
const user = session?.user;

if (!user) haltForRedirect("/login.html", "Unauthenticated");

const linkedStudentId = await fetchStudentId(user.id);

let STUDENT_ID;

if (linkedStudentId) {
  STUDENT_ID = linkedStudentId;
} else {
  // Not a student — an admin or teacher landing here belongs in their own
  // portal, not signed out (role routing). Only a role-less account with no
  // student row is a data error and falls through to sign-out.
  const role = await fetchRole();
  if (role === "admin" || role === "teacher") {
    haltForRedirect(portalPath(role), "Redirecting to role portal");
  }
  if (import.meta.env.DEV) {
    console.warn(
      "[SMP] No student found for auth user id",
      user.id,
      "— falling back to STUDENT_ID=1 (dev only).",
    );
    STUDENT_ID = 1;
  } else {
    console.error("[SMP] No student profile linked to this account.");
    await signOut();
    haltForRedirect("/login.html", "No student profile linked");
  }
}

supabase.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_OUT") {
    window.location.replace("/login.html");
  }
});

window.addEventListener("pageshow", (event) => {
  if (event.persisted) {
    window.location.reload();
  }
});

const closeNav = initSidebarToggle();
const themeToggler = document.querySelector(".theme-toggler");

const profilePhotoDiv = document.querySelector(".profile-photo");

profilePhotoDiv.addEventListener("click", () => {
  navigateTo("settings");
  // Snap to Account & Profile. On first open the panel isn't rendered yet
  // (initSettings is async) — but renderSettings already defaults to the
  // account sub-tab, so this only matters when re-opening after switching tabs.
  document
    .querySelector('#settings-root .settings-rail-item[data-section="account"]')
    ?.click();
});

initTheme();
bindThemeToggle(themeToggler);

// Resolve this view's language (stored "smp-lang-student" → browser → English)
// and translate the static markup before any view renders.
initI18n("student");
applyTranslations();

// Mark the frontend sandbox so students see the same "DEMO" tag as the admin
// console (reuses the admin.demo.* strings; the badge is purely informational).
if (DEMO_MODE) {
  const logo = document.querySelector("aside .logo");
  if (logo) {
    const badge = document.createElement("span");
    badge.className = "demo-badge";
    badge.dataset.i18n = "admin.demo.badge";
    badge.dataset.i18nTitle = "admin.demo.sandboxNotice";
    badge.textContent = t("admin.demo.badge");
    badge.title = t("admin.demo.sandboxNotice");
    logo.appendChild(badge);
  }
}

const sidebarLinks = document.querySelectorAll("aside .sidebar a[data-page]");
const viewSections = document.querySelectorAll(".view-section");
const rightPanel = document.querySelector(".right");
const viewCache = {};

function navigateTo(page) {
  sidebarLinks.forEach((link) => {
    link.classList.toggle("active", link.dataset.page === page);
  });

  viewSections.forEach((section) => {
    section.classList.toggle("active", section.id === `view-${page}`);
  });

  // The "Upcoming Events" / "Subject Performance" widgets live in `.right`
  // (a sibling of <main>, outside the view-section toggle). Hide them on every
  // non-dashboard view so they only appear on the Panel — at all breakpoints.
  // The `.right .top` bar (menu / theme / profile) is untouched and stays put.
  rightPanel?.classList.toggle("rail-widgets-hidden", page !== "dashboard");

  runView(page);

  closeNav();

  // Return to the top on navigation. On mobile the top bar is fixed and pages
  // scroll long, so tapping the profile photo (→ Settings) at the bottom would
  // otherwise appear to do nothing; this makes every section switch land at top.
  window.scrollTo({ top: 0 });
}

sidebarLinks.forEach((link) => {
  link.addEventListener("click", (e) => {
    e.preventDefault();
    navigateTo(link.dataset.page);
  });
});

// Dashboard summary cards double as shortcuts to their full section.
const dashboardCardLinks = {
  "student-info-bar": "settings",
  "card-attendance": "attendance",
  "card-grade": "grades",
  "card-next-class": "schedule",
  "upcoming-events-card": "events",
};

Object.entries(dashboardCardLinks).forEach(([cardId, page]) => {
  const card = document.getElementById(cardId);
  if (!card) return;
  card.addEventListener("click", () => navigateTo(page));
  card.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      navigateTo(page);
    }
  });
});

const logoutBtn = document.getElementById("logout-btn");
if (logoutBtn) {
  logoutBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    await signOut();
    window.location.replace("/login.html");
  });
}

// Cross-portal links. Each target enforces its own guard on load, so these are
// shown only when that guard would let this user in — an ungated link is worse
// than no link, because it bounces straight back to where it was clicked.
// A plain student matches neither and sees the sidebar it had before.
const CROSS_PORTAL_LINKS = [
  { id: "admin-console-link", path: "/admin", roles: ["admin"] },
  { id: "teacher-portal-link", path: "/teacher", roles: ["teacher", "admin"] },
];

async function initCrossPortalLinks() {
  const role = await fetchRole();
  for (const { id, path, roles } of CROSS_PORTAL_LINKS) {
    const link = document.getElementById(id);
    if (!link || !roles.includes(role)) continue;
    link.hidden = false;
    link.addEventListener("click", async (e) => {
      e.preventDefault();
      // Re-check the session at click time: the tab may have sat open long
      // enough for it to expire, and the target's guard would only bounce
      // the user to a login page without explaining why.
      if (!(await getSession())) {
        window.location.replace("/login.html");
        return;
      }
      window.location.href = path;
    });
  }
}

initCrossPortalLinks();

// Where each view's failure notice goes, and whether it has to be a table row.
// The dashboard's colspan is a function: its table is subject + one column per
// grading period + Average, so the width isn't known until the periods load
// (and a failure before that falls back to the markup's two static columns).
const VIEW_ERROR_TARGETS = {
  dashboard: {
    selector: "#dashboard-grades-body",
    colspan: () => PERIODS.length + 2,
  },
  grades: { selector: "#grades-body", colspan: 6 },
  attendance: { selector: "#attendance-body", colspan: 5 },
  schedule: { selector: "#schedule-grid" },
  teachers: { selector: "#teacher-cards" },
  events: { selector: "#events-timeline" },
  settings: { selector: "#settings-root" },
};

/** Replace a view's content with a failure notice the user can act on. */
function renderViewError(page) {
  const target = VIEW_ERROR_TARGETS[page];
  if (!target) return;
  const host = document.querySelector(target.selector);
  if (!host) return;

  const message = t("common.loadError");
  const retry = t("common.retry");
  const colspan =
    typeof target.colspan === "function" ? target.colspan() : target.colspan;
  host.innerHTML = colspan
    ? errorRow(colspan, message, retry)
    : errorState(message, retry);

  host.querySelector("[data-retry]")?.addEventListener("click", () => {
    runView(page);
  });
}

/**
 * Load a view once, and let it be loaded again if it failed.
 *
 * The cache flag is set only on success, so a view that threw is not
 * remembered as "already loaded" — which is what makes the retry button work
 * and what stops a transient network blip from leaving a section permanently
 * blank for the rest of the session.
 */
function runView(page) {
  if (viewCache[page]) return;
  viewCache[page] = true;
  initView(page).catch((err) => {
    console.error(`[SMP] ${page} view failed to load:`, err);
    viewCache[page] = false;
    renderViewError(page);
  });
}

async function initView(page) {
  switch (page) {
    case "dashboard":
      return initDashboard();
    case "grades":
      return initGrades();
    case "schedule":
      return initSchedule();
    case "teachers":
      return initTeachersView();
    case "attendance":
      return initAttendanceView();
    case "events":
      return initEventsView();
    case "settings":
      return initSettings();
    default:
      break;
  }
}

let studentProfile = null;
let schoolYearId = null;
let classId = null;

// Events feed both the dashboard "Upcoming" widget and the Events view. Memoize
// the request so navigating between them reuses a single round-trip instead of
// re-fetching (the two callers previously fired independent queries).
let eventsPromise = null;
function getEvents() {
  if (!eventsPromise) eventsPromise = fetchEvents();
  return eventsPromise;
}

// The year's grading periods, shared by the dashboard's Grade Overview columns
// and the Grades view's period picker. Memoized for the same reason as events:
// both callers want the same rows, and neither should re-fetch them. How many
// there are is a property of the school year — Costa Rica's MEP calendar runs
// two periodos — so nothing downstream may assume a count.
let periodsPromise = null;
function getGradingPeriods() {
  if (!periodsPromise) periodsPromise = fetchGradingPeriods(schoolYearId);
  return periodsPromise;
}

/** Periods in display order, resolved. Empty until the fetch lands. */
let PERIODS = [];

async function initDashboard() {
  // Warm the events request now so it overlaps the profile + stats fetches
  // below; renderUpcomingEvents() awaits this same in-flight promise.
  getEvents();

  studentProfile = await fetchStudentProfile(STUDENT_ID);
  if (!studentProfile) {
    document.getElementById("student-name").textContent = t(
      "student.errorLoadingProfile",
    );
    return;
  }

  const cls = studentProfile.classes;
  schoolYearId = cls?.school_years?.id;
  classId = cls?.id;

  // Needed before the Grade Overview table renders — its columns are one per
  // period. Warmed here, after schoolYearId is known and before the stats await.
  PERIODS = await getGradingPeriods();

  document.getElementById("student-name").textContent =
    `${studentProfile.first_name} ${studentProfile.last_name}`;
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
    studentProfile.status,
  );

  document.getElementById("welcome-name").textContent =
    studentProfile.first_name;

  const stats = await fetchDashboardStats(STUDENT_ID, classId);

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
  // and textContent escapes them without main.js needing an escapeHtml of its
  // own (the helper is private to admin.js/teacher.js).
  head.replaceChildren(
    ...[
      t("student.dash.subject"),
      ...PERIODS.map((p) => p.name),
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
  const cols = PERIODS.length + 2;

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
      const scores = PERIODS.map((p) => subj.periods[p.period_order]).filter(
        (s) => s !== undefined,
      );
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
      ${PERIODS.map((p) => {
        const score = subj.periods[p.period_order];
        return `<td>${score !== undefined ? scoreHtml(score) : "—"}</td>`;
      }).join("")}
      <td>${avg !== null ? scoreHtml(avg) : "—"}</td>
    </tr>`;
    })
    .join("");
}

async function initGrades() {
  if (!schoolYearId) {
    const profile = await fetchStudentProfile(STUDENT_ID);
    schoolYearId = profile?.classes?.school_years?.id;
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

  const grades = await fetchStudentGrades(STUDENT_ID, periodId);

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

async function initSchedule() {
  if (!classId) {
    const profile = await fetchStudentProfile(STUDENT_ID);
    classId = profile?.classes?.id;
  }

  const schedule = await fetchClassSchedule(classId);
  const grid = document.getElementById("schedule-grid");

  if (!schedule || schedule.length === 0) {
    grid.innerHTML = `<div class="loading-cell">${t("student.schedule.empty")}</div>`;
    return;
  }

  const timeSlots = [
    ...new Map(
      schedule.map((s) => [
        `${s.start_time}-${s.end_time}`,
        { start: s.start_time, end: s.end_time },
      ]),
    ).values(),
  ].sort((a, b) => a.start.localeCompare(b.start));

  // Monday–Friday always show; a weekend column appears only when the
  // student actually has class on it, so a normal week stays five wide.
  const days = [
    ...new Set([
      ...DEFAULT_ACTIVE_DAYS,
      ...schedule.map((s) => Number(s.day_of_week)),
    ]),
  ]
    .filter((d) => d >= 1 && d <= 7)
    .sort((a, b) => a - b);

  let html = "";

  html += `<div class="sch-header">${t("student.schedule.time")}</div>`;
  days.forEach((day) => {
    html += `<div class="sch-header">${t(`common.daysShort.${dayKeyShort(day)}`)}</div>`;
  });

  timeSlots.forEach((slot) => {
    html += `<div class="sch-time">${formatTime(slot.start)}<br>${formatTime(slot.end)}</div>`;

    for (const day of days) {
      const entry = schedule.find(
        (s) =>
          s.day_of_week === day &&
          s.start_time === slot.start &&
          s.end_time === slot.end,
      );

      if (entry) {
        const color = entry.subjects?.color ?? "#7380ec";
        html += `<div class="sch-cell">
          <div class="sch-color-bar" style="background:${color}"></div>
          <span class="sch-subject">${entry.subjects?.name ?? "—"}</span>
          <span class="sch-teacher">${entry.teachers?.first_name ?? ""} ${entry.teachers?.last_name ?? ""}</span>
          <span class="sch-room">${entry.rooms?.name ?? ""}</span>
        </div>`;
      } else {
        html += '<div class="sch-cell empty">—</div>';
      }
    }
  });

  grid.style.setProperty("--sched-days", String(days.length));
  grid.innerHTML = html;
}

async function initTeachersView() {
  const teachers = await fetchTeachers();
  const container = document.getElementById("teacher-cards");

  if (!teachers || teachers.length === 0) {
    container.innerHTML = `<div class="loading-cell">${t("student.teachers.empty")}</div>`;
    return;
  }

  container.innerHTML = teachers
    .map((tch) => {
      const statusClass =
        tch.status === "active"
          ? "badge-success"
          : tch.status === "on_leave"
            ? "badge-warning"
            : "badge-danger";
      return `<div class="teacher-card">
      <div class="teacher-avatar">
        <span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-person"></use></svg></span>
      </div>
      <h3>${tch.first_name} ${tch.last_name}</h3>
      <p class="teacher-spec">${tch.specialization ?? "—"}</p>
      <p class="teacher-email">${tch.email ?? "—"}</p>
      <div class="teacher-status">
        <span class="badge ${statusClass}">${statusLabel(tch.status)}</span>
      </div>
    </div>`;
    })
    .join("");
}

async function initAttendanceView() {
  const records = await fetchStudentAttendance(STUDENT_ID);

  const summary = document.getElementById("attendance-summary");
  const total = records.length;
  const counts = { present: 0, absent: 0, late: 0, excused: 0 };
  records.forEach((r) => {
    if (counts[r.status] !== undefined) counts[r.status]++;
  });

  summary.innerHTML = [
    {
      label: t("enums.attendance.present"),
      val: counts.present,
      cls: "stat-present",
    },
    {
      label: t("enums.attendance.absent"),
      val: counts.absent,
      cls: "stat-absent",
    },
    { label: t("enums.attendance.late"), val: counts.late, cls: "stat-late" },
    {
      label: t("enums.attendance.excused"),
      val: counts.excused,
      cls: "stat-excused",
    },
  ]
    .map(
      (s) => `
    <div class="att-stat ${s.cls}">
      <h2>${s.val}</h2>
      <p>${s.label}</p>
    </div>
  `,
    )
    .join("");

  const tbody = document.getElementById("attendance-body");

  if (total === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="loading-cell">${t("student.attendance.empty")}</td></tr>`;
    return;
  }

  tbody.innerHTML = records
    .map((r) => {
      const statusCls = `status-${r.status}`;
      // fetchStudentAttendance attaches the recorder as `r.teacher` (singular);
      // reading `r.teachers` here left this column always blank ("—").
      const teacher = r.teacher;
      return `<tr>
      <td>${formatDate(r.date)}</td>
      <td>${r.classes?.display_name ?? "—"}</td>
      <td><span class="status-badge ${statusCls}">${attendanceLabel(r.status)}</span></td>
      <td>${teacher ? `${teacher.first_name} ${teacher.last_name}` : "—"}</td>
      <td>${r.notes ?? "—"}</td>
    </tr>`;
    })
    .join("");
}

async function initEventsView() {
  const events = await getEvents();
  const container = document.getElementById("events-timeline");

  if (!events || events.length === 0) {
    container.innerHTML = `<div class="loading-cell">${t("student.events.empty")}</div>`;
    return;
  }

  const iconMap = {
    holiday: "beach_access",
    exam_period: "quiz",
    activity: "celebration",
    parent_meeting: "groups",
    suspension: "block",
    general: "event",
  };

  container.innerHTML = events
    .map((ev) => {
      const icon = iconMap[ev.type] ?? "event";
      const dateStr = ev.end_date
        ? `${formatDate(ev.start_date)} → ${formatDate(ev.end_date)}`
        : formatDate(ev.start_date);

      return `<div class="event-card event-${ev.type}">
      <div class="event-icon">
        <span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-${icon}"></use></svg></span>
      </div>
      <div class="event-body">
        <h3>${ev.title}</h3>
        <p>${ev.description ?? ""}</p>
        <div class="event-dates">
          <span class="material-symbols-outlined" style="font-size:.85rem;vertical-align:middle;"><svg aria-hidden="true"><use href="#icon-calendar_today"></use></svg></span>
          ${dateStr}
          <span class="badge badge-${eventTypeBadge(ev.type)}" style="margin-left:.5rem;">${formatEventType(ev.type)}</span>
        </div>
      </div>
    </div>`;
    })
    .join("");
}

// Read-only Settings for the student context. Reuses the dashboard's
// studentProfile when available; otherwise fetches it on demand. Builds the
// normalized adapter consumed by the shared renderer in settings.js.
async function initSettings() {
  if (!studentProfile) {
    studentProfile = await fetchStudentProfile(STUDENT_ID);
  }

  const root = document.getElementById("settings-root");
  if (!root) return;

  if (!studentProfile) {
    root.innerHTML = `<div class="loading-cell">${t("common.couldNotLoadProfile")}</div>`;
    return;
  }

  const s = studentProfile;
  const cls = s.classes;
  const classLine = cls
    ? t("student.classLine", {
        grade: cls.grade_levels?.name ?? "—",
        section: cls.display_name ?? "—",
      })
    : null;

  const dateOr = (d) => (d ? formatDate(d) : null);
  const gradeName = cls?.grade_levels?.name;

  const adapter = {
    context: "student",
    identity: {
      displayName: `${s.first_name} ${s.last_name}`,
      subtitle: `${t("settings.roleStudent")}${gradeName ? " · " + gradeName : ""}`,
      avatarIcon: "person",
      roleBadge: {
        text: t("settings.roleStudent"),
        className: "badge-primary",
      },
    },
    personal: [
      {
        label: t("settings.fields.firstName"),
        value: s.first_name,
        icon: "badge",
      },
      {
        label: t("settings.fields.lastName"),
        value: s.last_name,
        icon: "badge",
      },
      {
        label: t("settings.fields.enrollmentNumber"),
        value: s.enrollment_number,
        icon: "tag",
      },
      {
        label: t("settings.fields.nationalId"),
        value: s.national_id,
        icon: "fingerprint",
      },
      {
        label: t("settings.fields.dateOfBirth"),
        value: dateOr(s.date_of_birth),
        icon: "cake",
      },
      {
        label: t("settings.fields.gender"),
        value: genderLabel(s.gender),
        icon: "wc",
      },
      { label: t("settings.fields.class"), value: classLine, icon: "school" },
      { label: t("settings.fields.email"), value: s.email, icon: "mail" },
      { label: t("settings.fields.phone"), value: s.phone, icon: "call" },
      { label: t("settings.fields.address"), value: s.address, icon: "home" },
      {
        label: t("settings.fields.status"),
        value: s.status ? statusLabel(s.status) : null,
        icon: "info",
      },
      {
        label: t("settings.fields.enrolled"),
        value: dateOr(s.enrollment_date),
        icon: "event",
      },
    ],
    username: s.email,
    email: s.email,
  };

  renderSettings(root, adapter);
}

// Gender label from the DB code (M/F/O); unknown codes pass through verbatim.
function genderLabel(g) {
  if (!g) return null;
  const key = String(g).trim().toUpperCase();
  if (key === "M" || key === "F" || key === "O") {
    return t(`enums.gender.${key}`);
  }
  return g;
}

// Attendance status badge label from the DB status value.
function attendanceLabel(status) {
  return t(`enums.attendance.${status}`);
}

// Student/teacher status label from the DB status value.
function statusLabel(status) {
  return status ? t(`enums.studentStatus.${status}`) : "";
}

// Full weekday name (1=Mon … 5=Fri) for the "next class" card.
function dayNameFull(dow) {
  const keys = ["", "monday", "tuesday", "wednesday", "thursday", "friday"];
  return keys[dow] ? t(`common.days.${keys[dow]}`) : "";
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

function scoreHtml(score) {
  const cls =
    score >= 70 ? "score-high" : score >= 50 ? "score-mid" : "score-low";
  return `<span class="${cls}">${score}</span>`;
}

function eventTypeBadge(type) {
  const map = {
    holiday: "danger",
    exam_period: "warning",
    activity: "success",
    parent_meeting: "primary",
    suspension: "danger",
    general: "info",
  };
  return map[type] ?? "info";
}

function formatEventType(type) {
  const known = [
    "holiday",
    "exam_period",
    "activity",
    "parent_meeting",
    "suspension",
    "general",
  ];
  return known.includes(type) ? t(`enums.eventType.${type}`) : type;
}

async function init() {
  navigateTo("dashboard");
}

init();
