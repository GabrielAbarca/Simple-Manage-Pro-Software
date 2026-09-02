// ═══════════════════════════════════════════════════════════════
//  admin.js — Simple Manage Pro | Admin Console
//
//  The school director/coordinator portal: where a school gets
//  configured and operated. Role-gated, bilingual, demo-overlay safe.
//
//  Architecture:
//  1. Auth guard + role gate (admin only)
//  2. Data layer  (gateway → real Supabase or demo overlay)
//  3. UI helpers  (toast, modal form, confirm, tables)
//  4. Navigation  (sidebar → view sections)
//  5. Sections    (overview, year & periods, grades & sections,
//                  subjects, teachers & assignments, schedules, settings)
// ═══════════════════════════════════════════════════════════════

import "./errorHandler.js";
import "./speedInsights.js";
import { initTheme, bindThemeToggle } from "./theme.js";
import { initSidebarToggle } from "./ui.js";
import { registerDialog } from "./dialog.js";
import { initControls } from "./controls/index.js";
import { DEMO_MODE } from "./demoMode.js";
import { parseCsv, autoMap } from "./csv.js";
import * as sched from "./scheduleLogic.js";
import * as v from "./validate.js";
import { initI18n, applyTranslations, t } from "./i18n.js";
import { state } from "./admin/state.js";
import { data } from "./admin/data.js";
import { resolveAdminSession } from "./admin/auth.js";
import { initAdminNav, showSection } from "./admin/nav.js";
import { loadOverview } from "./admin/screens/overview.js";
import { loadYearPeriods } from "./admin/screens/years.js";
import { loadGradesSections } from "./admin/screens/gradesSections.js";
import { loadGradeLevels } from "./admin/screens/gradeLevels.js";
import { loadRooms } from "./admin/screens/rooms.js";
import { loadSections } from "./admin/screens/sections.js";
import { loadSubjects } from "./admin/screens/subjects.js";
import { loadTeachers } from "./admin/screens/teachers.js";
import { loadAssignments } from "./admin/screens/assignments.js";
import { loadAccounts } from "./admin/screens/accounts.js";
import { loadStudents } from "./admin/screens/students.js";
import { loadSettings } from "./admin/screens/settings.js";
import { escapeHtml, num, fmtDate } from "./admin/ui/format.js";
import { showToast, errorText, openConfirm } from "./admin/ui/feedback.js";
import { openModal } from "./admin/ui/modal.js";
import {
  renderErrorBlock,
  iconBtn,
  markSaved,
  tableRow,
  optionsFrom,
} from "./admin/ui/tables.js";
import {
  loadSchoolSettings,
  applyIdLabels,
} from "./admin/domain/schoolProfile.js";
import {
  gradeName,
  roomName,
  teacherName,
  subjectName,
  sectionName,
} from "./admin/domain/lookups.js";
import {
  ROOM_TYPES,
  TEACHER_STATUSES,
  genderLabel,
  coerceGender,
  coerceDate,
  coerceInt,
  coerceNum,
  coerceEnum,
} from "./admin/domain/enums.js";
import {
  ensureSchoolYears,
  ensureActiveYear,
  ensureGradeLevels,
  ensureRooms,
  ensureTeachers,
} from "./admin/domain/references.js";

// ───────────────────────────────────────────────────────────────
//  1. AUTH GUARD + ROLE GATE
// ───────────────────────────────────────────────────────────────
const { session, role } = await resolveAdminSession();
state.session = session;
state.role = role;

// ───────────────────────────────────────────────────────────────
//  NAVIGATION + PAGE BOOTSTRAP
// ───────────────────────────────────────────────────────────────
const closeNav = initSidebarToggle();

initAdminNav(
  {
    overview: loadOverview,
    yearperiods: loadYearPeriods,
    gradessections: loadGradesSections,
    subjects: loadSubjects,
    schedules: loadSchedulesTab,
    teachers: loadTeachers,
    assignments: loadAssignments,
    students: loadStudents,
    accounts: loadAccounts,
    settings: loadSettings,
  },
  closeNav,
);

initTheme();
bindThemeToggle(document.querySelector(".theme-toggler"));
initI18n("admin");
applyTranslations();

// Enhance every <select> and <input type="date"> — now and whenever the app
// renders more. Must run AFTER initI18n/applyTranslations: the date picker
// takes its month names, field order and week start from the active locale.
initControls();

// ───────────────────────────────────────────────────────────────
//  5f. SCHEDULES
// ───────────────────────────────────────────────────────────────
//  Two sub-tabs behind one nav entry:
//    • the weekly editor — one section's week as a grid, with a bell
//      schedule optionally laying out the rows;
//    • bell schedules — the reusable time-block templates themselves.
//
//  All the rules (overlaps, double-booked teachers and rooms, what a
//  copy would do) live in scheduleLogic.js; this section is DOM glue and
//  translation. Conflicts come back typed: a `section` clash is rejected,
//  a `teacher`/`room` clash is a warning the director can override —
//  co-teaching and shared rooms are real.

const scheduleRoot = document.getElementById("schedules-root");

/** Which sub-tab is showing. */
let schedTab = "editor";

const dayLabel = (dow) => {
  const key = sched.dayKey(Number(dow));
  return key ? t(`common.days.${key}`) : "—";
};

/** "08:00–08:45", the way a time slot reads everywhere in this tab. */
const slotLabel = (start, end) =>
  `${sched.normalizeTime(start)}–${sched.normalizeTime(end)}`;

/** The section currently being edited, if it still exists. */
function currentSchedSection() {
  return state.sections.find((s) => s.id === state.schedSectionId) ?? null;
}

/** Entries of the section on screen. */
function currentSchedEntries() {
  return state.yearSchedules.filter((e) => e.class_id === state.schedSectionId);
}

/**
 * One conflict as a sentence. The three kinds name the resource that is
 * double-booked, then where it is already committed.
 * @param {{ type: string, entry: any }} conflict
 */
function conflictText(conflict) {
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

async function loadSchedulesTab() {
  if (!scheduleRoot) return;
  scheduleRoot.innerHTML = `<div class="console-panel"><p class="loading-cell">${escapeHtml(t("common.loading"))}</p></div>`;
  try {
    const years = state.schoolYears.length
      ? state.schoolYears
      : await data.listSchoolYears();
    state.schoolYears = years;
    state.activeYear = years.find((y) => y.is_active) ?? null;
    if (!state.activeYear) {
      scheduleRoot.innerHTML = `<div class="console-panel"><p class="loading-cell">${escapeHtml(t("console.schedules.editor.noYear"))}</p></div>`;
      return;
    }

    const [sectionsList, subjects, teachers, rooms, gradeLevels] =
      await Promise.all([
        data.listSections(state.activeYear.id),
        state.subjects.length ? state.subjects : data.listSubjects(),
        state.teachers.length ? state.teachers : data.listTeachers(),
        state.rooms.length ? state.rooms : data.listRooms(),
        state.gradeLevels.length ? state.gradeLevels : data.listGradeLevels(),
      ]);
    state.sections = sectionsList;
    state.subjects = subjects;
    state.teachers = teachers;
    state.rooms = rooms;
    state.gradeLevels = gradeLevels;

    const [config, bells, entries] = await Promise.all([
      optionalRead(
        "schedule_configs",
        data.getScheduleConfig(state.activeYear.id),
        null,
      ),
      optionalRead("bell_schedules", data.listBellSchedules(), []),
      data.listYearSchedules(sectionsList.map((s) => s.id)),
    ]);
    state.scheduleConfig = config;
    state.bellSchedules = bells;
    state.yearSchedules = entries;

    // Keep the chosen section across reloads when it is still around.
    if (!currentSchedSection()) {
      state.schedSectionId = sectionsList[0]?.id ?? null;
    }
    renderSchedulesTab();
  } catch (err) {
    console.error("loadSchedulesTab:", err);
    scheduleRoot.innerHTML = `<div class="console-panel"></div>`;
    renderErrorBlock(scheduleRoot.firstElementChild, loadSchedulesTab);
  }
}

/**
 * A read whose table a given project might not have yet.
 *
 * `schedule_configs` and `bell_schedules` arrive with a schema snippet that
 * is applied by hand (supabase/schema/incremental_schedules.sql), so they can
 * legitimately be missing while `schedules` — which has always existed — is
 * full of data. Losing a template list or a day configuration must degrade to
 * a default, not take the whole tab down with it.
 *
 * @template T
 * @param {string} label table being read, for the console warning
 * @param {Promise<T>} read
 * @param {T} fallback used when the table is unavailable
 * @returns {Promise<T>}
 */
async function optionalRead(label, read, fallback) {
  try {
    return await read;
  } catch (err) {
    console.warn(`loadSchedulesTab: ${label} unavailable:`, err);
    return fallback;
  }
}

/** Sub-tab rail + the active panel. Mirrors the settings rail's ARIA. */
function renderSchedulesTab() {
  scheduleRoot.innerHTML = "";
  const rail = document.createElement("div");
  rail.className = "settings-rail";
  rail.setAttribute("role", "tablist");
  [
    {
      id: "editor",
      labelKey: "console.schedules.rail.editor",
      icon: "schedule",
    },
    {
      id: "templates",
      labelKey: "console.schedules.rail.templates",
      icon: "list_alt",
    },
  ].forEach((tab) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `settings-rail-item${schedTab === tab.id ? " active" : ""}`;
    btn.dataset.section = tab.id;
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", String(schedTab === tab.id));
    btn.innerHTML = `<span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-${tab.icon}"></use></svg></span><span>${escapeHtml(t(tab.labelKey))}</span>`;
    btn.addEventListener("click", () => {
      schedTab = tab.id;
      renderSchedulesTab();
    });
    rail.appendChild(btn);
  });
  scheduleRoot.appendChild(rail);

  const panel = document.createElement("div");
  panel.className = "settings-panel active";
  panel.setAttribute("role", "tabpanel");
  scheduleRoot.appendChild(panel);
  if (schedTab === "templates") renderBellPanel(panel);
  else renderEditorPanel(panel);
}

