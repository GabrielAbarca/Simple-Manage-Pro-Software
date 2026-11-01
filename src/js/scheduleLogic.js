/**
 * The minimum an entry needs to be ordered or overlap-tested. The student
 * portal reads schedules with embedded joins and no foreign keys, so the
 * ordering helpers deliberately ask for no more than this.
 * @typedef {Object} TimedEntry
 * @property {number} day_of_week 1 = Monday … 7 = Sunday
 * @property {string} start_time "HH:MM" or "HH:MM:SS"
 * @property {string} end_time "HH:MM" or "HH:MM:SS"
 */

/**
 * A single timetable entry. Mirrors a row of public.schedules; `id` is
 * absent for a row being composed in the editor.
 * @typedef {Object} ScheduleEntry
 * @property {number} [id]
 * @property {number} class_id
 * @property {number} subject_id
 * @property {number} teacher_id
 * @property {number} day_of_week 1 = Monday … 7 = Sunday
 * @property {string} start_time "HH:MM" or "HH:MM:SS"
 * @property {string} end_time "HH:MM" or "HH:MM:SS"
 * @property {number|null} [room_id]
 */

/**
 * A clash between a candidate entry and one already scheduled.
 * @typedef {Object} ScheduleConflict
 * @property {"section"|"teacher"|"room"} type what is double-booked
 * @property {ScheduleEntry} entry the existing entry it collides with
 */

/** Day-of-week keys, indexed 1–7 to match the stored value. */
export const DAY_KEYS = [
  "",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

/** Short day keys, same 1–7 indexing (i18n `common.daysShort.*`). */
export const DAY_KEYS_SHORT = [
  "",
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
];

/** Every day a school could possibly teach on. */
export const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];

/** The week a school runs unless it says otherwise. */
export const DEFAULT_ACTIVE_DAYS = [1, 2, 3, 4, 5];

/**
 * i18n key suffix for a day number.
 * @param {number} dow 1–7
 * @returns {string} e.g. "monday", or "" when out of range
 */
export function dayKey(dow) {
  return DAY_KEYS[dow] ?? "";
}

/**
 * Short i18n key suffix for a day number.
 * @param {number} dow 1–7
 * @returns {string}
 */
export function dayKeyShort(dow) {
  return DAY_KEYS_SHORT[dow] ?? "";
}

/**
 * JavaScript's Date#getDay() (Sunday = 0) → stored day_of_week (Sunday = 7).
 * @param {number} jsDay 0–6
 * @returns {number} 1–7
 */
export function jsDayToDow(jsDay) {
  return jsDay === 0 ? 7 : jsDay;
}

/**
 * Trim a stored or typed time to "HH:MM" for display and comparison.
 * @param {string|null|undefined} time
 * @returns {string} "" when there is nothing to normalize
 */
export function normalizeTime(time) {
  if (!time) return "";
  return String(time).slice(0, 5);
}

/**
 * Minutes since midnight, for ordering and overlap maths.
 * @param {string|null|undefined} time
 * @returns {number} NaN when unparseable
 */
export function toMinutes(time) {
  const norm = normalizeTime(time);
  const [h, m] = norm.split(":");
  const hours = Number(h);
  const mins = Number(m);
  if (!Number.isFinite(hours) || !Number.isFinite(mins)) return NaN;
  return hours * 60 + mins;
}

/**
 * Do two time ranges overlap? Half-open: a block ending exactly when the
 * next one starts is not a clash — that is what back-to-back periods look
 * like.
 * @param {string} aStart
 * @param {string} aEnd
 * @param {string} bStart
 * @param {string} bEnd
 * @returns {boolean}
 */
export function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  const s1 = toMinutes(aStart);
  const e1 = toMinutes(aEnd);
  const s2 = toMinutes(bStart);
  const e2 = toMinutes(bEnd);
  if (![s1, e1, s2, e2].every(Number.isFinite)) return false;
  return s1 < e2 && e1 > s2;
}

/**
 * The days a year's week runs on: sorted, deduped and clamped to 1–7.
 * Falls back to Monday–Friday when the school has never configured it.
 * @param {{ active_days?: Array<number|string>|null }|null|undefined} config
 * @returns {number[]}
 */
