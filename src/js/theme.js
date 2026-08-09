// ─────────────────────────────────────────────────────────────
//  Global theme (light/dark) — shared across every page.
//  The choice is persisted to localStorage so it survives reloads
//  and navigation between the student portal, admin dashboard and
//  login. A tiny inline <head> script applies the class to <html>
//  before first paint (no flash); this module keeps body + the
//  toggler UI in sync and owns the toggle/persist logic.
// ─────────────────────────────────────────────────────────────

const STORAGE_KEY = "smp-theme";
const DARK_CLASS = "dark-theme-variables";

function readStored() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function persist(isDark) {
  try {
    localStorage.setItem(STORAGE_KEY, isDark ? "dark" : "light");
  } catch {
    /* storage unavailable (private mode) — theme just won't persist */
  }
}

export function isDarkMode() {
  return document.documentElement.classList.contains(DARK_CLASS);
}

/**
 * Reflect the current mode in any toggler present on the page.
 *
 * The togglers are <button aria-pressed> (they used to be plain <div>s, which
 * made theme switching mouse-only). `aria-pressed` is what tells a screen
 * reader which way the switch currently sits — the .active class only moves
 * the highlight visually, so both have to be kept in step here.
 */
function syncTogglers(isDark) {
  // Student + teacher + admin: .theme-toggler wrapping a light + dark icon.
  document.querySelectorAll(".theme-toggler").forEach((toggler) => {
    const spans = toggler.querySelectorAll("span");
    spans[0]?.classList.toggle("active", !isDark);
    spans[1]?.classList.toggle("active", isDark);
    toggler.setAttribute("aria-pressed", String(isDark));
  });
  // Login: distinct icon ids on a single toggler.
  const lightIcon = document.getElementById("theme-icon-light");
  const darkIcon = document.getElementById("theme-icon-dark");
  lightIcon?.classList.toggle("active", !isDark);
  darkIcon?.classList.toggle("active", isDark);
  document
    .getElementById("login-theme-toggler")
    ?.setAttribute("aria-pressed", String(isDark));
}

/** Apply a theme everywhere (html + body + togglers) and persist it. */
export function applyTheme(isDark) {
  document.documentElement.classList.toggle(DARK_CLASS, isDark);
  document.body?.classList.toggle(DARK_CLASS, isDark);
  syncTogglers(isDark);
  persist(isDark);
}

/**
 * Resolve the saved theme on page load. The inline <head> guard may have
 * already set <html> dark; fall back to localStorage otherwise.
 */
export function initTheme() {
  const isDark = isDarkMode() || readStored() === "dark";
  applyTheme(isDark);
}

/** Flip the theme (used by the toggler click handlers). */
export function toggleTheme() {
  applyTheme(!isDarkMode());
}

/** Wire a toggler element's click to flip the global theme. */
export function bindThemeToggle(toggler) {
  toggler?.addEventListener("click", toggleTheme);
}