// ── Weekly editor ──────────────────────────────────────────────
function renderEditorPanel(panel) {
  const sectionsList = state.sections;
  const wrap = document.createElement("div");
  wrap.className = "console-panel";
  wrap.innerHTML = `
    <div class="panel-head">
      <div>
        <h2>${escapeHtml(t("console.schedules.editor.title"))}</h2>
        <p class="panel-sub">${escapeHtml(t("console.schedules.editor.subtitle"))}</p>
      </div>
    </div>`;

  if (
    !sectionsList.length ||
    !state.subjects.length ||
    !state.teachers.length
  ) {
    wrap.insertAdjacentHTML(
      "beforeend",
      `<p class="loading-cell">${escapeHtml(t("console.schedules.editor.needSections"))}</p>`,
    );
    panel.appendChild(wrap);
    return;
  }

  // Toolbar: which section, which bell schedule, and the week's shape.
  const toolbar = document.createElement("div");
  toolbar.className = "sched-toolbar";

  toolbar.appendChild(
    labeledSelect(
      "sched-section-picker",
      t("console.schedules.editor.section"),
      optionsFrom(sectionsList, sectionName),
      state.schedSectionId,
      (value) => {
        state.schedSectionId = Number(value);
        renderSchedulesTab();
      },
    ),
  );

  toolbar.appendChild(
    labeledSelect(
      "sched-template-picker",
      t("console.schedules.editor.template"),
      [
        { value: "", label: t("console.schedules.editor.freeTimes") },
        ...optionsFrom(state.bellSchedules, (b) => b.name),
      ],
      state.schedTemplateId ?? "",
      async (value) => {
        state.schedTemplateId = value === "" ? null : Number(value);
        if (state.schedTemplateId != null)
          await ensureBellBlocks(state.schedTemplateId);
        renderSchedulesTab();
      },
      true,
    ),
  );

  const actions = document.createElement("div");
  actions.className = "sched-toolbar-actions";
  actions.appendChild(
    ghostButton(
      "tune",
      t("console.schedules.days.configure"),
      openConfigureDaysModal,
    ),
  );
  actions.appendChild(
    ghostButton(
      "content_copy",
      t("console.schedules.copy.button"),
      openCopyScheduleModal,
    ),
  );
  const addBtn = document.createElement("button");
  addBtn.className = "btn btn-primary btn-sm";
  addBtn.type = "button";
  addBtn.id = "btn-sched-add";
  addBtn.innerHTML = `<span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-add"></use></svg></span><span>${escapeHtml(t("console.schedules.editor.addEntry"))}</span>`;
  addBtn.addEventListener("click", () => openScheduleEntryForm());
  actions.appendChild(addBtn);
  toolbar.appendChild(actions);
  wrap.appendChild(toolbar);

  wrap.appendChild(buildScheduleGrid());
  panel.appendChild(wrap);
  panel.appendChild(buildConflictsPanel());
}

