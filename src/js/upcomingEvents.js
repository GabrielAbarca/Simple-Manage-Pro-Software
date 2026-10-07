import { toIso } from "./controls/dateUtils.js";

/**
 * Events that have not ended by `now`'s local date, in the order given. An
 * event without an end date ends on its start date.
 * @template {{ start_date: string, end_date?: string | null }} E
 * @param {E[]} events
 * @param {Date} [now]
 * @returns {E[]}
 */
export function upcomingEvents(events, now = new Date()) {
  const today = toIso(now);
  return (events ?? []).filter((ev) => (ev.end_date ?? ev.start_date) >= today);
}
