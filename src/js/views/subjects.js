// ─────────────────────────────────────────────────────────────────
//  subjects.js — the Subjects catalog section (global, read-only). The
//  school's subject structure is registrar-managed, outside a teacher's
//  role, so there's no add/edit/delete here.
// ─────────────────────────────────────────────────────────────────
import { t } from "../i18n.js";
import { db } from "../teacherData/index.js";
import {
  renderEmptyRow,
  renderErrorRow,
  escapeHtml,
} from "../teacherTableHelpers.js";

let _cachedSubjects = [];
let subjectsFilter = { search: "" };

export async function loadSubjects() {
  renderEmptyRow("subjects-body", 4, t("admin.subjects.loading"));
  try {
    _cachedSubjects = await db.fetchSubjectsDetailed();
    renderSubjectsTable();
  } catch (err) {
    console.error(err);
    renderErrorRow("subjects-body", 4, loadSubjects);
  }
}

function renderSubjectsTable() {
  const tbody = document.getElementById("subjects-body");
  let filtered = _cachedSubjects;

  if (subjectsFilter.search) {
    const q = subjectsFilter.search.toLowerCase();
    filtered = filtered.filter(
      (s) =>
        s.name?.toLowerCase().includes(q) || s.code?.toLowerCase().includes(q),
    );
  }

  if (!filtered.length) {
    renderEmptyRow("subjects-body", 4, t("admin.subjects.noMatch"));
    return;
  }

  tbody.innerHTML = "";
  filtered.forEach((subject) => {
    const gradeLevelNames =
      [
        ...new Set(
          (subject.grade_level_subjects ?? [])
            .map((gls) => gls.grade_levels?.name)
            .filter(Boolean),
        ),
      ].join(", ") || "—";

    const colorSwatch = subject.color
      ? `<span class="color-swatch" style="background:${subject.color};
           display:inline-block;width:16px;height:16px;border-radius:3px;
           vertical-align:middle;margin-right:6px;"></span>${escapeHtml(subject.color)}`
      : "—";

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><code>${escapeHtml(subject.code ?? "—")}</code></td>
      <td>${escapeHtml(subject.name)}</td>
      <td>${colorSwatch}</td>
      <td>${escapeHtml(gradeLevelNames)}</td>`;
    tbody.appendChild(tr);
  });
}

let subjectsSearchTimeout;
document.getElementById("subjects-search")?.addEventListener("input", (e) => {
  clearTimeout(subjectsSearchTimeout);
  subjectsSearchTimeout = setTimeout(() => {
    subjectsFilter.search = e.target.value.trim();
    if (_cachedSubjects.length) renderSubjectsTable();
  }, 350);
});
