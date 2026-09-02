// ─────────────────────────────────────────────────────────────────
//  tabState.js — which schedules sub-tab is showing, and the repaint
//  hook the panels call after a write.
//
//  This exists so the panel modules never have to import the module
//  that renders them: index.js registers its renderer here once, and
//  everything else reaches the repaint through this leaf. Without it
//  editor/bells/forms and index would all import each other.
// ─────────────────────────────────────────────────────────────────

/** @type {"editor" | "templates"} */
let schedTab = "editor";

export function getSchedTab() {
  return schedTab;
}

/** @param {"editor" | "templates"} tab */
export function setSchedTab(tab) {
  schedTab = tab;
}

let repaintFn = () => {};

/** Called once by index.js with its own renderer. */
export function registerRepaint(fn) {
  repaintFn = fn;
}

/** Re-render the schedules tab in place. */
export function repaint() {
  repaintFn();
}
