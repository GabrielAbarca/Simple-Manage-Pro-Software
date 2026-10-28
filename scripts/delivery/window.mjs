/** @typedef {import("./manifest.mjs").Project} Project */
/** @typedef {import("./manifest.mjs").DeliveryWindow} DeliveryWindow */

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * The weekday (1 = Monday … 7 = Sunday) and `HH:MM` at `at` in `timeZone`.
 * @param {Date} at
 * @param {string} timeZone
 * @returns {{ day: number, time: string }}
 */
function localTime(at, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(at)
      .map((part) => [part.type, part.value]),
  );
  return {
    day: WEEKDAYS.indexOf(parts.weekday) + 1,
    time: `${parts.hour}:${parts.minute}`,
  };
}

/**
 * True when `at` falls in one of the window's slots, `from` inclusive and
 * `to` exclusive, in the window's own time zone.
 * @param {DeliveryWindow} window
 * @param {Date} at
 * @returns {boolean}
 */
export function windowOpen(window, at) {
  const { day, time } = localTime(at, window.timezone);
  return window.slots.some(
    (slot) => slot.days.includes(day) && slot.from <= time && time < slot.to,
  );
}

/**
 * Why a delivery to `project` can't run at `at`, or null when it can. Only a
 * project holding real data is bound to its window, and nothing overrides it.
 * @param {Project} project
 * @param {Date} at
 * @returns {string | null}
 */
export function windowRefusal(project, at) {
  if (!project.holdsRealData) return null;
  if (!project.window) {
    return `${project.name} holds real data and has no delivery window`;
  }
  if (windowOpen(project.window, at)) return null;
  const slots = project.window.slots
    .map((slot) => `days ${slot.days.join(",")} ${slot.from}–${slot.to}`)
    .join("; ");
  return `${project.name} holds real data and ${at.toISOString()} is outside its delivery window (${project.window.timezone}: ${slots})`;
}
