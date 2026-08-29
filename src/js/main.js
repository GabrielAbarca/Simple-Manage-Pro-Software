import "./errorHandler.js";
import "./speedInsights.js";
import { resolveStudentSession, bindSessionWatchers } from "./studentAuth.js";
import { state } from "./studentState.js";
import { DEMO_MODE } from "./demoMode.js";
import { initTheme, bindThemeToggle } from "./theme.js";
import { initSidebarToggle } from "./ui.js";
import { initControls } from "./controls/index.js";
import { initI18n, applyTranslations, t } from "./i18n.js";
import { initNav } from "./studentNav.js";
import { initDashboard } from "./views/dashboard.js";
import { initGrades } from "./views/grades.js";
import { initSchedule } from "./views/schedule.js";
import { initTeachersView } from "./views/teachers.js";
import { initAttendanceView } from "./views/attendance.js";
import { initEventsView } from "./views/events.js";
import { initSettings } from "./views/settingsView.js";

const { studentId } = await resolveStudentSession();
state.studentId = studentId;

bindSessionWatchers();

const closeNav = initSidebarToggle();
const themeToggler = document.querySelector(".theme-toggler");

const profilePhotoDiv = document.querySelector(".profile-photo");

initTheme();
bindThemeToggle(themeToggler);

// Resolve this view's language (stored "smp-lang-student" → browser → English)
// and translate the static markup before any view renders.
initI18n("student");
applyTranslations();

// Enhance every <select> and <input type="date"> — now and whenever the app
// renders more. Must run AFTER initI18n/applyTranslations: the date picker
// takes its month names, field order and week start from the active locale.
initControls();

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

const { navigateTo } = initNav(
  {
    dashboard: initDashboard,
    grades: initGrades,
    schedule: initSchedule,
    teachers: initTeachersView,
    attendance: initAttendanceView,
    events: initEventsView,
    settings: initSettings,
  },
  closeNav,
);

profilePhotoDiv.addEventListener("click", () => {
  navigateTo("settings");
  // Snap to Account & Profile. On first open the panel isn't rendered yet
  // (initSettings is async) — but renderSettings already defaults to the
  // account sub-tab, so this only matters when re-opening after switching tabs.
  document
    .querySelector('#settings-root .settings-rail-item[data-section="account"]')
    ?.click();
});

navigateTo("dashboard");