/** A labelled <select> for the toolbar. */
function labeledSelect(
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

function ghostButton(icon, label, onClick) {
  const btn = document.createElement("button");
  btn.className = "btn btn-ghost btn-sm";
  btn.type = "button";
  btn.innerHTML = `<span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-${icon}"></use></svg></span><span>${escapeHtml(label)}</span>`;
  btn.addEventListener("click", onClick);
  return btn;
}

/**
 * The week as a grid: active days across the top, time slots down the
 * side. Rows come from the section's own entries plus the chosen bell
 * schedule's blocks, so an empty week laid out with a template still
 * offers every period as a clickable slot.
 */
function buildScheduleGrid() {
  const entries = currentSchedEntries();
  const days = sched.resolveActiveDays(state.scheduleConfig);
  const blocks = state.schedTemplateId
    ? (state.bellBlocks[state.schedTemplateId] ?? [])
    : [];
  const slots = sched.timeSlots([...entries, ...blocks]);

  const grid = document.createElement("div");
  grid.id = "sched-grid";
  grid.className = "sched-grid";
  grid.style.setProperty("--sched-days", String(days.length));

  if (!slots.length) {
    // Same id either way, so callers always have one thing to look at.
    const empty = document.createElement("p");
    empty.id = "sched-grid";
    empty.className = "loading-cell";
    empty.textContent = t("console.schedules.editor.empty");
    return empty;
  }

  const corner = document.createElement("div");
  corner.className = "sched-corner";
  corner.textContent = t("console.schedules.time");
  grid.appendChild(corner);
  days.forEach((day) => {
    const head = document.createElement("div");
    head.className = "sched-head";
    head.textContent = dayLabel(day);
    grid.appendChild(head);
  });

  slots.forEach((slot) => {
    // A break block captions its row and is never a place to put a class.
    const block = blocks.find(
      (b) =>
        sched.normalizeTime(b.start_time) === slot.start &&
        sched.normalizeTime(b.end_time) === slot.end,
    );
    const isBreak = block?.kind === "break";

    const timeCell = document.createElement("div");
    timeCell.className = "sched-time";
    timeCell.innerHTML = `<span>${escapeHtml(slotLabel(slot.start, slot.end))}</span>${
      block ? `<small>${escapeHtml(block.label)}</small>` : ""
    }`;
    grid.appendChild(timeCell);

    days.forEach((day) => {
      const entry = entries.find(
        (e) =>
          e.day_of_week === day &&
          sched.normalizeTime(e.start_time) === slot.start &&
          sched.normalizeTime(e.end_time) === slot.end,
      );
      grid.appendChild(buildScheduleCell({ entry, day, slot, isBreak }));
    });
  });
  return grid;
}

function buildScheduleCell({ entry, day, slot, isBreak }) {
  const cell = document.createElement("div");
  cell.className = "sched-cell";

  if (isBreak && !entry) {
    cell.classList.add("sched-cell-break");
    return cell;
  }

  if (!entry) {
    cell.classList.add("sched-cell-empty");
    const add = document.createElement("button");
    add.type = "button";
    add.className = "sched-add";
    add.setAttribute(
      "aria-label",
      `${t("console.schedules.editor.addEntry")} — ${dayLabel(day)} ${slotLabel(slot.start, slot.end)}`,
    );
    add.innerHTML = `<span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-add"></use></svg></span>`;
    add.addEventListener("click", () =>
      openScheduleEntryForm(null, {
        day_of_week: day,
        start_time: slot.start,
        end_time: slot.end,
      }),
    );
    cell.appendChild(add);
    return cell;
  }

  const subject = state.subjects.find((s) => s.id === entry.subject_id);
  const card = document.createElement("div");
  card.className = "sched-entry";
  if (subject?.color) card.style.setProperty("--subject-color", subject.color);
  card.innerHTML = `
    <button type="button" class="sched-entry-main">
      <strong>${escapeHtml(subjectName(entry.subject_id))}</strong>
      <span>${escapeHtml(teacherName(entry.teacher_id))}</span>
      ${entry.room_id ? `<small>${escapeHtml(roomName(entry.room_id))}</small>` : ""}
    </button>`;
  card
    .querySelector(".sched-entry-main")
    ?.addEventListener("click", () => openScheduleEntryForm(entry));
  card.appendChild(
    iconBtn(
      "delete",
      t("common.delete"),
      () =>
        openConfirm(t("console.schedules.editor.confirmDelete"), async () => {
          await data.deleteSchedule(entry.id);
          showToast(t("console.schedules.editor.deleted"));
          await reloadYearSchedules();
        }),
      true,
    ),
  );
  cell.appendChild(card);
  return cell;
}

/** Everything already clashing in this year — passive, always visible. */
function buildConflictsPanel() {
  const panel = document.createElement("div");
  panel.className = "console-panel";
  const conflicts = sched.findAllConflicts(state.yearSchedules);
  panel.innerHTML = `<div class="panel-head"><h2>${escapeHtml(t("console.schedules.conflicts.title"))}</h2></div>`;
  if (!conflicts.length) {
    panel.insertAdjacentHTML(
      "beforeend",
      `<p class="loading-cell">${escapeHtml(t("console.schedules.conflicts.none"))}</p>`,
    );
    return panel;
  }
  const list = document.createElement("ul");
  list.className = "sched-conflict-list";
  conflicts.forEach((c) => {
    const li = document.createElement("li");
    li.className = "sched-conflict-item";
    // Name the resource, then both sides of the clash.
    li.textContent = `${conflictText({ type: c.type, entry: c.a })} ${conflictText(
      { type: c.type, entry: c.b },
    )}`;
    list.appendChild(li);
  });
  panel.appendChild(list);
  return panel;
}

/** Re-read the year's entries and repaint. */
async function reloadYearSchedules() {
  state.yearSchedules = await data.listYearSchedules(
    state.sections.map((s) => s.id),
  );
  renderSchedulesTab();
}

/**
 * Add or edit one class period.
 * @param {any} [entry] the row being edited, if any
 * @param {any} [prefill] day/time to start from (clicking an empty slot)
 */
function openScheduleEntryForm(entry = null, prefill = null) {
  const section = currentSchedSection();
  if (!section) {
    showToast(t("console.schedules.editor.pickSection"), "error");
    return;
  }
  const days = sched.resolveActiveDays(state.scheduleConfig);
  const source = entry ?? prefill ?? {};

  openModal({
    title: entry
      ? t("console.schedules.editor.editTitle")
      : t("console.schedules.editor.addTitle"),
    fields: [
      {
        name: "day_of_week",
        label: t("console.schedules.day"),
        type: "select",
        required: true,
        value: source.day_of_week ?? days[0],
        options: days.map((d) => ({ value: d, label: dayLabel(d) })),
      },
      {
        name: "start_time",
        label: t("console.schedules.start"),
        type: "time",
        required: true,
        value: sched.normalizeTime(source.start_time),
      },
      {
        name: "end_time",
        label: t("console.schedules.end"),
        type: "time",
        required: true,
        value: sched.normalizeTime(source.end_time),
        rules: [v.endAfterStart("start_time")],
      },
      {
        name: "subject_id",
        label: t("console.schedules.subject"),
        type: "select",
        required: true,
        value: source.subject_id,
        options: optionsFrom(state.subjects, (s) => s.name),
      },
      {
        name: "teacher_id",
        label: t("console.schedules.teacher"),
        type: "select",
        required: true,
        value: source.teacher_id,
        options: optionsFrom(
          state.teachers,
          (tch) => `${tch.first_name} ${tch.last_name}`,
        ),
      },
      {
        name: "room_id",
        label: t("console.schedules.room"),
        type: "select",
        value: source.room_id ?? "",
        options: optionsFrom(state.rooms, (r) => r.name),
      },
    ],
    // The section clashing with itself is rejected inline; a teacher or
    // room clash is confirmed instead (see below), never silently blocked.
    validate: (values) => {
      const candidate = entryFromValues(values, section.id);
      const clashes = sched.findConflicts(candidate, state.yearSchedules, {
        excludeId: entry?.id ?? null,
      });
      const own = clashes.find((c) => c.type === "section");
      return own ? { start_time: conflictText(own) } : {};
    },
    onSubmit: async (values) => {
      const candidate = entryFromValues(values, section.id);
      const warnings = sched
        .findConflicts(candidate, state.yearSchedules, {
          excludeId: entry?.id ?? null,
        })
        .filter((c) => c.type !== "section");

      const write = async () => {
        if (entry) await data.updateSchedule(entry.id, candidate);
        else await data.createSchedule(candidate);
        showToast(
          t(
            entry
              ? "console.schedules.editor.updated"
              : "console.schedules.editor.added",
          ),
        );
        await reloadYearSchedules();
      };

      if (!warnings.length) {
        await write();
        return;
      }
      // Deliberately not a hard stop: co-teaching, assemblies and split
      // rooms are legitimate, so the director gets the facts and decides.
      openConfirm(
        `${t("console.schedules.conflicts.reviewIntro")}\n\n${warnings
          .map(conflictText)
          .join("\n")}`,
        write,
        {
          title: t("console.schedules.conflicts.reviewTitle"),
          confirmLabel: t("console.schedules.conflicts.saveAnyway"),
          danger: false,
        },
      );
    },
  });
}

/** Modal values → a schedules row. */
function entryFromValues(values, classId) {
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

/** Which days the school teaches on — drives the grid's columns. */
function openConfigureDaysModal() {
  const current = sched.resolveActiveDays(state.scheduleConfig);
  openModal({
    title: t("console.schedules.days.title"),
    fields: [
      {
        name: "active_days",
        label: t("console.schedules.days.configure"),
        type: "checkboxes",
        value: current.map(String),
        help: t("console.schedules.days.help"),
        options: sched.ALL_DAYS.map((d) => ({ value: d, label: dayLabel(d) })),
      },
    ],
    validate: (values) =>
      values.active_days?.length
        ? {}
        : { active_days: t("console.schedules.days.atLeastOne") },
    onSubmit: async (values) => {
      const active_days = values.active_days.map(Number).sort((a, b) => a - b);
      if (state.scheduleConfig?.id) {
        await data.updateScheduleConfig(state.scheduleConfig.id, {
          active_days,
        });
        state.scheduleConfig = { ...state.scheduleConfig, active_days };
      } else {
        state.scheduleConfig = await data.createScheduleConfig({
          school_year_id: state.activeYear.id,
          structure_type: "section",
          active_days,
        });
      }
      showToast(t("console.schedules.days.saved"));
      renderSchedulesTab();
    },
  });
}

/** Copy another section's week onto the one being edited. */
function openCopyScheduleModal() {
  const target = currentSchedSection();
  if (!target) {
    showToast(t("console.schedules.copy.needTarget"), "error");
    return;
  }
  const sources = state.sections.filter(
    (s) =>
      s.id !== target.id &&
      state.yearSchedules.some((e) => e.class_id === s.id),
  );
  if (!sources.length) {
    showToast(t("console.schedules.copy.noSource"), "error");
    return;
  }

  openModal({
    title: t("console.schedules.copy.title"),
    submitLabel: t("common.continue"),
    fields: [
      {
        name: "source_id",
        label: t("console.schedules.copy.source"),
        type: "select",
        required: true,
        help: t("console.schedules.copy.help"),
        options: optionsFrom(sources, sectionName),
      },
    ],
    onSubmit: async (values) => {
      const sourceId = Number(values.source_id);
      const plan = sched.copySchedulePlan(
        state.yearSchedules.filter((e) => e.class_id === sourceId),
        target.id,
        state.yearSchedules,
      );
      if (!plan.rows.length) {
        showToast(t("console.schedules.copy.nothing"), "error");
        return;
      }
      // Spell out what will and will not happen before writing anything.
      const lines = [
        t("console.schedules.copy.summary", {
          count: plan.rows.length,
          section: sectionName(target),
        }),
      ];
      if (plan.skipped.length) {
        lines.push(
          t("console.schedules.copy.skipped", {
            count: plan.skipped.length,
            section: sectionName(target),
          }),
        );
      }
      if (plan.conflicts.length) {
        lines.push(
          t("console.schedules.copy.warnings", {
            count: plan.conflicts.length,
          }),
        );
      }
      openConfirm(
        lines.join("\n"),
        async () => {
          await data.bulkInsert("schedules", plan.rows);
          showToast(
            t("console.schedules.copy.done", { count: plan.rows.length }),
          );
          await reloadYearSchedules();
        },
        {
          title: t("console.schedules.copy.title"),
          confirmLabel: t("common.confirm"),
          danger: false,
        },
      );
    },
  });
}

// ── Bell schedules (time-block templates) ──────────────────────
/** Load one template's blocks once, then serve them from state. */
async function ensureBellBlocks(bellId) {
  if (state.bellBlocks[bellId]) return state.bellBlocks[bellId];
  const blocks = await data.listBellBlocks(bellId);
  state.bellBlocks[bellId] = blocks;
  return blocks;
}

async function refreshBellBlocks(bellId) {
  state.bellBlocks[bellId] = await data.listBellBlocks(bellId);
  renderSchedulesTab();
}

function renderBellPanel(panel) {
  const wrap = document.createElement("div");
  wrap.className = "console-panel";
  wrap.innerHTML = `
    <div class="panel-head">
      <div>
        <h2>${escapeHtml(t("console.schedules.templates.title"))}</h2>
        <p class="panel-sub">${escapeHtml(t("console.schedules.templates.subtitle"))}</p>
      </div>
    </div>`;

  const actions = document.createElement("div");
  actions.className = "panel-actions";
  const add = document.createElement("button");
  add.className = "btn btn-primary btn-sm";
  add.type = "button";
  add.id = "btn-add-bell";
  add.innerHTML = `<span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-add"></use></svg></span><span>${escapeHtml(t("console.schedules.templates.add"))}</span>`;
  add.addEventListener("click", () => openBellForm());
  actions.appendChild(add);
  wrap.querySelector(".panel-head")?.appendChild(actions);

  const scroll = document.createElement("div");
  scroll.className = "table-scroll";
  const table = document.createElement("table");
  table.className = "data-table";
  table.innerHTML = `<thead><tr>
      <th>${escapeHtml(t("console.schedules.templates.name"))}</th>
      <th>${escapeHtml(t("console.schedules.templates.blocks"))}</th>
      <th class="actions-col"></th>
    </tr></thead>`;
  const tbody = document.createElement("tbody");
  tbody.id = "bell-body";

  if (!state.bellSchedules.length) {
    tbody.innerHTML = `<tr><td colspan="3" class="loading-cell">${escapeHtml(t("console.schedules.templates.empty"))}</td></tr>`;
  } else {
    state.bellSchedules.forEach((bell) => {
      const count = state.bellBlocks[bell.id]?.length;
      tbody.appendChild(
        tableRow(
          [
            escapeHtml(bell.name),
            count == null ? "—" : escapeHtml(String(count)),
          ],
          [
            iconBtn(
              "list_alt",
              t("console.schedules.templates.blocks"),
              async () => {
                state.schedBellId = bell.id;
                await ensureBellBlocks(bell.id);
                renderSchedulesTab();
              },
            ),
            iconBtn("edit", t("common.edit"), () => openBellForm(bell)),
            iconBtn(
              "delete",
              t("common.delete"),
              () =>
                openConfirm(
                  t("console.schedules.templates.confirmDelete"),
                  async () => {
                    await data.deleteBellSchedule(bell.id);
                    delete state.bellBlocks[bell.id];
                    if (state.schedBellId === bell.id) state.schedBellId = null;
                    if (state.schedTemplateId === bell.id)
                      state.schedTemplateId = null;
                    state.bellSchedules = await data.listBellSchedules();
                    showToast(t("common.deleted"));
                    renderSchedulesTab();
                  },
                ),
              true,
            ),
          ],
          bell.id,
        ),
      );
    });
  }
  table.appendChild(tbody);
  scroll.appendChild(table);
  wrap.appendChild(scroll);
  panel.appendChild(wrap);

  const selected = state.bellSchedules.find((b) => b.id === state.schedBellId);
  if (selected) panel.appendChild(buildBlocksPanel(selected));
}

function openBellForm(bell = null) {
  openModal({
    title: bell
      ? t("console.schedules.templates.editTitle")
      : t("console.schedules.templates.addTitle"),
    fields: [
      {
        name: "name",
        maxLength: 80,
        label: t("console.schedules.templates.name"),
        required: true,
        value: bell?.name ?? "",
        rules: [
          v.unique(
            state.bellSchedules.map((b) => b.name),
            { current: bell?.name },
          ),
        ],
      },
    ],
    onSubmit: async (values) => {
      if (bell) await data.updateBellSchedule(bell.id, { name: values.name });
      else {
        const created = await data.createBellSchedule({ name: values.name });
        state.schedBellId = created?.id ?? null;
        markSaved("bell-body", created?.id);
      }
      state.bellSchedules = await data.listBellSchedules();
      showToast(t("common.saved"));
      renderSchedulesTab();
    },
  });
}

/** The blocks of one bell schedule, in running order. */
function buildBlocksPanel(bell) {
  const blocks = state.bellBlocks[bell.id] ?? [];
  const panel = document.createElement("div");
  panel.className = "console-panel";
  panel.innerHTML = `
    <div class="panel-head">
      <div>
        <h2>${escapeHtml(bell.name)}</h2>
        <p class="panel-sub">${escapeHtml(t("console.schedules.templates.blocks"))}</p>
      </div>
    </div>`;
  const actions = document.createElement("div");
  actions.className = "panel-actions";
  const add = document.createElement("button");
  add.className = "btn btn-primary btn-sm";
  add.type = "button";
  add.id = "btn-add-block";
  add.innerHTML = `<span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-add"></use></svg></span><span>${escapeHtml(t("console.schedules.templates.addBlock"))}</span>`;
  add.addEventListener("click", () => openBlockForm(bell));
  actions.appendChild(add);
  panel.querySelector(".panel-head")?.appendChild(actions);

  const scroll = document.createElement("div");
  scroll.className = "table-scroll";
  const table = document.createElement("table");
  table.className = "data-table";
  table.innerHTML = `<thead><tr>
      <th>${escapeHtml(t("console.schedules.templates.order"))}</th>
      <th>${escapeHtml(t("console.schedules.templates.label"))}</th>
      <th>${escapeHtml(t("console.schedules.templates.kind"))}</th>
      <th>${escapeHtml(t("console.schedules.time"))}</th>
      <th class="actions-col"></th>
    </tr></thead>`;
  const tbody = document.createElement("tbody");
  tbody.id = "bell-blocks-body";
  if (!blocks.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="loading-cell">${escapeHtml(t("console.schedules.templates.blocksEmpty"))}</td></tr>`;
  } else {
    blocks.forEach((block) => {
      tbody.appendChild(
        tableRow(
          [
            escapeHtml(String(block.block_order)),
            escapeHtml(block.label),
            escapeHtml(
              t(
                block.kind === "break"
                  ? "console.schedules.templates.kindBreak"
                  : "console.schedules.templates.kindClass",
              ),
            ),
            escapeHtml(slotLabel(block.start_time, block.end_time)),
          ],
          [
            iconBtn("edit", t("common.edit"), () => openBlockForm(bell, block)),
            iconBtn(
              "delete",
              t("common.delete"),
              () =>
                openConfirm(
                  t("console.schedules.templates.confirmDeleteBlock"),
                  async () => {
                    await data.deleteBellBlock(block.id);
                    showToast(t("common.deleted"));
                    await refreshBellBlocks(bell.id);
                  },
                ),
              true,
            ),
          ],
          block.id,
        ),
      );
    });
  }
  table.appendChild(tbody);
  scroll.appendChild(table);
  panel.appendChild(scroll);
  return panel;
}

function openBlockForm(bell, block = null) {
  const blocks = state.bellBlocks[bell.id] ?? [];
  const nextOrder = blocks.length
    ? Math.max(...blocks.map((b) => Number(b.block_order) || 0)) + 1
    : 1;

  openModal({
    title: block
      ? t("console.schedules.templates.editBlockTitle")
      : t("console.schedules.templates.addBlockTitle"),
    fields: [
      {
        name: "label",
        label: t("console.schedules.templates.label"),
        required: true,
        value: block?.label ?? "",
      },
      {
        name: "kind",
        label: t("console.schedules.templates.kind"),
        type: "select",
        required: true,
        value: block?.kind ?? "class",
        options: [
          { value: "class", label: t("console.schedules.templates.kindClass") },
          { value: "break", label: t("console.schedules.templates.kindBreak") },
        ],
      },
      {
        name: "block_order",
        label: t("console.schedules.templates.order"),
        type: "number",
        required: true,
        min: 1,
        value: block?.block_order ?? nextOrder,
        rules: [v.integer(), v.min(1)],
      },
      {
        name: "start_time",
        label: t("console.schedules.start"),
        type: "time",
        required: true,
        value: sched.normalizeTime(block?.start_time),
      },
      {
        name: "end_time",
        label: t("console.schedules.end"),
        type: "time",
        required: true,
        value: sched.normalizeTime(block?.end_time),
        rules: [v.endAfterStart("start_time")],
      },
    ],
    // Validate the block against the template it is joining, so an overlap
    // or a repeated order is caught before the unique constraint fires.
    validate: (values) => {
      const others = blocks.filter((b) => b.id !== block?.id);
      const errors = sched.validateBlocks([...others, values]);
      const problem = errors[others.length];
      if (problem === "overlap")
        return { start_time: t("console.schedules.templates.overlap") };
      if (problem === "duplicateOrder")
        return { block_order: t("console.schedules.templates.duplicateOrder") };
      return {};
    },
    onSubmit: async (values) => {
      const row = {
        bell_schedule_id: bell.id,
        label: values.label,
        kind: values.kind,
        block_order: Number(values.block_order),
        start_time: values.start_time,
        end_time: values.end_time,
      };
      if (block) await data.updateBellBlock(block.id, row);
      else markSaved("bell-blocks-body", (await data.createBellBlock(row))?.id);
      showToast(t("common.saved"));
      await refreshBellBlocks(bell.id);
    },
  });
}

// ── CSV import (generic, descriptor-driven) ────────────────────
// One import wizard drives every structure table. Each entity is a
// descriptor: which fields to map (+ header aliases), how to turn a mapped
// row into a DB payload (resolving foreign keys by name), which fields must
// be unique, and how to preview + reload. Students keep an optional
// "enroll into section" target; sections/periods bind to the active year.
const importOverlay = document.getElementById("import-overlay");
const importBody = document.getElementById("import-body");
const importFooter = document.getElementById("import-footer");

// ── name→id resolvers ─────────────────────────────────────────
function resolveGradeLevel(raw) {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase();
  const n = Number(raw);
  return (
    state.gradeLevels.find(
      (g) =>
        (!Number.isNaN(n) && s !== "" && g.numeric_level === n) ||
        g.name.toLowerCase() === s,
    ) ?? null
  );
}
function resolveTeacherId(raw) {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (!s) return null;
  const tch = state.teachers.find(
    (x) =>
      (x.email && x.email.toLowerCase() === s) ||
      `${x.first_name} ${x.last_name}`.toLowerCase() === s,
  );
  return tch ? tch.id : null;
}
function resolveRoomId(raw) {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (!s) return null;
  const r = state.rooms.find((x) => x.name.toLowerCase() === s);
  return r ? r.id : null;
}

const REQ = (key) => t("console.import.errRequired", { field: t(key) });

// ── Entity descriptors ─────────────────────────────────────────
const IMPORT_DESCRIPTORS = {
  students: {
    table: "students",
    titleKey: "console.import.entity.students",
    reload: () => loadStudents(),
    targetSection: true,
    uniqueFields: ["enrollment_number"],
    autogen: {
      field: "enrollment_number",
      make: (i) =>
        `S-${Date.now().toString(36)}-${i}-${Math.floor(Math.random() * 1e4)}`,
    },
    existing: () => state.students,
    fields: [
      {
        key: "first_name",
        labelKey: "console.students.firstName",
        required: true,
        aliases: ["first name", "firstname", "nombre", "nombres", "given name"],
      },
      {
        key: "last_name",
        labelKey: "console.students.lastName",
        required: true,
        aliases: ["last name", "lastname", "apellido", "apellidos", "surname"],
      },
      {
        key: "enrollment_number",
        labelKey: "console.students.enrollmentNumber",
        aliases: [
          "enrollment number",
          "enrollment",
          "matricula",
          "matrícula",
          "student id",
          "studentid",
          "carnet",
          "id",
        ],
      },
      {
        key: "national_id",
        labelKey: "console.students.nationalId",
        aliases: ["national id", "nationalid", "cedula", "cédula", "dni"],
      },
      {
        key: "gender",
        labelKey: "console.students.gender",
        aliases: ["gender", "sex", "genero", "género", "sexo"],
      },
      {
        key: "date_of_birth",
        labelKey: "console.students.dateOfBirth",
        aliases: [
          "date of birth",
          "dob",
          "birthdate",
          "fecha de nacimiento",
          "nacimiento",
        ],
      },
      {
        key: "email",
        labelKey: "console.students.email",
        aliases: ["email", "correo", "e-mail", "mail"],
      },
      {
        key: "phone",
        labelKey: "console.students.phone",
        aliases: ["phone", "telefono", "teléfono", "celular", "mobile", "tel"],
      },
    ],
    async prepare() {
      if (!state.students.length) state.students = await data.listStudents();
      await ensureActiveYear();
      if (state.activeYear)
        state.sections = await data.listSections(state.activeYear.id);
      if (!state.gradeLevels.length)
        state.gradeLevels = await data.listGradeLevels();
      return { ok: true, ctx: {} };
    },
    resolve(get, ctx) {
      const first = get("first_name");
      const last = get("last_name");
      if (!first || !last) return { error: t("console.import.errMissingName") };
      return {
        payload: {
          first_name: first,
          last_name: last,
          enrollment_number: get("enrollment_number") || null,
          national_id: get("national_id") || null,
          gender: coerceGender(get("gender")),
          date_of_birth: coerceDate(get("date_of_birth")),
          email: get("email") || null,
          phone: get("phone") || null,
          class_id: ctx.targetSection ?? null,
          status: "active",
        },
      };
    },
    previewCols: [
      {
        labelKey: "console.students.name",
        get: (p) => `${p.first_name} ${p.last_name}`,
      },
      {
        labelKey: "console.students.enrollmentNumber",
        get: (p) => p.enrollment_number,
      },
      {
        labelKey: "console.students.gender",
        get: (p) => genderLabel(p.gender),
      },
    ],
  },

  teachers: {
    table: "teachers",
    titleKey: "console.import.entity.teachers",
    reload: () => loadTeachers(),
    uniqueFields: ["national_id", "email"],
    existing: () => state.teachers,
    fields: [
      {
        key: "first_name",
        labelKey: "console.teachers.firstName",
        required: true,
        aliases: ["first name", "firstname", "nombre", "nombres"],
      },
      {
        key: "last_name",
        labelKey: "console.teachers.lastName",
        required: true,
        aliases: ["last name", "lastname", "apellido", "apellidos"],
      },
      {
        key: "national_id",
        labelKey: "console.teachers.nationalId",
        aliases: ["national id", "cedula", "cédula", "dni", "id"],
      },
      {
        key: "email",
        labelKey: "console.teachers.email",
        aliases: ["email", "correo", "e-mail", "mail"],
      },
      {
        key: "phone",
        labelKey: "console.teachers.phone",
        aliases: ["phone", "telefono", "teléfono", "celular"],
      },
      {
        key: "specialization",
        labelKey: "console.teachers.specialization",
        aliases: [
          "specialization",
          "especializacion",
          "especialización",
          "subject",
          "area",
        ],
      },
      {
        key: "status",
        labelKey: "console.teachers.status",
        aliases: ["status", "estado"],
      },
    ],
    async prepare() {
      await ensureTeachers();
      return { ok: true, ctx: {} };
    },
    resolve(get) {
      const first = get("first_name");
      const last = get("last_name");
      if (!first || !last) return { error: t("console.import.errMissingName") };
      return {
        payload: {
          first_name: first,
          last_name: last,
          national_id: get("national_id") || null,
          email: get("email") || null,
          phone: get("phone") || null,
          specialization: get("specialization") || null,
          status: coerceEnum(get("status"), TEACHER_STATUSES, "active"),
        },
      };
    },
    previewCols: [
      {
        labelKey: "console.teachers.name",
        get: (p) => `${p.first_name} ${p.last_name}`,
      },
      { labelKey: "console.teachers.email", get: (p) => p.email ?? "—" },
      {
        labelKey: "console.teachers.specialization",
        get: (p) => p.specialization ?? "—",
      },
    ],
  },

  subjects: {
    table: "subjects",
    titleKey: "console.import.entity.subjects",
    reload: () => loadSubjects(),
    uniqueFields: ["name", "code"],
    existing: () => state.subjects,
    fields: [
      {
        key: "name",
        labelKey: "console.subjects.name",
        required: true,
        aliases: ["name", "nombre", "subject", "materia"],
      },
      {
        key: "code",
        labelKey: "console.subjects.code",
        aliases: ["code", "codigo", "código", "abbr"],
      },
      {
        key: "color",
        labelKey: "console.subjects.color",
        aliases: ["color", "colour"],
      },
      {
        key: "description",
        labelKey: "console.subjects.description",
        aliases: ["description", "descripcion", "descripción"],
      },
    ],
    async prepare() {
      if (!state.subjects.length) state.subjects = await data.listSubjects();
      return { ok: true, ctx: {} };
    },
    resolve(get) {
      const name = get("name");
      if (!name) return { error: REQ("console.subjects.name") };
      const color = get("color");
      return {
        payload: {
          name,
          code: get("code") || null,
          color: /^#?[0-9a-fA-F]{6}$/.test(color)
            ? color.startsWith("#")
              ? color
              : `#${color}`
            : null,
          description: get("description") || null,
        },
      };
    },
    previewCols: [
      { labelKey: "console.subjects.name", get: (p) => p.name },
      { labelKey: "console.subjects.code", get: (p) => p.code ?? "—" },
    ],
  },

  gradeLevels: {
    table: "grade_levels",
    titleKey: "console.import.entity.gradeLevels",
    reload: () => loadGradeLevels(),
    uniqueFields: ["name", "numeric_level"],
    existing: () => state.gradeLevels,
    fields: [
      {
        key: "numeric_level",
        labelKey: "console.grades.level",
        required: true,
        aliases: ["level", "numeric level", "nivel", "grade", "grado"],
      },
      {
        key: "name",
        labelKey: "console.grades.name",
        required: true,
        aliases: ["name", "nombre", "grade name", "grado"],
      },
    ],
    async prepare() {
      await ensureGradeLevels();
      return { ok: true, ctx: {} };
    },
    resolve(get) {
      const name = get("name");
      const level = coerceInt(get("numeric_level"));
      if (!name) return { error: REQ("console.grades.name") };
      if (level == null) return { error: REQ("console.grades.level") };
      return { payload: { name, numeric_level: level } };
    },
    previewCols: [
      { labelKey: "console.grades.level", get: (p) => p.numeric_level },
      { labelKey: "console.grades.name", get: (p) => p.name },
    ],
  },

  rooms: {
    table: "rooms",
    titleKey: "console.import.entity.rooms",
    reload: () => loadRooms(),
    uniqueFields: ["name"],
    existing: () => state.rooms,
    fields: [
      {
        key: "name",
        labelKey: "console.rooms.name",
        required: true,
        aliases: ["name", "nombre", "room", "aula"],
      },
      {
        key: "capacity",
        labelKey: "console.rooms.capacity",
        aliases: ["capacity", "capacidad", "seats"],
      },
      {
        key: "type",
        labelKey: "console.rooms.type",
        aliases: ["type", "tipo", "kind"],
      },
    ],
    async prepare() {
      await ensureRooms();
      return { ok: true, ctx: {} };
    },
    resolve(get) {
      const name = get("name");
      if (!name) return { error: REQ("console.rooms.name") };
      return {
        payload: {
          name,
          capacity: coerceInt(get("capacity")),
          type: coerceEnum(get("type"), ROOM_TYPES, "classroom"),
        },
      };
    },
    previewCols: [
      { labelKey: "console.rooms.name", get: (p) => p.name },
      { labelKey: "console.rooms.capacity", get: (p) => p.capacity ?? "—" },
      {
        labelKey: "console.rooms.type",
        get: (p) => t(`console.rooms.types.${p.type}`),
      },
    ],
  },

  schoolYears: {
    table: "school_years",
    titleKey: "console.import.entity.schoolYears",
    reload: () => loadYearPeriods(),
    uniqueFields: ["name"],
    existing: () => state.schoolYears,
    fields: [
      {
        key: "name",
        labelKey: "console.years.name",
        required: true,
        aliases: ["name", "nombre", "year", "año", "ciclo"],
      },
      {
        key: "start_date",
        labelKey: "console.years.start",
        required: true,
        aliases: ["start", "start date", "inicio", "fecha inicio"],
      },
      {
        key: "end_date",
        labelKey: "console.years.end",
        required: true,
        aliases: ["end", "end date", "fin", "fecha fin"],
      },
    ],
    async prepare() {
      await ensureSchoolYears();
      return { ok: true, ctx: {} };
    },
    resolve(get) {
      const name = get("name");
      if (!name) return { error: REQ("console.years.name") };
      const start = coerceDate(get("start_date"));
      const end = coerceDate(get("end_date"));
      if (!start || !end) return { error: t("console.import.errDates") };
      // Never activate on import — the admin sets the active year in the UI.
      return {
        payload: { name, start_date: start, end_date: end, is_active: false },
      };
    },
    previewCols: [
      { labelKey: "console.years.name", get: (p) => p.name },
      { labelKey: "console.years.start", get: (p) => fmtDate(p.start_date) },
      { labelKey: "console.years.end", get: (p) => fmtDate(p.end_date) },
    ],
  },

  gradingPeriods: {
    table: "grading_periods",
    titleKey: "console.import.entity.gradingPeriods",
    reload: () => loadYearPeriods(),
    uniqueFields: ["period_order"],
    existing: () => state._importPeriods ?? [],
    fields: [
      {
        key: "period_order",
        labelKey: "console.periods.order",
        required: true,
        aliases: ["order", "period", "número", "numero", "orden", "#"],
      },
      {
        key: "name",
        labelKey: "console.periods.name",
        required: true,
        aliases: ["name", "nombre", "period name"],
      },
      {
        key: "start_date",
        labelKey: "console.periods.start",
        required: true,
        aliases: ["start", "start date", "inicio"],
      },
      {
        key: "end_date",
        labelKey: "console.periods.end",
        required: true,
        aliases: ["end", "end date", "fin"],
      },
      {
        key: "weight",
        labelKey: "console.periods.weight",
        aliases: ["weight", "peso", "percent", "porcentaje"],
      },
    ],
    async prepare() {
      await ensureActiveYear();
      if (!state.activeYear)
        return { ok: false, error: t("console.periods.noYear") };
      state._importPeriods = await data.listPeriods(state.activeYear.id);
      return { ok: true, ctx: { activeYear: state.activeYear } };
    },
    resolve(get, ctx) {
      const name = get("name");
      const order = coerceInt(get("period_order"));
      if (order == null) return { error: REQ("console.periods.order") };
      if (!name) return { error: REQ("console.periods.name") };
      const start = coerceDate(get("start_date"));
      const end = coerceDate(get("end_date"));
      if (!start || !end) return { error: t("console.import.errDates") };
      return {
        payload: {
          name,
          period_order: order,
          start_date: start,
          end_date: end,
          weight: coerceNum(get("weight")) ?? 50,
          school_year_id: ctx.activeYear.id,
        },
      };
    },
    previewCols: [
      { labelKey: "console.periods.order", get: (p) => p.period_order },
      { labelKey: "console.periods.name", get: (p) => p.name },
    ],
  },

  sections: {
    table: "classes",
    titleKey: "console.import.entity.sections",
    reload: () => loadSections(),
    // Composite unique (grade + section within the active year).
    dedupKey: (p) => `${p.grade_level_id}|${p.section.toLowerCase()}`,
    existingKeys: () =>
      new Set(
        state.sections.map(
          (s) => `${s.grade_level_id}|${String(s.section).toLowerCase()}`,
        ),
      ),
    dupErrorKey: "console.import.errDupSection",
    fields: [
      {
        key: "grade",
        labelKey: "console.sections.grade",
        required: true,
        aliases: ["grade", "grade level", "grado", "nivel", "level"],
      },
      {
        key: "section",
        labelKey: "console.sections.section",
        required: true,
        aliases: ["section", "seccion", "sección", "group", "grupo"],
      },
      {
        key: "homeroom",
        labelKey: "console.sections.homeroom",
        aliases: [
          "homeroom",
          "homeroom teacher",
          "guia",
          "guía",
          "teacher",
          "docente",
        ],
      },
      {
        key: "room",
        labelKey: "console.sections.room",
        aliases: ["room", "aula", "classroom"],
      },
      {
        key: "max_capacity",
        labelKey: "console.sections.capacity",
        aliases: ["capacity", "max capacity", "capacidad", "cupo"],
      },
    ],
    async prepare() {
      await ensureActiveYear();
      if (!state.activeYear)
        return { ok: false, error: t("console.sections.noYear") };
      await ensureGradeLevels();
      if (!state.gradeLevels.length)
        return { ok: false, error: t("console.sections.needGrade") };
      await ensureTeachers();
      await ensureRooms();
      state.sections = await data.listSections(state.activeYear.id);
      return { ok: true, ctx: { activeYear: state.activeYear } };
    },
    resolve(get, ctx) {
      const sectionCode = get("section");
      const gradeRaw = get("grade");
      if (!sectionCode) return { error: REQ("console.sections.section") };
      if (!gradeRaw) return { error: REQ("console.sections.grade") };
      const gl = resolveGradeLevel(gradeRaw);
      if (!gl)
        return {
          error: t("console.import.errUnknownGrade", { value: gradeRaw }),
        };
      return {
        payload: {
          grade_level_id: gl.id,
          section: sectionCode,
          display_name: `${gl.numeric_level}${sectionCode}`,
          homeroom_teacher_id: resolveTeacherId(get("homeroom")),
          room_id: resolveRoomId(get("room")),
          max_capacity: coerceInt(get("max_capacity")) ?? 30,
          school_year_id: ctx.activeYear.id,
        },
      };
    },
    previewCols: [
      {
        labelKey: "console.sections.grade",
        get: (p) => gradeName(p.grade_level_id),
      },
      { labelKey: "console.sections.section", get: (p) => p.section },
      {
        labelKey: "console.sections.homeroom",
        get: (p) =>
          p.homeroom_teacher_id ? teacherName(p.homeroom_teacher_id) : "—",
      },
    ],
  },
};

