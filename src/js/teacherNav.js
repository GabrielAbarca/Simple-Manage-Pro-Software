// ─────────────────────────────────────────────────────────────────
//  teacherNav.js — sidebar section switching, logout, and cross-portal
//  links for the teacher console. Split out of teacher.js's navigation
//  section.
//
//  Takes a `{page: loader}` map rather than importing view modules
//  directly (same shape as studentNav.js's initNav), so this file never
//  has to import the class-workspace/view modules that in turn import
//  `showSection` from here.
// ─────────────────────────────────────────────────────────────────
import { getSession, signOut } from "./auth.js";
import { fetchStudentId } from "./role.js";
import { state } from "./teacherState.js";

const sections = document.querySelectorAll(".view-section");
const navLinks = document.querySelectorAll(".sidebar a[data-page]");

/** @type {{ today?: () => any, myclasses?: () => any, subjects?: () => any, settings?: () => any }} */
let loaders = {};

export function showSection(page) {
  sections.forEach((s) => s.classList.remove("active"));
  navLinks.forEach((a) => a.classList.remove("active"));

  const target = document.getElementById(`view-${page}`);
  if (target) target.classList.add("active");

  // Class workspace keeps "My Classes" highlighted in the sidebar.
  const navPage = page === "class" ? "myclasses" : page;
  document
    .querySelector(`.sidebar a[data-page="${navPage}"]`)
    ?.classList.add("active");

  // Today's schedule is static for the session, so load it once (a reload
  // refreshes it). My Classes stays live because its student counts are mutable.
  if (page === "today" && !state.loaded.today) {
    state.loaded.today = true;
    loaders.today?.();
  }
  if (page === "myclasses") loaders.myclasses?.();
  if (page === "subjects" && !state.loaded.subjects) {
    state.loaded.subjects = true;
    loaders.subjects?.();
  }
  if (page === "settings" && !state.loaded.settings) {
    state.loaded.settings = true;
    loaders.settings?.();
  }
}

/**
 * Wire up the sidebar, logout button, and cross-portal links.
 * @param {typeof loaders} pageLoaders page name → view loader
 * @param {() => void} closeNav collapses the mobile sidebar after navigation
 */
export function initTeacherNav(pageLoaders, closeNav) {
  loaders = pageLoaders;

  navLinks.forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      showSection(/** @type {HTMLElement} */ (link).dataset.page);
      closeNav();
    });
  });

  // See the admin console's logout: preventDefault stops the <a> from navigating
  // before signOut() has finished, which otherwise bounces the user right back.
  document
    .getElementById("logout-btn")
    ?.addEventListener("click", async (e) => {
      e.preventDefault();
      await signOut();
      window.location.replace("/login.html");
    });

  initCrossPortalLinks();
}

// Cross-portal links, revealed only when the target would accept this caller.
// `state.role` is the signed-in profiles.role resolved by the guard — NOT
// IS_ADMIN, which is a visual lock on admin-restricted controls in this console
// and is deliberately always false. The student portal is keyed on a students
// row rather than a role: an account can hold both (the demo account does), and
// that row is exactly what the portal looks up.
async function initCrossPortalLinks() {
  const links = [
    {
      id: "admin-console-link",
      path: "/admin",
      allowed: state.role === "admin",
    },
    {
      id: "student-portal-link",
      path: "/",
      allowed: (await fetchStudentId(state.session.user.id)) != null,
    },
  ];

  for (const { id, path, allowed } of links) {
    const link = document.getElementById(id);
    if (!link || !allowed) continue;
    link.hidden = false;
    link.addEventListener("click", async (e) => {
      e.preventDefault();
      if (!(await getSession())) {
        window.location.replace("/login.html");
        return;
      }
      window.location.href = path;
    });
  }
}
