// ═══════════════════════════════════════════════════════════════
//  admin.js — Simple Manage Pro | Admin Console
//
//  The school director/coordinator portal: where a school gets
//  configured and operated. Role-gated, bilingual, demo-overlay safe.
//
//  Thin bootstrap: resolves the admin session, wires theme/i18n/
//  controls, and hands section switching to admin/nav.js. Everything
//  else lives under src/js/admin/ — see .claude/ARCHITECTURE_MAP.md
//  for the full map:
//   - admin/auth.js, admin/state.js, admin/data.js: session guard,
//     shared state, and the demo-aware data gateway
//   - admin/ui/*: toast + confirm, the generic form modal, table
//     helpers, value formatting
//   - admin/domain/*: school profile, id→name lookups, enums and CSV
//     coercions, reference-list loaders, the login button
//   - admin/screens/*: one module per sidebar screen
//   - admin/schedules/*: the schedules tab and its two sub-tabs
//   - admin/import/*: the CSV import wizard and its entity descriptors
// ═══════════════════════════════════════════════════════════════

import "./errorHandler.js";
import "./speedInsights.js";
import { initTheme, bindThemeToggle } from "./theme.js";
import { initSidebarToggle } from "./ui.js";
import { initControls } from "./controls/index.js";
import { DEMO_MODE } from "./demoMode.js";
import { initI18n, applyTranslations, t } from "./i18n.js";
import { state } from "./admin/state.js";
import { resolveAdminSession } from "./admin/auth.js";
import { initAdminNav, showSection } from "./admin/nav.js";
import {
  loadSchoolSettings,
  applyIdLabels,
} from "./admin/domain/schoolProfile.js";
import { loadOverview } from "./admin/screens/overview.js";
import { loadYearPeriods } from "./admin/screens/years.js";
import { loadGradesSections } from "./admin/screens/gradesSections.js";
import { loadSubjects } from "./admin/screens/subjects.js";
import { loadTeachers } from "./admin/screens/teachers.js";
import { loadAssignments } from "./admin/screens/assignments.js";
import { loadAccounts } from "./admin/screens/accounts.js";
import { loadStudents } from "./admin/screens/students.js";
import { loadSettings } from "./admin/screens/settings.js";
import { loadSchedulesTab } from "./admin/schedules/index.js";
// Side-effect import: wires every screen's "Import CSV" button.
import "./admin/import/index.js";

// ── AUTH GUARD + ROLE GATE ──────────────────────────────────────
const { session, role } = await resolveAdminSession();
state.session = session;
state.role = role;

// ── NAVIGATION ──────────────────────────────────────────────────
const closeNav = initSidebarToggle();

initAdminNav(
  {
    overview: loadOverview,
    yearperiods: loadYearPeriods,
    gradessections: loadGradesSections,
    subjects: loadSubjects,
    schedules: loadSchedulesTab,
    teachers: loadTeachers,
    assignments: loadAssignments,
    students: loadStudents,
    accounts: loadAccounts,
    settings: loadSettings,
  },
  closeNav,
);

initTheme();
bindThemeToggle(document.querySelector(".theme-toggler"));

// Resolve this view's language and translate the static markup before any
// screen renders.
initI18n("admin");
applyTranslations();

// Enhance every <select> and <input type="date"> — now and whenever the app
// renders more. Must run AFTER initI18n/applyTranslations: the date picker
// takes its month names, field order and week start from the active locale.
initControls();

// ── INIT ────────────────────────────────────────────────────────
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

// Read the school profile up front: the ID-field label it carries is needed by
// the teachers/students tables and their create forms, whichever loads first.
loadSchoolSettings().then(applyIdLabels);

loadOverview();
showSection("overview");