let importCtx = null;

async function openImportModal(key) {
  const descriptor = IMPORT_DESCRIPTORS[key];
  if (!descriptor) return;
  let prep;
  try {
    prep = await descriptor.prepare();
  } catch (err) {
    showToast(errorText(err), "error");
    return;
  }
  if (!prep.ok) {
    showToast(prep.error, "error");
    return;
  }
  importCtx = {
    descriptor,
    ctx: prep.ctx ?? {},
    text: "",
    targetSection: "",
    parsed: null,
    mapping: null,
  };
  document.getElementById("import-title").textContent = t(descriptor.titleKey);
  importOverlay.classList.add("active");
  renderImportSource();
}

function closeImportModal() {
  importOverlay.classList.remove("active");
  importBody.innerHTML = "";
  importFooter.innerHTML = "";
  importCtx = null;
}

function importFooterButtons(buttons) {
  importFooter.innerHTML = "";
  buttons.forEach(({ label, kind, onClick, disabled }) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `btn ${kind}`;
    b.textContent = label;
    if (disabled) b.disabled = true;
    else b.addEventListener("click", onClick);
    importFooter.appendChild(b);
  });
}

// Step 1 — paste or upload; students also pick an optional target section.
function renderImportSource() {
  const d = importCtx.descriptor;
  const placeholder = d.fields.map((f) => f.key).join(",");
  const sectionBlock = d.targetSection
    ? `<div class="field-group">
         <label for="import-section">${escapeHtml(t("console.import.targetSection"))}</label>
         <select id="import-section">
           <option value="">${escapeHtml(t("console.import.noSection"))}</option>
           ${state.sections.map((s) => `<option value="${s.id}"${String(s.id) === String(importCtx.targetSection) ? " selected" : ""}>${escapeHtml(sectionName(s))}</option>`).join("")}
         </select>
       </div>`
    : "";

  importBody.innerHTML = `
    <p class="import-help">${escapeHtml(t("console.import.sourceHelp"))}</p>
    <div class="field-group">
      <label for="import-file">${escapeHtml(t("console.import.chooseFile"))}</label>
      <input type="file" id="import-file" accept=".csv,.tsv,.txt,text/csv" />
    </div>
    <div class="field-group">
      <label for="import-text">${escapeHtml(t("console.import.orPaste"))}</label>
      <textarea id="import-text" rows="6" placeholder="${escapeHtml(placeholder)}">${escapeHtml(importCtx.text)}</textarea>
    </div>
    ${sectionBlock}`;

  const fileInput = /** @type {HTMLInputElement} */ (
    document.getElementById("import-file")
  );
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    const text = await file.text();
    /** @type {HTMLTextAreaElement} */ (
      document.getElementById("import-text")
    ).value = text;
  });

  importFooterButtons([
    { label: t("common.cancel"), kind: "btn-ghost", onClick: closeImportModal },
    {
      label: t("console.import.next"),
      kind: "btn-primary",
      onClick: () => {
        importCtx.text = /** @type {HTMLTextAreaElement} */ (
          document.getElementById("import-text")
        ).value;
        if (d.targetSection) {
          importCtx.targetSection = /** @type {HTMLSelectElement} */ (
            document.getElementById("import-section")
          ).value;
        }
        const parsed = parseCsv(importCtx.text);
        if (!parsed.headers.length || !parsed.rows.length) {
          showToast(t("console.import.noData"), "error");
          return;
        }
        importCtx.parsed = parsed;
        const aliasMap = Object.fromEntries(
          d.fields.map((f) => [f.key, f.aliases ?? [f.key]]),
        );
        importCtx.mapping = autoMap(parsed.headers, aliasMap);
        renderImportMapping();
      },
    },
  ]);
}

