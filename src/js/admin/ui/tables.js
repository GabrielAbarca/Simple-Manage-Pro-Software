// ─────────────────────────────────────────────────────────────────
//  tables.js — table/list rendering helpers shared by every admin
//  console screen: loading/empty/error rows, row action buttons, the
//  "just saved" row flash, and select-option building. Split out of
//  admin.js's UI helpers.
// ─────────────────────────────────────────────────────────────────
import { t } from "../../i18n.js";
import { errorState, errorRow } from "../../ui.js";
import { escapeHtml } from "./format.js";

export function renderMessageRow(tbodyId, colspan, message) {
  const tbody = document.getElementById(tbodyId);
  if (tbody)
    tbody.innerHTML = `<tr><td colspan="${colspan}" class="loading-cell">${escapeHtml(message)}</td></tr>`;
}

export function renderEmptyRow(
  tbodyId,
  colspan,
  message = t("common.noRecords"),
) {
  renderMessageRow(tbodyId, colspan, message);
}

/**
 * A section that failed to load, with a way to try again.
 *
 * This used to route through renderMessageRow, which meant a failed fetch and
 * an empty table rendered as the SAME muted grey line. "No students yet" and
 * "we couldn't reach the server" mean opposite things to a director — one is
 * an invitation to add the first student, the other is a dropped connection —
 * and showing the first when the second happened is how an outage turns into
 * a support call about missing records.
 *
 * Uses the same `.load-error` / `[data-retry]` markup the student portal
 * already ships (ui.js), so the two surfaces fail identically.
 *
 * @param {string} tbodyId
 * @param {number} colspan
 * @param {() => any} [retry] re-runs the loader; the button is wired to it
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

export function iconBtn(icon, label, onClick, danger = false) {
  const btn = document.createElement("button");
  btn.className = `btn-icon${danger ? " danger" : ""}`;
  btn.type = "button";
  btn.title = label;
  btn.setAttribute("aria-label", label);
  btn.innerHTML = `<span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-${icon}"></use></svg></span>`;
  btn.addEventListener("click", onClick);
  return btn;
}

// ── "Just saved" row feedback ──────────────────────────────────
// A toast confirms that a write happened, but not *which* record it touched.
// After a save the owning table re-renders, so the row is a fresh element:
// remember the id, then outline it green once it comes back on screen. This
// matters most in demo mode, where writes are session-local and a director
// reasonably wonders whether anything took.

/** @type {{ tbodyId: string, id: string } | null} */
let pendingSavedRow = null;
const SAVED_FLASH_MS = 2500;

/** Remember the record a save just wrote, to outline on the next render. */
export function markSaved(tbodyId, id) {
  if (id == null) return;
  pendingSavedRow = { tbodyId, id: String(id) };
}

/**
 * Outline the freshly saved row, if this table owns it. Scoped by tbody so a
 * row that happens to share an id in another table never lights up instead.
 */
export function applySavedFlash(tbodyId) {
  if (!pendingSavedRow || pendingSavedRow.tbodyId !== tbodyId) return;
  const { id } = pendingSavedRow;
  pendingSavedRow = null;
  const row = document.querySelector(
    `#${tbodyId} tr[data-row-id="${CSS.escape(id)}"]`,
  );
  if (!row) return;
  row.classList.add("row-saved");
  setTimeout(() => row.classList.remove("row-saved"), SAVED_FLASH_MS);
}

/**
 * Build a row with cells (HTML strings) and an actions cell of buttons.
 * `rowId` tags the row so a save can find it again after the re-render.
 */
export function tableRow(cells, actionButtons = [], rowId = null) {
  const tr = document.createElement("tr");
  if (rowId != null) tr.dataset.rowId = String(rowId);
  cells.forEach((html) => {
    const td = document.createElement("td");
    td.innerHTML = html;
    tr.appendChild(td);
  });
  if (actionButtons.length) {
    const td = document.createElement("td");
    td.className = "actions-col";
    actionButtons.forEach((b) => td.appendChild(b));
    tr.appendChild(td);
  }
  return tr;
}

export function optionsFrom(list, labelFn, valueKey = "id") {
  return list.map((item) => ({ value: item[valueKey], label: labelFn(item) }));
}