export function resolveActiveDays(config) {
  const raw = config?.active_days;
  if (!Array.isArray(raw) || raw.length === 0) return [...DEFAULT_ACTIVE_DAYS];
  const days = [
    ...new Set(
      raw
        .map((d) => Number(d))
        .filter((d) => Number.isInteger(d) && d >= 1 && d <= 7),
    ),
  ].sort((a, b) => a - b);
  return days.length ? days : [...DEFAULT_ACTIVE_DAYS];
}

/**
 * Chronological order: day, then start, then end.
 * @template {TimedEntry} T
 * @param {T[]} entries
 * @returns {T[]} a new sorted array
 */
export function sortEntries(entries) {
  return [...(entries ?? [])].sort(
    (a, b) =>
      a.day_of_week - b.day_of_week ||
      toMinutes(a.start_time) - toMinutes(b.start_time) ||
      toMinutes(a.end_time) - toMinutes(b.end_time),
  );
}

/**
 * Bucket entries by day number, each bucket chronologically sorted.
 * @template {TimedEntry} T
 * @param {T[]} entries
 * @returns {Map<number, T[]>}
 */
export function groupByDay(entries) {
  /** @type {Map<number, T[]>} */
  const byDay = new Map();
  for (const entry of sortEntries(entries)) {
    const bucket = byDay.get(entry.day_of_week);
    if (bucket) bucket.push(entry);
    else byDay.set(entry.day_of_week, [entry]);
  }
  return byDay;
}

/**
 * The distinct start/end pairs across a week — the row headers of a
 * timetable grid.
 * @param {Array<{ start_time: string, end_time: string }>} entries
 * @returns {Array<{ start: string, end: string }>} sorted by start, then end
 */
export function timeSlots(entries) {
  /** @type {Map<string, { start: string, end: string }>} */
  const slots = new Map();
  for (const entry of entries ?? []) {
    const start = normalizeTime(entry.start_time);
    const end = normalizeTime(entry.end_time);
    if (!start || !end) continue;
    slots.set(`${start}-${end}`, { start, end });
  }
  return [...slots.values()].sort(
    (a, b) =>
      toMinutes(a.start) - toMinutes(b.start) ||
      toMinutes(a.end) - toMinutes(b.end),
  );
}

/**
 * Everything a candidate entry would collide with.
 *
 * Three kinds, deliberately distinct because the console treats them
 * differently: a `section` clash means the class itself is already busy
 * (rejected outright — it is also what the table's unique constraint
 * guards), while `teacher` and `room` clashes are cross-section
 * double-bookings that a director may genuinely want (co-teaching, an
 * assembly, a split room) and so are warnings.
 *
 * @param {ScheduleEntry} candidate the entry being saved
 * @param {ScheduleEntry[]} entries every entry of the school year
 * @param {{ excludeId?: number|null }} [opts] ignore this id (editing in place)
 * @returns {ScheduleConflict[]}
 */
export function findConflicts(candidate, entries, opts = {}) {
  const { excludeId = null } = opts;
  if (!candidate) return [];
  /** @type {ScheduleConflict[]} */
  const conflicts = [];
  for (const entry of entries ?? []) {
    if (excludeId != null && entry.id === excludeId) continue;
    if (entry.day_of_week !== candidate.day_of_week) continue;
    if (
      !rangesOverlap(
        candidate.start_time,
        candidate.end_time,
        entry.start_time,
        entry.end_time,
      )
    ) {
      continue;
    }
    if (entry.class_id === candidate.class_id) {
      conflicts.push({ type: "section", entry });
    }
    if (entry.teacher_id === candidate.teacher_id) {
      conflicts.push({ type: "teacher", entry });
    }
    if (
      candidate.room_id != null &&
      entry.room_id != null &&
      entry.room_id === candidate.room_id
    ) {
      conflicts.push({ type: "room", entry });
    }
  }
  return conflicts;
}

/**
 * Every clash already present in a year's timetable — the passive
 * "problems to fix" list. Each pair is reported once.
 * @param {ScheduleEntry[]} entries
 * @returns {Array<{ type: "section"|"teacher"|"room", a: ScheduleEntry, b: ScheduleEntry }>}
 */
