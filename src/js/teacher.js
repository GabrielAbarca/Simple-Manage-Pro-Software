// ═══════════════════════════════════════════════════════════════
//  teacher.js — Simple Manage Pro | Teacher Console
//
//  Thin bootstrap: resolves the teacher session/identity, wires
//  theme/i18n/controls, and hands section switching to teacherNav.js.
//  Every section/tab lives in its own module — see
//  .claude/ARCHITECTURE_MAP.md for the full map:
//   - teacherAuth.js / teacherState.js: session guard + shared state
//   - teacherData/*: the data layer (Supabase queries), split by domain
//   - teacherFeedback.js / teacherModal.js / teacherTableHelpers.js /
//     teacherFormat.js: shared UI kit
//   - teacherNav.js: sidebar section switching + cross-portal links
//   - views/*: My Classes, class workspace + its sub-tabs (roster,
//     gradebook, attendance, schedule), subjects, settings, Today
// ═══════════════════════════════════════════════════════════════

import "./errorHandler.js";
import "./speedInsights.js";
import { resolveTeacherSession } from "./teacherAuth.js";
import { state } from "./teacherState.js";
import { db } from "./teacherData/index.js";
import { DEMO_MODE } from "./demoMode.js";
import { initTheme, bindThemeToggle } from "./theme.js";
import { initSidebarToggle } from "./ui.js";
import { initControls } from "./controls/index.js";
import { initI18n, applyTranslations, t } from "./i18n.js";
import { initTeacherNav, showSection } from "./teacherNav.js";
import { showToast } from "./teacherFeedback.js";
import { loadToday } from "./views/teacherToday.js";
import { loadMyClasses } from "./views/myClasses.js";
import { loadSubjects } from "./views/subjects.js";
import { loadSettings } from "./views/teacherSettings.js";
import { openClassTab } from "./views/classWorkspace.js";

// ── AUTH GUARD + TEACHER IDENTITY ────────────────────────────────
const { session, role } = await resolveTeacherSession();
state.session = session;
state.role = role;

// ── NAVIGATION ────────────────────────────────────────────────
const closeNav = initSidebarToggle();

initTeacherNav(
  {
    today: loadToday,
    myclasses: loadMyClasses,
    subjects: loadSubjects,
    settings: loadSettings,
  },
  closeNav,
);

document.querySelector(".profile-photo")?.addEventListener("click", () => {
  showSection("settings");
  // Snap to Account & Profile (default sub-tab on first render; re-select it
  // when re-opening after the user switched to another settings sub-tab).
  document
    .querySelector('#settings-root .settings-rail-item[data-section="account"]')
    ?.click();
});
initTheme();
bindThemeToggle(document.querySelector(".theme-toggler"));

// Resolve this view's language (stored "smp-lang-admin" → browser → English)
// and translate the static markup before any section renders.
initI18n("teacher");
applyTranslations();

// Enhance every <select> and <input type="date"> — now and whenever the app
// renders more. Must run AFTER initI18n/applyTranslations: the date picker
// takes its month names, field order and week start from the active locale.
initControls();

document.getElementById("class-back-btn")?.addEventListener("click", () => {
  showSection("myclasses");
});

document.querySelectorAll(".class-subtab").forEach((btn) => {
  btn.addEventListener("click", () =>
    openClassTab(/** @type {HTMLElement} */ (btn).dataset.tab),
  );
});

// ── INIT ──────────────────────────────────────────────────────
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

try {
  // Resolved separately, not with Promise.all: the year is useful on its own,
  // and pairing the two meant a failure to resolve the teacher also threw away
  // a perfectly good year, leaving every view without its context.
  state.teacherId = await db.getTeacherId();
  state.activeYear = await db.fetchActiveYear();
  state.periods = await db.fetchGradingPeriods(state.activeYear?.id);

  const teacher = await db.fetchTeacher(state.teacherId);
  if (teacher) {
    document.getElementById("teacher-name").textContent =
      `${teacher.first_name} ${teacher.last_name}`;
  } else {
    // Signed in, authorised, but this account owns no teachers row — normally
    // an admin using the console for oversight. That is an expected state, not
    // a failure, so say so plainly rather than flashing an error toast. The
    // element also backs a "Signed in as {name}" line, so it gets the account's
    // own email rather than a status phrase that would not read as a name.
    document.getElementById("teacher-name").textContent =
      session.user.email ?? "";
  }
} catch (err) {
  console.error("Failed to resolve teacher context:", err);
  showToast(t("admin.toast.contextFailed"), "error");
}
