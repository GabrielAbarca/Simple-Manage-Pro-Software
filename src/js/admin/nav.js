// ─────────────────────────────────────────────────────────────────
//  nav.js — sidebar section switching, logout, and the profile-photo
//  shortcut for the admin console. Split out of admin.js.
//
//  Takes a `{page: loader}` map rather than importing the screen
//  modules directly (same shape as teacherNav.js / studentNav.js), so
//  this file never has to import the screens that in turn import
//  `showSection` from here.
// ─────────────────────────────────────────────────────────────────
import { signOut } from "../auth.js";
import { state } from "./state.js";

const sections = document.querySelectorAll(".view-section");
const navLinks = document.querySelectorAll(".sidebar a[data-page]");

/** @type {Record<string, () => any>} */
let loaders = {};

export function showSection(page) {
  sections.forEach((s) => s.classList.remove("active"));
  navLinks.forEach((a) => a.classList.remove("active"));
  document.getElementById(`view-${page}`)?.classList.add("active");
  document
    .querySelector(`.sidebar a[data-page="${page}"]`)
    ?.classList.add("active");

  // Settings is static for the session, so load it once; every other screen
  // re-reads on each visit because its records are mutable.
  if (page === "settings") {
    if (!state.loaded.settings) {
      state.loaded.settings = true;
      loaders.settings?.();
    }
    return;
  }
  loaders[page]?.();
}

/**
 * Wire up the sidebar, logout button and profile shortcut.
 * @param {Record<string, () => any>} pageLoaders page name → screen loader
 * @param {() => void} closeNav collapses the mobile sidebar after navigation
 */
export function initAdminNav(pageLoaders, closeNav) {
  loaders = pageLoaders;

  navLinks.forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      showSection(/** @type {HTMLElement} */ (link).dataset.page);
      closeNav();
    });
  });

  // preventDefault matters: the button is an <a>, so without it the browser
  // follows the href while signOut() is still in flight. The session is still
  // live when the next page's guard runs, and role routing sends the admin
  // straight back here — the logout silently does nothing.
  document
    .getElementById("logout-btn")
    ?.addEventListener("click", async (e) => {
      e.preventDefault();
      await signOut();
      window.location.replace("/login.html");
    });

  document.querySelector(".profile-photo")?.addEventListener("click", () => {
    showSection("settings");
    document
      .querySelector(
        '#settings-root .settings-rail-item[data-section="account"]',
      )
      ?.click();
  });
}
