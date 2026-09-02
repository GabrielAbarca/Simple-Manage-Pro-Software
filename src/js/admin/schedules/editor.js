// ─────────────────────────────────────────────────────────────────
//  editor.js — the weekly editor sub-tab: one section's week as a
//  grid, with a bell schedule optionally laying out the rows, plus the
//  always-visible list of everything already clashing this year.
//  Split out of admin.js.
// ─────────────────────────────────────────────────────────────────
import { t } from "../../i18n.js";
import * as sched from "../../scheduleLogic.js";
import { state } from "../state.js";
import { data } from "../data.js";
import { escapeHtml } from "../ui/format.js";
import { showToast, openConfirm } from "../ui/feedback.js";
import { iconBtn, optionsFrom } from "../ui/tables.js";
import {
  teacherName,
  roomName,
  subjectName,
  sectionName,
} from "../domain/lookups.js";
import { repaint } from "./tabState.js";
import {
  dayLabel,
  slotLabel,
  conflictText,
  currentSchedEntries,
  reloadYearSchedules,
  labeledSelect,
  ghostButton,
  ensureBellBlocks,
} from "./helpers.js";
import {
  openScheduleEntryForm,
  openConfigureDaysModal,
  openCopyScheduleModal,
} from "./forms.js";

export function renderEditorPanel(panel) {
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

  wrap.appendChild(buildToolbar(sectionsList));
  wrap.appendChild(buildScheduleGrid());
  panel.appendChild(wrap);
  panel.appendChild(buildConflictsPanel());
}

/** Which section, which bell schedule, and the week's shape. */
function buildToolbar(sectionsList) {
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
        repaint();
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
        repaint();
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
  return toolbar;
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
    cell.appendChild(buildAddSlotButton(day, slot));
    return cell;
  }

  cell.appendChild(buildEntryCard(entry));
  return cell;
}

function buildAddSlotButton(day, slot) {
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
  return add;
}

function buildEntryCard(entry) {
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
  return card;
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
