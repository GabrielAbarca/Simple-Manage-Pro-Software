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