export function findAllConflicts(entries) {
  const list = entries ?? [];
  /** @type {Array<{ type: "section"|"teacher"|"room", a: ScheduleEntry, b: ScheduleEntry }>} */
  const found = [];
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const a = list[i];
      const b = list[j];
      if (a.day_of_week !== b.day_of_week) continue;
      if (!rangesOverlap(a.start_time, a.end_time, b.start_time, b.end_time)) {
        continue;
      }
      if (a.class_id === b.class_id) found.push({ type: "section", a, b });
      if (a.teacher_id === b.teacher_id) found.push({ type: "teacher", a, b });
      if (a.room_id != null && b.room_id != null && a.room_id === b.room_id) {
        found.push({ type: "room", a, b });
      }
    }
  }
  return found;
}

/**
 * Work out what copying one section's week onto another would do.
 *
 * Rows that would land on top of something the target already has are
 * skipped (the target keeps what it has); teacher and room clashes with
 * *other* sections are copied but reported, matching the warn-don't-block
 * rule the editor uses for single entries.
 *
 * @param {ScheduleEntry[]} sourceEntries the section being copied from
 * @param {number} targetClassId
 * @param {ScheduleEntry[]} yearEntries every entry of the school year
 * @returns {{ rows: object[], conflicts: ScheduleConflict[], skipped: ScheduleEntry[] }}
 *   `rows` are ready to insert (no id, class re-pointed)
 */
export function copySchedulePlan(sourceEntries, targetClassId, yearEntries) {
  /** @type {object[]} */
  const rows = [];
  /** @type {ScheduleConflict[]} */
  const conflicts = [];
  /** @type {ScheduleEntry[]} */
  const skipped = [];
  // Grows as rows are accepted, so the plan also catches a source week
  // that clashes with itself.
  const projected = [...(yearEntries ?? [])];

  for (const entry of sortEntries(sourceEntries)) {
    /** @type {ScheduleEntry} */
    const candidate = {
      class_id: targetClassId,
      subject_id: entry.subject_id,
      teacher_id: entry.teacher_id,
      day_of_week: entry.day_of_week,
      start_time: normalizeTime(entry.start_time),
      end_time: normalizeTime(entry.end_time),
      room_id: entry.room_id ?? null,
    };
    const found = findConflicts(candidate, projected);
    if (found.some((c) => c.type === "section")) {
      skipped.push(entry);
      continue;
    }
    conflicts.push(...found);
    rows.push({ ...candidate });
    projected.push(candidate);
  }
  return { rows, conflicts, skipped };
}

/**
 * Validate a bell schedule's blocks: each must end after it starts, no two
 * may overlap, and orders must be distinct.
 * @param {Array<{ block_order?: number|string, start_time: string, end_time: string }>} blocks
 * @returns {Record<number, "timeOrder"|"overlap"|"duplicateOrder">} index → problem
 */
export function validateBlocks(blocks) {
  /** @type {Record<number, "timeOrder"|"overlap"|"duplicateOrder">} */
  const errors = {};
  const list = blocks ?? [];
  const seenOrders = new Map();

  list.forEach((block, index) => {
    if (toMinutes(block.start_time) >= toMinutes(block.end_time)) {
      errors[index] = "timeOrder";
    }
    const order = Number(block.block_order);
    if (Number.isFinite(order)) {
      if (seenOrders.has(order)) errors[index] ??= "duplicateOrder";
      else seenOrders.set(order, index);
    }
  });

  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      if (
        rangesOverlap(
          list[i].start_time,
          list[i].end_time,
          list[j].start_time,
          list[j].end_time,
        )
      ) {
        errors[i] ??= "overlap";
        errors[j] ??= "overlap";
      }
    }
  }
  return errors;
}

/**
 * The next class at or after a moment, wrapping across the whole week.
 *
 * Replaces a five-day loop that could never match on a Sunday and ignored
 * weekend teaching altogether.
 *
 * @template {TimedEntry} T
 * @param {T[]} entries
 * @param {number} jsDay Date#getDay() — Sunday = 0
 * @param {string} currentTime "HH:MM"
 * @returns {T|null}
 */
export function nextOccurrence(entries, jsDay, currentTime) {
  const sorted = sortEntries(entries);
  if (!sorted.length) return null;
  const today = jsDayToDow(jsDay);
  const now = toMinutes(currentTime);

  for (let offset = 0; offset < 7; offset += 1) {
    const day = ((today - 1 + offset) % 7) + 1;
    for (const entry of sorted) {
      if (entry.day_of_week !== day) continue;
      // Later today for offset 0; any time on a following day.
      if (offset === 0 && !(toMinutes(entry.start_time) > now)) continue;
      return entry;
    }
  }
  return null;
}
