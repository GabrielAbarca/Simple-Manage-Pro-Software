// ─────────────────────────────────────────────────────────────────
//  teacherTableHelpers.js — parameterized table/list rendering helpers
//  (empty state, error state, row action buttons, HTML escaping). Split
//  out of teacher.js's UI-helpers section.
// ─────────────────────────────────────────────────────────────────
import { t } from "./i18n.js";
import { errorState, errorRow } from "./ui.js";
import { IS_ADMIN, applyAdminLock } from "./teacherAuth.js";

export function renderEmptyRow(
  tbodyId,
  colspan,
  message = t("common.noRecords"),
) {
  const tbody = document.getElementById(tbodyId);
  if (tbody)
    tbody.innerHTML = `<tr><td colspan="${colspan}" class="loading-cell">${message}</td></tr>`;
}

/**
 * A section that failed to load, with a way to try again.
 *
 * Two things were wrong with what this replaces. It rendered through
 * renderEmptyRow, so "no students in this section" and "the server did not
 * answer" came out as the same muted grey line. And several call sites went
 * further and interpolated `err.message` straight into the page, putting raw
 * PostgREST text ("violates foreign key constraint …") in front of a teacher.
 *
 * Same `.load-error` / `[data-retry]` markup as the student portal (ui.js).
 * The raw error still goes to console.error at each call site.
 *
 * @param {string} tbodyId
 * @param {number} colspan
 * @param {() => any} [retry]
 */
export function renderErrorRow(tbodyId, colspan, retry) {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;
  tbody.innerHTML = errorRow(colspan, t("common.loadError"), t("common.retry"));
  tbody
    .querySelector("[data-retry]")
    ?.addEventListener("click", () => retry?.());
}

/** The same failure notice for a container that is not a table body. */
export function renderErrorBlock(host, retry) {
  if (!host) return;
  host.innerHTML = errorState(t("common.loadError"), t("common.retry"));
  host
    .querySelector("[data-retry]")
    ?.addEventListener("click", () => retry?.());
}

export function makeActionBtn(
  icon,
  label,
  onClick,
  danger = false,
  adminOnly = false,
) {
  const btn = document.createElement("button");
  btn.className = `btn-icon${danger ? " danger" : ""}`;
  btn.type = "button";
  btn.innerHTML = `<span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-${icon}"></use></svg></span>`;
  // Admin-restricted icon buttons reuse the single gate: applyAdminLock sets the
  // tooltip to the Spanish message and makes the click a no-op. Everyone else
  // gets the normal label tooltip + real handler.
  if (adminOnly && !IS_ADMIN) {
    applyAdminLock(btn);
  } else {
    btn.title = label;
    btn.addEventListener("click", onClick);
  }
  return btn;
}

export function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c],
  );
}