// Step 2 — map each target field to a source column.
function renderImportMapping() {
  const d = importCtx.descriptor;
  const { headers, rows } = importCtx.parsed;
  const rowsHtml = d.fields
    .map((f) => {
      const opts = [
        `<option value="">${escapeHtml(t("common.none"))}</option>`,
        ...headers.map(
          (h) =>
            `<option value="${escapeHtml(h)}"${importCtx.mapping[f.key] === h ? " selected" : ""}>${escapeHtml(h)}</option>`,
        ),
      ].join("");
      return `<div class="map-row">
        <span class="map-label">${escapeHtml(t(f.labelKey))}${f.required ? ' <b class="req">*</b>' : ""}</span>
        <select data-field="${f.key}">${opts}</select>
      </div>`;
    })
    .join("");

  importBody.innerHTML = `
    <p class="import-help">${escapeHtml(t("console.import.mapHelp", { count: rows.length }))}</p>
    <div class="map-grid">${rowsHtml}</div>`;

  importBody.querySelectorAll("select[data-field]").forEach((sel) => {
    sel.addEventListener("change", (e) => {
      const el = /** @type {HTMLSelectElement} */ (e.target);
      importCtx.mapping[el.dataset.field] = el.value;
    });
  });

  importFooterButtons([
    {
      label: t("console.import.back"),
      kind: "btn-ghost",
      onClick: renderImportSource,
    },
    {
      label: t("console.import.preview"),
      kind: "btn-primary",
      onClick: renderImportPreview,
    },
  ]);
}

