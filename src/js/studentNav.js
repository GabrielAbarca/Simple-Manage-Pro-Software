import { getSession, signOut } from "./auth.js";
import { fetchRole } from "./role.js";
import { errorState, errorRow } from "./ui.js";
import { t } from "./i18n.js";
import { state } from "./studentState.js";

// Where each view's failure notice goes, and whether it has to be a table row.
// The dashboard's colspan is a function: its table is subject + one column per
// grading period + Average, so the width isn't known until the periods load
// (and a failure before that falls back to the markup's two static columns).
const VIEW_ERROR_TARGETS = {
  dashboard: {
    selector: "#dashboard-grades-body",
    colspan: () => state.periods.length + 2,
  },
  grades: { selector: "#grades-body", colspan: 6 },
  attendance: { selector: "#attendance-body", colspan: 5 },
  schedule: { selector: "#schedule-grid" },
  teachers: { selector: "#teacher-cards" },
  events: { selector: "#events-timeline" },
  settings: { selector: "#settings-root" },
};

// Dashboard summary cards double as shortcuts to their full section.
const DASHBOARD_CARD_LINKS = {
  "student-info-bar": "settings",
  "card-attendance": "attendance",
  "card-grade": "grades",
  "card-next-class": "schedule",
  "upcoming-events-card": "events",
};

// Cross-portal links. Each target enforces its own guard on load, so these are
// shown only when that guard would let this user in — an ungated link is worse
// than no link, because it bounces straight back to where it was clicked.
// A plain student matches neither and sees the sidebar it had before.
const CROSS_PORTAL_LINKS = [
  { id: "admin-console-link", path: "/admin", roles: ["admin"] },
  { id: "teacher-portal-link", path: "/teacher", roles: ["teacher", "admin"] },
];

/**
 * Wire up the sidebar, dashboard shortcut cards, logout button, and
 * cross-portal links, and set up view routing/caching over `views`.
 * @param {Record<string, () => Promise<void>>} views page name → view loader,
 *   e.g. `{ dashboard: initDashboard, grades: initGrades, ... }`
 * @param {() => void} closeNav collapses the mobile sidebar after navigation
 * @returns {{ navigateTo: (page: string) => void }}
 */
export function initNav(views, closeNav) {
  const sidebarLinks = document.querySelectorAll("aside .sidebar a[data-page]");
  const viewSections = document.querySelectorAll(".view-section");
  const rightPanel = document.querySelector(".right");
  const viewCache = {};

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
    const loader = views[page];
    if (!loader) return;
    Promise.resolve(loader()).catch((err) => {
      console.error(`[SMP] ${page} view failed to load:`, err);
      viewCache[page] = false;
      renderViewError(page);
    });
  }

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

  Object.entries(DASHBOARD_CARD_LINKS).forEach(([cardId, page]) => {
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

  initCrossPortalLinks();

  return { navigateTo };
}

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
