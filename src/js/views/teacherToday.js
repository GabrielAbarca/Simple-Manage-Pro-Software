// ─────────────────────────────────────────────────────────────────
//  teacherToday.js — the Today start page (item 7): the teacher's classes
//  for the current day, with quick actions into attendance/gradebook.
// ─────────────────────────────────────────────────────────────────
import { t, formatDate as i18nFormatDate } from "../i18n.js";
import { skeletonCards } from "../ui.js";
import { db } from "../teacherData/index.js";
import { state } from "../teacherState.js";
import { jsDayToDow } from "../scheduleLogic.js";
import { renderErrorBlock, escapeHtml } from "../teacherTableHelpers.js";
import { className } from "../teacherFormat.js";
import { openClassWorkspace } from "./classWorkspace.js";

export async function loadToday() {
  const grid = document.getElementById("today-grid");
  const subtitle = document.getElementById("today-subtitle");
  if (!grid) return;
  if (!state.activeYear || !state.teacherId) {
    // This early return skips the subtitle write further down, so clear the
    // static "Loading your day…" placeholder here — otherwise the header claims
    // the page is still loading forever while the grid says it gave up.
    if (subtitle) {
      subtitle.textContent = state.teacherId
        ? ""
        : t("admin.today.noTeacherRecordTitle");
    }
    grid.innerHTML = `<div class="loading-cell">${
      state.teacherId
        ? t("admin.today.contextNotLoaded")
        : t("admin.today.noTeacherRecordBody")
    }</div>`;
    return;
  }

  const now = new Date();
  const jsDow = now.getDay(); // 0 Sun … 6 Sat
  subtitle.textContent = i18nFormatDate(now, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  grid.innerHTML = skeletonCards(3);
  try {
    // state.myClassesCache lets us map a schedule row to its class_subject_teacher
    // so the action buttons can open the class workspace.
    if (!state.myClassesCache.length) {
      state.myClassesCache = await db.fetchMyClasses(
        state.teacherId,
        state.activeYear.id,
      );
    }
    // Weekends are queried like any other day — schools that teach on
    // Saturday exist, and an empty result renders the same "no classes".
    const entries = await db.fetchScheduleToday(
      state.teacherId,
      jsDayToDow(jsDow),
    );
    renderToday(entries, grid, jsDow);
  } catch (err) {
    state.loaded.today = false; // allow a retry on next visit
    console.error(err);
    renderErrorBlock(grid, loadToday);
  }
}

function renderToday(entries, grid, jsDow = null) {
  // Only show schedule rows the teacher actually grades (has a
  // class_subject_teacher assignment for); other teachers' classes are hidden.
  const mine = entries
    .map((e) => ({
      entry: e,
      cst: state.myClassesCache.find(
        (c) => c.class_id === e.class_id && c.subject_id === e.subject_id,
      ),
    }))
    .filter((m) => m.cst);

  if (!mine.length) {
    // A free Saturday still reads as a weekend; a free Tuesday does not.
    const weekend = jsDow === 0 || jsDow === 6;
    const icon = weekend ? "weekend" : "event_available";
    const message = t(
      weekend ? "admin.today.weekend" : "admin.today.noClasses",
    );
    grid.innerHTML = `<div class="empty-state"><span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-${icon}"></use></svg></span><p>${message}</p></div>`;
    return;
  }

  grid.innerHTML = "";
  const list = document.createElement("div");
  list.className = "today-list";

  mine.forEach(({ entry: e, cst }) => {
    const color = e.subjects?.color || "var(--color-primary)";
    const card = document.createElement("div");
    card.className = "today-card";
    card.style.setProperty("--accent", color);
    card.innerHTML = `
      <span class="today-card-accent"></span>
      <div class="today-card-time">
        <b>${escapeHtml((e.start_time ?? "").slice(0, 5))}</b>
        <span>${escapeHtml((e.end_time ?? "").slice(0, 5))}</span>
      </div>
      <div class="today-card-body">
        <h3>${escapeHtml(e.subjects?.name ?? "—")}</h3>
        <p>${escapeHtml(className(e.classes))}${
          e.rooms?.name ? " · " + escapeHtml(e.rooms.name) : ""
        }</p>
      </div>
      <div class="today-card-actions"></div>`;

    const actions = card.querySelector(".today-card-actions");
    const att = document.createElement("button");
    att.type = "button";
    att.className = "btn btn-sm btn-secondary";
    att.innerHTML = `<span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-fact_check"></use></svg></span> ${t("admin.today.attendance")}`;
    att.addEventListener("click", () => openClassWorkspace(cst, "attendance"));
    const gb = document.createElement("button");
    gb.type = "button";
    gb.className = "btn btn-sm btn-primary";
    gb.innerHTML = `<span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-school"></use></svg></span> ${t("admin.today.gradebook")}`;
    gb.addEventListener("click", () => openClassWorkspace(cst, "gradebook"));
    actions.append(att, gb);
    list.appendChild(card);
  });

  grid.appendChild(list);
}