// Build normalized payloads + validation report from the current mapping.
function buildImportRows() {
  const d = importCtx.descriptor;
  const { rows } = importCtx.parsed;
  const map = importCtx.mapping;
  const rowGet = (row) => (key) =>
    map[key] ? (row[map[key]] ?? "").trim() : "";
  const ctx = { ...importCtx.ctx };
  if (d.targetSection)
    ctx.targetSection = importCtx.targetSection
      ? Number(importCtx.targetSection)
      : null;

  const uniqueFields = d.uniqueFields ?? [];
  const existingSets = {};
  const seen = {};
  uniqueFields.forEach((uf) => {
    existingSets[uf] = new Set(
      (d.existing?.() ?? [])
        .map((r) => r[uf])
        .filter((v) => v != null && v !== "")
        .map(String),
    );
    seen[uf] = new Set();
  });
  const existingKeys = d.existingKeys ? d.existingKeys() : null;
  const seenKeys = new Set();

  const valid = [];
  const errors = [];

  rows.forEach((row, i) => {
    const line = i + 2; // 1-based + header row
    const res = d.resolve(rowGet(row), ctx);
    if (res.error) {
      errors.push({ line, reason: res.error });
      return;
    }
    const p = res.payload;

    // Auto-generate a value where the source left a unique field blank.
    if (d.autogen) {
      const f = d.autogen.field;
      if (p[f] == null || p[f] === "") {
        let v;
        do {
          v = d.autogen.make(valid.length);
        } while (existingSets[f]?.has(String(v)) || seen[f]?.has(String(v)));
        p[f] = v;
      }
    }

    // Per-field uniqueness.
    let dup = false;
    for (const uf of uniqueFields) {
      const v = p[uf];
      if (v == null || v === "") continue;
      if (existingSets[uf].has(String(v)) || seen[uf].has(String(v))) {
        const label = d.fields.find((f) => f.key === uf)?.labelKey;
        errors.push({
          line,
          reason: t("console.import.errDuplicate", {
            field: label ? t(label) : uf,
            value: v,
          }),
        });
        dup = true;
        break;
      }
    }
    if (dup) return;

    // Composite uniqueness (e.g., grade+section).
    if (existingKeys) {
      const k = d.dedupKey(p);
      if (existingKeys.has(k) || seenKeys.has(k)) {
        errors.push({ line, reason: t(d.dupErrorKey) });
        return;
      }
      seenKeys.add(k);
    }

    uniqueFields.forEach((uf) => {
      if (p[uf] != null && p[uf] !== "") seen[uf].add(String(p[uf]));
    });
    valid.push(p);
  });
  return { valid, errors };
}

