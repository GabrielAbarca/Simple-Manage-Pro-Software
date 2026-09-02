// ─────────────────────────────────────────────────────────────────
//  wizard.js — the three-step CSV import dialog: paste or upload,
//  map columns, preview and commit. Split out of admin.js.
//
//  One wizard drives every structure table; what differs per entity
//  lives in the descriptors under ./descriptors/.
// ─────────────────────────────────────────────────────────────────
import { registerDialog } from "../../dialog.js";
import { t } from "../../i18n.js";
import { parseCsv, autoMap } from "../../csv.js";
import { state } from "../state.js";
import { data } from "../data.js";
import { escapeHtml } from "../ui/format.js";
import { showToast, errorText } from "../ui/feedback.js";
import { sectionName } from "../domain/lookups.js";
import { IMPORT_DESCRIPTORS } from "./descriptors/index.js";
import { buildImportRows } from "./rows.js";

const importOverlay = document.getElementById("import-overlay");
const importBody = document.getElementById("import-body");
const importFooter = document.getElementById("import-footer");

const PREVIEW_LIMIT = 8;

let importCtx = null;

export async function openImportModal(key) {
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

export function closeImportModal() {
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
      onClick: parseAndAdvance,
    },
  ]);
}

/** Read step 1 back, parse it, auto-map the headers, and move on. */
function parseAndAdvance() {
  const d = importCtx.descriptor;
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

// Step 3 — preview valid rows + validation summary, then import.
function renderImportPreview() {
  const d = importCtx.descriptor;
  const { valid, errors } = buildImportRows(importCtx);
  const preview = valid.slice(0, PREVIEW_LIMIT);
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
    .slice(0, PREVIEW_LIMIT)
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
    ${errors.length ? `<div class="import-errors"><h3>${escapeHtml(t("console.import.skippedRows"))}</h3><ul>${errorList}</ul>${errors.length > PREVIEW_LIMIT ? `<p class="import-help">${escapeHtml(t("console.import.andMore", { count: errors.length - PREVIEW_LIMIT }))}</p>` : ""}</div>` : ""}`;

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
      onClick: () => commitImport(d, valid),
    },
  ]);
}

async function commitImport(descriptor, valid) {
  try {
    await data.bulkInsert(descriptor.table, valid);
    showToast(t("console.import.done", { count: valid.length }));
    closeImportModal();
    descriptor.reload();
  } catch (err) {
    showToast(errorText(err), "error");
  }
}

// Backdrop clicks are ignored here too — a pasted roster and its column
// mapping are exactly the kind of work a stray click used to destroy.
document
  .getElementById("import-close")
  .addEventListener("click", closeImportModal);

registerDialog(importOverlay, { close: closeImportModal });
