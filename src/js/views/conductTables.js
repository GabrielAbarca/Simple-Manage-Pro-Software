// ─────────────────────────────────────────────────────────────────
//  views/conductTables.js — HTML builders for the Conduct tab. Pure:
//  data in, markup out. No state, no queries, no listeners; clicks are
//  handled by delegation in views/conduct.js through data-action.
// ─────────────────────────────────────────────────────────────────
import { t } from "../i18n.js";
import { escapeHtml } from "../teacherTableHelpers.js";
import { conductCellHtml, formatDate } from "../teacherFormat.js";
import { isConductPassing, conductPassingScore } from "../promotion.js";

const SEVERITY_BADGE = {
  low: "badge-neutral",
  medium: "badge-warning",
  high: "badge-danger",
};

function icon(name) {
  return `<span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-${name}"></use></svg></span>`;
}

export function severityBadgeHtml(severity) {
  const tone = SEVERITY_BADGE[severity] ?? "badge-neutral";
  const label = severity ? t(`enums.disciplineSeverity.${severity}`) : "—";
  return `<span class="badge ${tone}">${escapeHtml(label)}</span>`;
}

function conductGradeHtml(score, school) {
  if (isConductPassing(score, school)) return conductCellHtml(score);
  const mark = conductPassingScore(school);
  return `${conductCellHtml(score)} <span class="badge badge-danger">${t("admin.conduct.belowMark", { mark })}</span>`;
}

function lastRecordHtml(record) {
  if (!record) return '<span class="text-muted">—</span>';
  return `${severityBadgeHtml(record.severity)} <span class="text-muted">${formatDate(record.date)}</span>`;
}

function nameCellHtml(student, records, isExpanded) {
  return `
    <button type="button" class="conduct-toggle" data-action="toggle-student"
      data-student="${student.id}" aria-expanded="${isExpanded}"
      ${records.length ? "" : "disabled"}>
      ${icon("chevron_right")}
      ${escapeHtml(student.last_name)}, ${escapeHtml(student.first_name)}
    </button>`;
}

function editButtonHtml(record, teacherId) {
  if (teacherId == null || record.reported_by_teacher !== teacherId) return "";
  const label = escapeHtml(t("admin.conduct.editRecord"));
  return `
    <button type="button" class="btn-icon" data-action="edit-record"
      data-record="${record.id}" title="${label}" aria-label="${label}">
      ${icon("edit")}
    </button>`;
}

function reporterName(record, context) {
  return (
    context.teacherNames.get(record.reported_by_teacher) ??
    t("admin.conduct.unknownReporter")
  );
}

function pointsHtml(record) {
  const points = Number(record.conduct_points ?? 0);
  return points > 0
    ? `<span class="conduct-record-points">−${points}</span>`
    : "";
}

function recordCardHtml(record, context) {
  const description = record.description
    ? `<p class="text-muted">${escapeHtml(record.description)}</p>`
    : "";
  return `
    <div class="conduct-record">
      <div>
        <div class="conduct-record-head">
          ${severityBadgeHtml(record.severity)}
          <b>${escapeHtml(record.type ?? "")}</b>
          <span class="text-muted">${formatDate(record.date)} · ${escapeHtml(reporterName(record, context))}</span>
        </div>
        ${description}
      </div>
      <div class="conduct-record-side">
        ${pointsHtml(record)}
        ${editButtonHtml(record, context.teacherId)}
      </div>
    </div>`;
}

function detailRowHtml(records, context) {
  const cards = records.map((r) => recordCardHtml(r, context)).join("");
  return `<tr class="conduct-detail"><td colspan="5">${cards}</td></tr>`;
}

function studentRowHtml({ student, score, records, isExpanded }, context) {
  const fullName = `${student.first_name} ${student.last_name}`;
  const addLabel = escapeHtml(t("admin.conduct.addFor", { name: fullName }));
  const mainRow = `
    <tr>
      <td>${nameCellHtml(student, records, isExpanded)}</td>
      <td>${conductGradeHtml(score, context.school)}</td>
      <td>${records.length}</td>
      <td>${lastRecordHtml(records[0])}</td>
      <td class="actions-col">
        <button type="button" class="btn-icon" data-action="add-record"
          data-student="${student.id}" title="${addLabel}" aria-label="${addLabel}">
          ${icon("edit_note")}
        </button>
      </td>
    </tr>`;
  return isExpanded ? mainRow + detailRowHtml(records, context) : mainRow;
}

export function studentTableHtml(rows, context) {
  const body = rows.map((row) => studentRowHtml(row, context)).join("");
  return `
    <table class="data-table">
      <thead>
        <tr>
          <th>${t("admin.conduct.student")}</th>
          <th>${t("admin.conduct.grade")}</th>
          <th>${t("admin.conduct.records")}</th>
          <th>${t("admin.conduct.lastRecord")}</th>
          <th class="actions-col">${t("admin.conduct.actions")}</th>
        </tr>
      </thead>
      <tbody>${body}</tbody>
    </table>`;
}

function recordRowHtml(record, context) {
  const studentName = context.studentNames.get(record.student_id) ?? "";
  const description = record.description
    ? `<div class="text-muted">${escapeHtml(record.description)}</div>`
    : "";
  return `
    <tr>
      <td>${formatDate(record.date)}</td>
      <td>${escapeHtml(studentName)}</td>
      <td>${severityBadgeHtml(record.severity)}</td>
      <td>
        <b>${escapeHtml(record.type ?? "")}</b>
        ${description}
        <div class="conduct-reporter">${escapeHtml(reporterName(record, context))}</div>
      </td>
      <td>${pointsHtml(record)}</td>
      <td class="actions-col">${editButtonHtml(record, context.teacherId)}</td>
    </tr>`;
}

export function recordsTableHtml(records, context) {
  const body = records.map((r) => recordRowHtml(r, context)).join("");
  return `
    <table class="data-table">
      <thead>
        <tr>
          <th>${t("admin.conduct.date")}</th>
          <th>${t("admin.conduct.student")}</th>
          <th>${t("admin.conduct.severity")}</th>
          <th>${t("admin.conduct.description")}</th>
          <th>${t("admin.conduct.points")}</th>
          <th class="actions-col">${t("admin.conduct.actions")}</th>
        </tr>
      </thead>
      <tbody>${body}</tbody>
    </table>`;
}

export function emptyStateHtml() {
  return `
    <div class="empty-state">
      ${icon("gavel")}
      <p>${t("admin.conduct.empty")}</p>
      <p class="empty-sub">${t("admin.conduct.emptySub")}</p>
    </div>`;
}