// Step 3 — preview valid rows + validation summary, then import.
function renderImportPreview() {
  const d = importCtx.descriptor;
  const { valid, errors } = buildImportRows();
  const preview = valid.slice(0, 8);
  const headHtml = d.previewCols
    .map((c) => `<th>${escapeHtml(t(c.labelKey))}</th>`)
    .join("");
  const previewRows = preview
    .map(
      (p) =>
        `<tr>${d.previewCols.map((c) => `<td>${escapeHtml(c.get(p) ?? "—")}</td>`).join("")}</tr>`,
    )
    .join("");
  const errorList = errors
    .slice(0, 8)
    .map(
      (e) =>
        `<li>${escapeHtml(t("console.import.lineLabel", { line: e.line }))}: ${escapeHtml(e.reason)}</li>`,
    )
    .join("");

  importBody.innerHTML = `
    <div class="import-summary">
      <span class="badge badge-success">${escapeHtml(t("console.import.willImport", { count: valid.length }))}</span>
      ${errors.length ? `<span class="badge badge-warning">${escapeHtml(t("console.import.willSkip", { count: errors.length }))}</span>` : ""}
    </div>
    ${
      valid.length
        ? `<div class="table-scroll"><table class="data-table">
            <thead><tr>${headHtml}</tr></thead><tbody>${previewRows}</tbody></table></div>
           ${valid.length > preview.length ? `<p class="import-help">${escapeHtml(t("console.import.andMore", { count: valid.length - preview.length }))}</p>` : ""}`
        : `<p class="import-help">${escapeHtml(t("console.import.nothingValid"))}</p>`
    }
    ${errors.length ? `<div class="import-errors"><h3>${escapeHtml(t("console.import.skippedRows"))}</h3><ul>${errorList}</ul>${errors.length > 8 ? `<p class="import-help">${escapeHtml(t("console.import.andMore", { count: errors.length - 8 }))}</p>` : ""}</div>` : ""}`;

  importFooterButtons([
    {
      label: t("console.import.back"),
      kind: "btn-ghost",
      onClick: renderImportMapping,
    },
    {
      label: t("console.import.doImport", { count: valid.length }),
      kind: "btn-primary",
      disabled: valid.length === 0,
      onClick: async () => {
        try {
          await data.bulkInsert(d.table, valid);
          showToast(t("console.import.done", { count: valid.length }));
          closeImportModal();
          d.reload();
        } catch (err) {
          showToast(errorText(err), "error");
        }
      },
    },
  ]);
}

