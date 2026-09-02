// ─────────────────────────────────────────────────────────────────
//  helpers.js — the schedules tab's shared vocabulary: how a day, a
//  time slot and a conflict read, the small toolbar controls, and the
//  re-read that follows a write. Split out of admin.js.
//
//  All the rules (overlaps, double-booked teachers and rooms, what a
//  copy would do) live in scheduleLogic.js; this is DOM glue and
//  translation.
// ─────────────────────────────────────────────────────────────────
import { t } from "../../i18n.js";
import * as sched from "../../scheduleLogic.js";
import { state } from "../state.js";
import { data } from "../data.js";
import { escapeHtml, num } from "../ui/format.js";
import {
  teacherName,
  roomName,
  subjectName,
  sectionName,
} from "../domain/lookups.js";
import { repaint } from "./tabState.js";

export const dayLabel = (dow) => {
  const key = sched.dayKey(Number(dow));
  return key ? t(`common.days.${key}`) : "—";
};

/** "08:00–08:45", the way a time slot reads everywhere in this tab. */
export const slotLabel = (start, end) =>
  `${sched.normalizeTime(start)}–${sched.normalizeTime(end)}`;

/** The section currently being edited, if it still exists. */
export function currentSchedSection() {
  return state.sections.find((s) => s.id === state.schedSectionId) ?? null;
}

/** Entries of the section on screen. */
export function currentSchedEntries() {
  return state.yearSchedules.filter((e) => e.class_id === state.schedSectionId);
}

/**
 * One conflict as a sentence. The three kinds name the resource that is
 * double-booked, then where it is already committed.
 * @param {{ type: string, entry: any }} conflict
 */
export function conflictText(conflict) {
  const { type, entry } = conflict;
  const section = state.sections.find((s) => s.id === entry.class_id);
  const where = `${dayLabel(entry.day_of_week)} ${slotLabel(entry.start_time, entry.end_time)}`;
  const detail = section
    ? `${sectionName(section)} · ${subjectName(entry.subject_id)} · ${where}`
    : where;
  if (type === "teacher") {
    return t("console.schedules.conflicts.teacher", {
      teacher: teacherName(entry.teacher_id),
      detail,
    });
  }
  if (type === "room") {
    return t("console.schedules.conflicts.room", {
      room: roomName(entry.room_id),
      detail,
    });
  }
  return t("console.schedules.conflicts.section", {
    section: section ? sectionName(section) : "—",
    detail,
  });
}

/** Modal values → a schedules row. */
export function entryFromValues(values, classId) {
  return {
    class_id: classId,
    subject_id: Number(values.subject_id),
    teacher_id: Number(values.teacher_id),
    day_of_week: Number(values.day_of_week),
    start_time: values.start_time,
    end_time: values.end_time,
    room_id: num(values.room_id),
  };
}

/** Re-read the year's entries and repaint. */
export async function reloadYearSchedules() {
  state.yearSchedules = await data.listYearSchedules(
    state.sections.map((s) => s.id),
  );
  repaint();
}

/** A labelled <select> for the toolbar. */
export function labeledSelect(
  id,
  label,
  options,
  value,
  onChange,
  allowEmpty = false,
) {
  const group = document.createElement("div");
  group.className = "sched-field";
  const lab = document.createElement("label");
  lab.textContent = label;
  lab.htmlFor = id;
  group.appendChild(lab);
  const select = document.createElement("select");
  select.id = id;
  options.forEach((opt) => {
    const o = document.createElement("option");
    o.value = String(opt.value);
    o.textContent = opt.label;
    if (String(opt.value) === String(value ?? "")) o.selected = true;
    select.appendChild(o);
  });
  if (!allowEmpty && !options.length) select.disabled = true;
  select.addEventListener("change", () => onChange(select.value));
  group.appendChild(select);
  return group;
}

export function ghostButton(icon, label, onClick) {
  const btn = document.createElement("button");
  btn.className = "btn btn-ghost btn-sm";
  btn.type = "button";
  btn.innerHTML = `<span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-${icon}"></use></svg></span><span>${escapeHtml(label)}</span>`;
  btn.addEventListener("click", onClick);
  return btn;
}

/** Load one bell template's blocks once, then serve them from state. */
export async function ensureBellBlocks(bellId) {
  if (state.bellBlocks[bellId]) return state.bellBlocks[bellId];
  const blocks = await data.listBellBlocks(bellId);
  state.bellBlocks[bellId] = blocks;
  return blocks;
}
