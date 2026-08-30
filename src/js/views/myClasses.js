// ─────────────────────────────────────────────────────────────────
//  myClasses.js — "My Classes" landing: the teacher's subject-sections as
//  cards, each opening into the class workspace.
// ─────────────────────────────────────────────────────────────────
import { t, tn } from "../i18n.js";
import { skeletonCardItems } from "../ui.js";
import { db } from "../teacherData/index.js";
import { state } from "../teacherState.js";
import { renderErrorBlock, escapeHtml } from "../teacherTableHelpers.js";
import { className } from "../teacherFormat.js";
import { openClassWorkspace } from "./classWorkspace.js";

export async function loadMyClasses() {
  const grid = document.getElementById("myclasses-grid");
  const subtitle = document.getElementById("myclasses-subtitle");
  if (!state.teacherId || !state.activeYear) {
    if (subtitle) subtitle.textContent = "";
    grid.innerHTML = `<div class="loading-cell">${
      state.teacherId
        ? t("admin.today.contextNotLoaded")
        : t("admin.today.noTeacherRecordBody")
    }</div>`;
    return;
  }
  grid.innerHTML = skeletonCardItems(3);

  try {
    const [classes, counts] = await Promise.all([
      db.fetchMyClasses(state.teacherId, state.activeYear.id),
      db.fetchActiveCountByClass(),
    ]);
    state.myClassesCache = classes;

    const totalStudents = [...new Set(classes.map((c) => c.class_id))].reduce(
      (sum, classId) => sum + (counts[classId] ?? 0),
      0,
    );
    subtitle.textContent = t("admin.myclasses.summary", {
      year: state.activeYear.name,
      sections: tn("admin.sections", classes.length),
      students: tn("admin.students", totalStudents),
    });

    renderQuickStats(classes.length, totalStudents);
    renderMyClasses(classes, counts);
  } catch (err) {
    console.error(err);
    renderErrorBlock(grid, loadMyClasses);
  }
}

function renderMyClasses(classes, counts) {
  const grid = document.getElementById("myclasses-grid");
  if (!classes.length) {
    grid.innerHTML = `<div class="loading-cell">${t("admin.myclasses.empty")}</div>`;
    return;
  }

  grid.innerHTML = "";
  classes.forEach((cst) => {
    const color = cst.subjects?.color || "var(--color-primary)";
    const count = counts[cst.class_id] ?? 0;
    const card = document.createElement("button");
    card.type = "button";
    card.className = "class-card";
    card.style.setProperty("--accent", color);
    card.innerHTML = `
      <span class="class-card-accent"></span>
      <div class="class-card-body">
        <h3 class="class-card-subject">${escapeHtml(cst.subjects?.name ?? "—")}</h3>
        <p class="class-card-section">${escapeHtml(className(cst.classes))}</p>
        <p class="class-card-count">
          <span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-group"></use></svg></span>
          ${tn("admin.students", count)}
        </p>
      </div>
      <span class="material-symbols-outlined class-card-arrow"><svg aria-hidden="true"><use href="#icon-chevron_right"></use></svg></span>
    `;
    card.addEventListener("click", () => openClassWorkspace(cst));
    grid.appendChild(card);
  });
}

function renderQuickStats(sectionCount, totalStudents) {
  const el = document.getElementById("quick-stats-list");
  el.innerHTML = `
    <span class="qstat"><span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-co_present"></use></svg></span>${tn("admin.sections", sectionCount)}</span>
    <span class="qstat"><span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-group"></use></svg></span>${tn("admin.students", totalStudents)}</span>
    <span class="qstat"><span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-calendar_today"></use></svg></span>${escapeHtml(state.activeYear.name)}</span>`;
}
