// "Just saved" row feedback
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