// Wire every section's "Import CSV" button to its descriptor.
const IMPORT_BUTTONS = {
  "btn-import-csv": "students",
  "btn-import-teachers": "teachers",
  "btn-import-subjects": "subjects",
  "btn-import-grades": "gradeLevels",
  "btn-import-rooms": "rooms",
  "btn-import-sections": "sections",
  "btn-import-years": "schoolYears",
  "btn-import-periods": "gradingPeriods",
};
Object.entries(IMPORT_BUTTONS).forEach(([id, key]) => {
  document
    .getElementById(id)
    ?.addEventListener("click", () => openImportModal(key));
});
// Backdrop clicks are ignored here too — a pasted roster and its column
// mapping are exactly the kind of work a stray click used to destroy.
document
  .getElementById("import-close")
  .addEventListener("click", closeImportModal);

// Focus trap, Escape, focus-in on open and focus-back-to-trigger on close.
// The form and confirm dialogs register themselves in their own modules.
registerDialog(importOverlay, { close: closeImportModal });

// ───────────────────────────────────────────────────────────────
//  INIT
// ───────────────────────────────────────────────────────────────
if (DEMO_MODE) {
  const logo = document.querySelector("aside .logo");
  if (logo) {
    const badge = document.createElement("span");
    badge.className = "demo-badge";
    badge.dataset.i18n = "admin.demo.badge";
    badge.dataset.i18nTitle = "admin.demo.sandboxNotice";
    badge.textContent = t("admin.demo.badge");
    badge.title = t("admin.demo.sandboxNotice");
    logo.appendChild(badge);
  }
}

// Read the school profile up front: the ID-field label it carries is needed by
// the teachers/students tables and their create forms, whichever loads first.
loadSchoolSettings().then(applyIdLabels);

loadOverview();
showSection("overview");
