// ─────────────────────────────────────────────────────────────────
//  index.js — the schedules tab: loads everything the two sub-tabs
//  need, then renders the rail and whichever panel is showing.
//  Split out of admin.js.
//
//  Two sub-tabs behind one nav entry:
//    • the weekly editor — one section's week as a grid, with a bell
//      schedule optionally laying out the rows;
//    • bell schedules — the reusable time-block templates themselves.
// ─────────────────────────────────────────────────────────────────
import { t } from "../../i18n.js";
import { state } from "../state.js";
import { data } from "../data.js";
import { escapeHtml } from "../ui/format.js";
import { renderErrorBlock } from "../ui/tables.js";
import { getSchedTab, setSchedTab, registerRepaint } from "./tabState.js";
import { currentSchedSection } from "./helpers.js";
import { renderEditorPanel } from "./editor.js";
import { renderBellPanel } from "./bells.js";

const scheduleRoot = document.getElementById("schedules-root");

export async function loadSchedulesTab() {
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

    await loadReferenceLists();
    await loadScheduleData();

    // Keep the chosen section across reloads when it is still around.
    if (!currentSchedSection()) {
      state.schedSectionId = state.sections[0]?.id ?? null;
    }
    renderSchedulesTab();
  } catch (err) {
    console.error("loadSchedulesTab:", err);
    scheduleRoot.innerHTML = `<div class="console-panel"></div>`;
    renderErrorBlock(scheduleRoot.firstElementChild, loadSchedulesTab);
  }
}

/** Everything the grid names records from, fetched only when missing. */
async function loadReferenceLists() {
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
}

async function loadScheduleData() {
  const [config, bells, entries] = await Promise.all([
    optionalRead(
      "schedule_configs",
      data.getScheduleConfig(state.activeYear.id),
      null,
    ),
    optionalRead("bell_schedules", data.listBellSchedules(), []),
    data.listYearSchedules(state.sections.map((s) => s.id)),
  ]);
  state.scheduleConfig = config;
  state.bellSchedules = bells;
  state.yearSchedules = entries;
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

const SUB_TABS = [
  { id: "editor", labelKey: "console.schedules.rail.editor", icon: "schedule" },
  {
    id: "templates",
    labelKey: "console.schedules.rail.templates",
    icon: "list_alt",
  },
];

/** Sub-tab rail + the active panel. Mirrors the settings rail's ARIA. */
function renderSchedulesTab() {
  scheduleRoot.innerHTML = "";
  scheduleRoot.appendChild(buildRail());

  const panel = document.createElement("div");
  panel.className = "settings-panel active";
  panel.setAttribute("role", "tabpanel");
  scheduleRoot.appendChild(panel);
  if (getSchedTab() === "templates") renderBellPanel(panel);
  else renderEditorPanel(panel);
}

function buildRail() {
  const rail = document.createElement("div");
  rail.className = "settings-rail";
  rail.setAttribute("role", "tablist");
  SUB_TABS.forEach((tab) => {
    const active = getSchedTab() === tab.id;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `settings-rail-item${active ? " active" : ""}`;
    btn.dataset.section = tab.id;
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", String(active));
    btn.innerHTML = `<span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-${tab.icon}"></use></svg></span><span>${escapeHtml(t(tab.labelKey))}</span>`;
    btn.addEventListener("click", () => {
      setSchedTab(/** @type {any} */ (tab.id));
      renderSchedulesTab();
    });
    rail.appendChild(btn);
  });
  return rail;
}

// The panels repaint through tabState rather than importing this module back.
registerRepaint(renderSchedulesTab);
