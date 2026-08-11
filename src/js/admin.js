// ═══════════════════════════════════════════════════════════════
//  admin.js — Simple Manage Pro | Admin Console
//
//  The school director/coordinator portal: where a school gets
//  configured and operated. Role-gated, bilingual, demo-overlay safe.
//
//  Architecture:
//  1. Auth guard + role gate (admin only)
//  2. Data layer  (gateway → real Supabase or demo overlay)
//  3. UI helpers  (toast, modal form, confirm, tables)
//  4. Navigation  (sidebar → view sections)
//  5. Sections    (overview, year & periods, grades & sections,
//                  subjects, teachers & assignments, schedules, settings)
// ═══════════════════════════════════════════════════════════════

import "./errorHandler.js";
import "./speedInsights.js";
import { supabase } from "./supabaseClient.js";
import { signOut, getSession } from "./auth.js";
import { fetchRole, portalPath, haltForRedirect } from "./role.js";
import { initTheme, bindThemeToggle } from "./theme.js";
import { initSidebarToggle, errorState, errorRow } from "./ui.js";
import { registerDialog } from "./dialog.js";
import { initControls } from "./controls/index.js";
import { renderSettings } from "./settings.js";
import { DEMO_MODE } from "./demoMode.js";
import { supabaseGateway, createAdminData } from "./adminData.js";
import { createDemoGateway } from "./adminDemoDb.js";
import { parseCsv, autoMap } from "./csv.js";
import {
  TARGET_WEIGHT,
  remainingWeight,
  totalWeight,
  weightStatus,
} from "./gradingPeriods.js";
import * as sched from "./scheduleLogic.js";
import * as v from "./validate.js";
import { mapDbError } from "./dbErrors.js";
import {
  createAccount,
  resetPassword,
  generateTempPassword,
} from "./accounts.js";
import { initI18n, applyTranslations, t, tn, formatDate } from "./i18n.js";

// ───────────────────────────────────────────────────────────────
//  1. AUTH GUARD + ROLE GATE
// ───────────────────────────────────────────────────────────────
const session = await getSession();
if (!session) haltForRedirect("/login.html", "Unauthenticated");

const role = await fetchRole();
if (role !== "admin") haltForRedirect(portalPath(role), "Unauthorized");

// ───────────────────────────────────────────────────────────────
//  2. DATA LAYER
// ───────────────────────────────────────────────────────────────
// Demo sandbox: writes land in an in-memory session overlay instead of the
// shared backend; reads stay live with the overlay applied. A refresh restores
// pristine data. The first write shows a one-time notice.
let demoNoticeShown = false;
const gateway = DEMO_MODE
  ? createDemoGateway(supabaseGateway, {
      onWrite: () => {
        if (demoNoticeShown) return;
        demoNoticeShown = true;
        showToast(t("admin.demo.sandboxNotice"));
      },
    })
  : supabaseGateway;
const data = createAdminData(gateway);

// Reference lists reused across sections, refreshed by the loaders that own them.
const state = {
  /** @type {any} */ activeYear: null,
  /** @type {any[]} */ gradeLevels: [],
  /** @type {any[]} */ rooms: [],
  /** @type {any[]} */ teachers: [],
  /** @type {any[]} */ subjects: [],
  /** @type {any[]} */ sections: [],
  /** @type {any[]} */ students: [],
  /** @type {any[]} */ schoolYears: [],
  /** @type {any[]} */ periods: [], // active year's grading periods (weight total)
  /** @type {any} */ school: null, // school_settings row: name + ID-field label
  /** @type {string} */ studentFilter: "all", // "all" | "unassigned" | section id
  // ── Schedules tab ──
  /** @type {any} */ scheduleConfig: null, // active year's structure + school days
  /** @type {any[]} */ bellSchedules: [], // time-block templates
  /** @type {Record<number, any[]>} */ bellBlocks: {}, // template id → its blocks
  /** @type {any[]} */ yearSchedules: [], // every entry of the active year
  /** @type {number|null} */ schedSectionId: null, // section being edited
  /** @type {number|null} */ schedTemplateId: null, // template laying out the grid
  /** @type {number|null} */ schedBellId: null, // template whose blocks are open
};

// ───────────────────────────────────────────────────────────────
//  3. UI HELPERS
// ───────────────────────────────────────────────────────────────
const toastContainer = document.getElementById("toast-container");

function showToast(message, type = "success") {
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  const icon = type === "success" ? "check_circle" : "error";
  toast.innerHTML = `<span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-${icon}"></use></svg></span>${escapeHtml(message)}`;
  toastContainer.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

/**
 * User-facing text for a failed write. Client-side rules catch most bad input
 * before it leaves the browser; whatever still fails at the database is
 * translated here, because a PostgREST message names constraints and columns
 * and means nothing to the person running the school. The raw error is always
 * logged, so nothing is lost for debugging.
 * @param {any} err
 */
function errorText(err) {
  console.error("[SMP] Write failed:", err);
  return t(mapDbError(err).key);
}

function escapeHtml(value) {
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

function num(v) {
  return v === "" || v == null ? null : Number(v);
}
function nullable(v) {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
}

// ── Generic modal form ─────────────────────────────────────────
const modalOverlay = document.getElementById("modal-overlay");
const modalTitle = document.getElementById("modal-title");
const modalForm = document.getElementById("modal-form");
let currentSubmitHandler = null;
// Has the open form been touched? Drives the discard confirmation, so a stray
// click or a mistaken Cancel can never silently throw away typed work.
let modalDirty = false;

/** Render an inline error under one field and mark the field-group invalid. */
/**
 * Show a validation message under its field, and — the part that makes it
 * reach assistive tech — bind the two together. Rendering the message next
 * to the input is enough for a sighted user and nothing at all for a screen
 * reader: without `aria-describedby` the text is just unrelated prose
 * somewhere on the page, and without `aria-invalid` the field never reports
 * itself as failing. `role="alert"` announces the message when it appears.
 */
function setFieldError(name, message) {
  const input = modalForm.querySelector(`[name="${name}"]`);
  const group = input?.closest(".field-group");
  if (!group) return;
  group.classList.add("input-error");
  const msg = document.createElement("small");
  msg.className = "field-error";
  msg.dataset.fieldError = name;
  msg.id = `modal-error-${name}`;
  msg.setAttribute("role", "alert");
  msg.textContent = message;
  group.appendChild(msg);
  // Checkbox groups have no single input to point at, so only bind when there
  // is one control carrying the field's name.
  if (input instanceof HTMLElement && !(input instanceof HTMLDivElement)) {
    input.setAttribute("aria-invalid", "true");
    input.setAttribute("aria-describedby", msg.id);
  }
}

function clearFieldErrors() {
  modalForm.querySelectorAll("[data-field-error]").forEach((el) => el.remove());
  modalForm
    .querySelectorAll(".field-group.input-error")
    .forEach((el) => el.classList.remove("input-error"));
  modalForm.querySelectorAll("[aria-invalid]").forEach((el) => {
    el.removeAttribute("aria-invalid");
    el.removeAttribute("aria-describedby");
  });
}

/** Drop one field's error as soon as the user starts correcting it. */
function clearFieldError(name) {
  modalForm
    .querySelectorAll(`[data-field-error="${name}"]`)
    .forEach((el) => el.remove());
  modalForm
    .querySelector(`[name="${name}"]`)
    ?.closest(".field-group")
    ?.classList.remove("input-error");
  const input = modalForm.querySelector(`[name="${name}"]`);
  input?.removeAttribute("aria-invalid");
  input?.removeAttribute("aria-describedby");
}

/**
 * Field specs → the { field: Rule[] } map validate.js runs. A spec marked
 * `required` gets required() first, so turning off native validation doesn't
 * quietly lose the check every form already relied on.
 * @param {any[]} fields
 */
function collectRules(fields) {
  /** @type {Record<string, import("./validate.js").Rule[]>} */
  const map = {};
  fields.forEach((field) => {
    if (field.type === "checkboxes") return;
    const rules = [...(field.rules ?? [])];
    if (field.required) rules.unshift(v.required());
    // One `maxLength` declaration yields both the browser's own cap and a rule,
    // so a pasted-in over-long value still fails inline instead of at the DB.
    if (field.maxLength != null) rules.push(v.maxLen(field.maxLength));
    if (rules.length) map[field.name] = rules;
  });
  return map;
}

/**
 * Turn validate.js message descriptors into display strings. Keeping the keys
 * un-translated until here is what lets the rules stay pure and testable.
 * @param {Record<string, import("./validate.js").Message>} messages
 */
function translateMessages(messages) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const [field, message] of Object.entries(messages)) {
    out[field] = t(message.key, message.vars);
  }
  return out;
}

/**
 * Open the shared modal with a field spec. `onSubmit` receives an object of
 * name → value (checkbox groups yield arrays); returning resolves & closes.
 *
 * Validation runs before the write and never uses native browser popups:
 *  • each field spec may carry `rules: Rule[]` from validate.js — a field
 *    marked `required` gets required() prepended automatically;
 *  • `validate(values)` stays available for whole-form rules that don't
 *    belong to one field (a year's grading weights summing past 100%).
 * Both produce a { fieldName: message } map rendered inline under the field.
 */
function openModal({
  title,
  fields,
  onSubmit,
  validate,
  submitLabel = t("common.save"),
}) {
  modalTitle.textContent = title;
  document.getElementById("modal-submit").textContent = submitLabel;
  modalForm.innerHTML = "";
  modalDirty = false;
  // We own validation now: suppress the browser's own popups entirely.
  modalForm.noValidate = true;

  fields.forEach((field) => {
    const group = document.createElement("div");
    group.className = "field-group";

    if (field.type !== "checkboxes") {
      const label = document.createElement("label");
      label.textContent = field.label;
      label.htmlFor = `modal-field-${field.name}`;
      group.appendChild(label);
    }

    let input;
    if (field.type === "select") {
      input = document.createElement("select");
      input.id = `modal-field-${field.name}`;
      input.name = field.name;
      if (field.required) input.required = true;
      const ph = document.createElement("option");
      ph.value = "";
      ph.textContent = field.required
        ? t("common.selectPlaceholder", { label: field.label.toLowerCase() })
        : t("common.none");
      input.appendChild(ph);
      (field.options ?? []).forEach((opt) => {
        const o = document.createElement("option");
        o.value = opt.value;
        o.textContent = opt.label;
        if (String(opt.value) === String(field.value)) o.selected = true;
        input.appendChild(o);
      });
    } else if (field.type === "checkboxes") {
      const legend = document.createElement("span");
      legend.className = "field-legend";
      legend.textContent = field.label;
      group.appendChild(legend);
      input = document.createElement("div");
      input.className = "checkbox-grid";
      const checked = new Set((field.value ?? []).map(String));
      (field.options ?? []).forEach((opt) => {
        const wrap = document.createElement("label");
        wrap.className = "checkbox-item";
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.name = field.name;
        cb.value = opt.value;
        if (checked.has(String(opt.value))) cb.checked = true;
        wrap.appendChild(cb);
        const span = document.createElement("span");
        span.textContent = opt.label;
        wrap.appendChild(span);
        input.appendChild(wrap);
      });
    } else if (field.type === "textarea") {
      input = document.createElement("textarea");
      input.id = `modal-field-${field.name}`;
      input.name = field.name;
      input.rows = 3;
      input.value = field.value ?? "";
      if (field.placeholder) input.placeholder = field.placeholder;
      if (field.maxLength != null) input.maxLength = field.maxLength;
    } else {
      input = document.createElement("input");
      input.id = `modal-field-${field.name}`;
      input.type = field.type ?? "text";
      input.name = field.name;
      input.value = field.value ?? "";
      if (field.required) input.required = true;
      if (field.placeholder) input.placeholder = field.placeholder;
      if (field.min != null) input.min = field.min;
      if (field.max != null) input.max = field.max;
      if (field.step != null) input.step = field.step;
      if (field.maxLength != null) input.maxLength = field.maxLength;
    }

    group.appendChild(input);

    if (field.help) {
      const help = document.createElement("small");
      help.className = "field-help";
      help.textContent = field.help;
      group.appendChild(help);
    }
    modalForm.appendChild(group);
  });

  if (currentSubmitHandler)
    modalForm.removeEventListener("submit", currentSubmitHandler);

  currentSubmitHandler = async (e) => {
    e.preventDefault();
    const values = {};
    fields.forEach((field) => {
      if (field.type === "checkboxes") {
        values[field.name] = [
          ...modalForm.querySelectorAll(`input[name="${field.name}"]:checked`),
        ].map((el) => el.value);
      } else {
        const el = modalForm.querySelector(`[name="${field.name}"]`);
        values[field.name] = el ? el.value : "";
      }
    });

    // Inline validation gate: render every message under its field and stop.
    // Field rules take precedence over whole-form ones — a malformed value is
    // more actionable than the aggregate complaint it causes (a weight of 150
    // should read "enter 0–100", not "the year now totals 200%").
    clearFieldErrors();
    const errors = {
      ...(validate ? (validate(values) ?? {}) : {}),
      ...translateMessages(v.runRules(collectRules(fields), values)),
    };
    const invalid = Object.keys(errors);
    if (invalid.length) {
      invalid.forEach((name) => setFieldError(name, errors[name]));
      const first = modalForm.querySelector(`[name="${invalid[0]}"]`);
      if (first instanceof HTMLElement) first.focus();
      return;
    }

    const submitBtn = document.getElementById("modal-submit");
    submitBtn.disabled = true;
    try {
      await onSubmit(values);
      closeModal();
    } catch (err) {
      showToast(errorText(err), "error");
    } finally {
      submitBtn.disabled = false;
    }
  };
  modalForm.addEventListener("submit", currentSubmitHandler);
  modalOverlay.classList.add("active");
}

function closeModal() {
  modalOverlay.classList.remove("active");
  modalForm.innerHTML = "";
  modalDirty = false;
  if (currentSubmitHandler) {
    modalForm.removeEventListener("submit", currentSubmitHandler);
    currentSubmitHandler = null;
  }
}

/**
 * Close on explicit intent only (X / Cancel), confirming first when the form
 * carries unsaved edits. Clicking the backdrop deliberately does nothing —
 * it used to discard a half-filled form without warning.
 */
function requestCloseModal() {
  if (!modalDirty) {
    closeModal();
    return;
  }
  openConfirm(t("console.confirm.discardMessage"), () => closeModal(), {
    title: t("console.confirm.discardTitle"),
    confirmLabel: t("console.confirm.discard"),
    cancelLabel: t("console.confirm.keepEditing"),
  });
}

// Any edit to any control marks the form dirty (delegated: the form's contents
// are rebuilt on every open, but the <form> element itself persists), and
// retires that field's error so a correction clears the message immediately.
["input", "change"].forEach((evt) =>
  modalForm.addEventListener(evt, (e) => {
    modalDirty = true;
    const name = /** @type {any} */ (e.target)?.name;
    if (name) clearFieldError(name);
  }),
);

document
  .getElementById("modal-close")
  .addEventListener("click", requestCloseModal);
document
  .getElementById("modal-cancel")
  .addEventListener("click", requestCloseModal);

// ── Confirm modal ──────────────────────────────────────────────
const confirmOverlay = document.getElementById("confirm-overlay");
const confirmTitle = document.getElementById("confirm-title");
const confirmMessage = document.getElementById("confirm-message");
const confirmDeleteBtn = document.getElementById("confirm-delete");
const confirmCancelBtn = document.getElementById("confirm-cancel");
let confirmHandler = null;

/**
 * Ask before an irreversible action. Defaults to the delete wording; `opts`
 * retitles it and relabels the buttons so non-delete decisions (discarding a
 * dirty form, activating an under-weighted year) can reuse the same dialog.
 * @param {string} message
 * @param {() => any} onConfirm
 * @param {{ title?: string, confirmLabel?: string, cancelLabel?: string,
 *   danger?: boolean }} [opts]
 */
function openConfirm(message, onConfirm, opts = {}) {
  const danger = opts.danger !== false;
  confirmTitle.textContent = opts.title ?? t("console.confirm.title");
  confirmMessage.textContent = message;
  confirmDeleteBtn.textContent = opts.confirmLabel ?? t("common.delete");
  confirmDeleteBtn.classList.toggle("btn-danger", danger);
  confirmDeleteBtn.classList.toggle("btn-primary", !danger);
  confirmCancelBtn.textContent = opts.cancelLabel ?? t("common.cancel");
  // Inline display, not the `hidden` attribute: the dialog's own button styling
  // sets `display`, which outranks the UA sheet's `[hidden] { display: none }`.
  confirmCancelBtn.style.display = "";
  confirmHandler = onConfirm;
  confirmOverlay.classList.add("active");
}

/**
 * A dismissible notice wearing the confirm dialog's clothes — for an action the
 * console refuses outright, where there is nothing to decide. Drops the cancel
 * button so it reads as information rather than a choice, and outlives a toast,
 * which matters when the message names what the user has to go and remove.
 * @param {string} message
 * @param {{ title?: string, closeLabel?: string }} [opts]
 */
function openNotice(message, opts = {}) {
  openConfirm(message, () => {}, {
    title: opts.title,
    confirmLabel: opts.closeLabel ?? t("common.close"),
    danger: false,
  });
  confirmCancelBtn.style.display = "none";
}
function closeConfirm() {
  confirmOverlay.classList.remove("active");
  confirmHandler = null;
}
confirmDeleteBtn.addEventListener("click", async () => {
  if (!confirmHandler) return;
  confirmDeleteBtn.disabled = true;
  try {
    await confirmHandler();
    closeConfirm();
  } catch (err) {
    showToast(errorText(err), "error");
  } finally {
    confirmDeleteBtn.disabled = false;
  }
});
confirmCancelBtn.addEventListener("click", closeConfirm);
// No backdrop-click close on any dialog: a stray click outside must never
// stand in for a decision. Cancel and the X are the only ways out.

// ── Table helpers ──────────────────────────────────────────────
function renderMessageRow(tbodyId, colspan, message) {
  const tbody = document.getElementById(tbodyId);
  if (tbody)
    tbody.innerHTML = `<tr><td colspan="${colspan}" class="loading-cell">${escapeHtml(message)}</td></tr>`;
}
function renderEmptyRow(tbodyId, colspan, message = t("common.noRecords")) {
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
function renderErrorRow(tbodyId, colspan, retry) {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;
  tbody.innerHTML = errorRow(colspan, t("common.loadError"), t("common.retry"));
  tbody
    .querySelector("[data-retry]")
    ?.addEventListener("click", () => retry?.());
}

/** The same failure notice for a container that is not a table body. */
function renderErrorBlock(host, retry) {
  if (!host) return;
  host.innerHTML = errorState(t("common.loadError"), t("common.retry"));
  host
    .querySelector("[data-retry]")
    ?.addEventListener("click", () => retry?.());
}

function iconBtn(icon, label, onClick, danger = false) {
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
function markSaved(tbodyId, id) {
  if (id == null) return;
  pendingSavedRow = { tbodyId, id: String(id) };
}

/**
 * Outline the freshly saved row, if this table owns it. Scoped by tbody so a
 * row that happens to share an id in another table never lights up instead.
 */
function applySavedFlash(tbodyId) {
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
function tableRow(cells, actionButtons = [], rowId = null) {
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

function optionsFrom(list, labelFn, valueKey = "id") {
  return list.map((item) => ({ value: item[valueKey], label: labelFn(item) }));
}

const fmtDate = (value) => (value ? formatDate(value) : "—");

// ── School profile (name + per-school ID label) ────────────────
// The default is "Cédula", but Costa Rican schools don't all put the same
// number in that column: private colegios with foreign families ask for the
// DIMEX, and some register students by carné until a cédula exists. So the
// label comes from school_settings with the translated default as the
// fallback. Deliberately NOT a general custom-fields system — one
// configurable label, nothing more.

/** True once the settings row has been read (or found unavailable). */
let schoolLoaded = false;

/**
 * Read the single school_settings row. A project that predates the table
 * (its schema is applied by hand) must keep working, so a failed read is
 * downgraded to "no settings" and the defaults apply.
 */
async function loadSchoolSettings() {
  if (schoolLoaded) return state.school;
  schoolLoaded = true;
  try {
    state.school = await data.getSchoolSettings();
  } catch (err) {
    console.warn("loadSchoolSettings: school_settings unavailable:", err);
    state.school = null;
  }
  return state.school;
}

/**
 * Label for the national-ID field: the school's own wording when set,
 * otherwise the translated default.
 * @param {"teachers" | "students"} scope which form/table is asking
 */
function idLabel(scope) {
  const configured = String(state.school?.id_label ?? "").trim();
  return configured || t(`console.${scope}.nationalId`);
}

/** Point the two ID column headers at the configured label. */
function applyIdLabels() {
  const heads = {
    "th-teachers-national-id": "teachers",
    "th-students-national-id": "students",
  };
  Object.entries(heads).forEach(([id, scope]) => {
    const el = document.getElementById(id);
    if (el)
      el.textContent = idLabel(/** @type {"teachers"|"students"} */ (scope));
  });
}

// ───────────────────────────────────────────────────────────────
//  4. NAVIGATION
// ───────────────────────────────────────────────────────────────
const sections = document.querySelectorAll(".view-section");
const navLinks = document.querySelectorAll(".sidebar a[data-page]");
const loaded = { settings: false };
let PROFILE = null;

const LOADERS = {
  overview: loadOverview,
  yearperiods: loadYearPeriods,
  gradessections: loadGradesSections,
  subjects: loadSubjects,
  schedules: loadSchedulesTab,
  teachers: loadTeachers,
  assignments: loadAssignments,
  students: loadStudents,
  settings: loadSettings,
};

function showSection(page) {
  sections.forEach((s) => s.classList.remove("active"));
  navLinks.forEach((a) => a.classList.remove("active"));
  document.getElementById(`view-${page}`)?.classList.add("active");
  document
    .querySelector(`.sidebar a[data-page="${page}"]`)
    ?.classList.add("active");

  if (page === "settings") {
    if (!loaded.settings) {
      loaded.settings = true;
      loadSettings();
    }
    return;
  }
  LOADERS[page]?.();
}

const closeNav = initSidebarToggle();
navLinks.forEach((link) => {
  link.addEventListener("click", (e) => {
    e.preventDefault();
    showSection(link.dataset.page);
    closeNav();
  });
});
// preventDefault matters: the button is an <a>, so without it the browser
// follows the href while signOut() is still in flight. The session is still
// live when the next page's guard runs, and role routing sends the admin
// straight back here — the logout silently does nothing.
document.getElementById("logout-btn")?.addEventListener("click", async (e) => {
  e.preventDefault();
  await signOut();
  window.location.replace("/login.html");
});
document.querySelector(".profile-photo")?.addEventListener("click", () => {
  showSection("settings");
  document
    .querySelector('#settings-root .settings-rail-item[data-section="account"]')
    ?.click();
});

initTheme();
bindThemeToggle(document.querySelector(".theme-toggler"));
initI18n("admin");
applyTranslations();

// Enhance every <select> and <input type="date"> — now and whenever the app
// renders more. Must run AFTER initI18n/applyTranslations: the date picker
// takes its month names, field order and week start from the active locale.
initControls();

// ───────────────────────────────────────────────────────────────
//  5a. OVERVIEW
// ───────────────────────────────────────────────────────────────
async function loadOverview() {
  const welcomeTitle = document.getElementById("overview-welcome-title");
  const yearText = document.getElementById("overview-year-text");
  try {
    const [profile, years] = await Promise.all([
      PROFILE ? Promise.resolve(PROFILE) : fetchProfile(),
      data.listSchoolYears(),
      loadSchoolSettings(),
    ]);
    PROFILE = profile;
    state.activeYear = years.find((y) => y.is_active) ?? null;
    applySchoolHeading();

    const name = profile?.name ?? "";
    document.getElementById("admin-name").textContent =
      name || t("console.profile.admin");
    welcomeTitle.textContent = name
      ? t("console.overview.welcome", { name })
      : t("console.overview.welcomeFallback");
    yearText.textContent = state.activeYear?.name
      ? `${t("console.overview.activeYear")}: ${state.activeYear.name}`
      : t("console.overview.noActiveYear");

    await loadOverviewStats();
  } catch (err) {
    console.error("loadOverview:", err);
    yearText.textContent = t("common.loadFailed");
  }
}

/** Title the overview with the school's own name once one is configured. */
function applySchoolHeading() {
  const heading = document.getElementById("overview-heading");
  const name = String(state.school?.name ?? "").trim();
  if (heading && name) heading.textContent = name;
}

// Count cards only. Enrollment = active students; the attendance rate =
// present+late over the current month's records; at-risk = how many students
// have 3+ recorded absences (a figure, not a roster — the per-student
// breakdown is a report, not something a director needs on a school-wide
// dashboard).
const AT_RISK_THRESHOLD = 3;
function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** First day of the month `date` falls in, as a local-time `YYYY-MM-DD`. */
function monthStartIso(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`;
}

/**
 * The month's attendance rate, as present+late over every record in the
 * window — the same numerator the student portal and the teacher console use,
 * so the three never disagree about what "attendance" counts.
 *
 * A month rather than a day because a single date is only meaningful once
 * that day has been taken: before homeroom it reads 0%, and on a holiday or
 * any day nobody recorded, it reads "no data" on a school that is running
 * perfectly well.
 *
 * `date` is a plain `date` column, so lexicographic comparison on
 * `YYYY-MM-DD` is the same as chronological — no parsing needed.
 *
 * @param {Array<{ date?: string, status?: string }>} rows every attendance row
 * @param {string} from inclusive `YYYY-MM-DD`
 * @param {string} to inclusive `YYYY-MM-DD`
 * @returns {{ rate: number, present: number, total: number }}
 */
function attendanceRate(rows, from, to) {
  const inWindow = rows.filter(
    (r) => typeof r.date === "string" && r.date >= from && r.date <= to,
  );
  const present = inWindow.filter(
    (r) => r.status === "present" || r.status === "late",
  ).length;
  return {
    rate: inWindow.length ? Math.round((present / inWindow.length) * 100) : 0,
    present,
    total: inWindow.length,
  };
}

/** Write a count into a stat card, guarding against markup drift. */
function setStat(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = String(value);
}

/**
 * First-run empty state for the overview.
 *
 * Shown only when the school is genuinely untouched — no active year, no
 * students, no teachers, no subjects, no sections. In that state the seven
 * stat cards are all em dashes, which reads as "something is broken" rather
 * than "nothing has been set up yet", and offers no way forward.
 *
 * The one action offered is "Add school year", because every other tab
 * depends on a year existing (that is the dependency order the sidebar is
 * arranged in). One screen, one obvious next step.
 *
 * @returns {boolean} true when the setup panel replaced the stats
 */
function renderOverviewSetup({ students, teachers, subjects, sectionsList }) {
  const host = document.getElementById("overview-setup");
  const stats = document.getElementById("overview-stats");
  if (!host || !stats) return false;

  const untouched =
    !state.activeYear &&
    !students.length &&
    !teachers.length &&
    !subjects.length &&
    !sectionsList.length;

  host.hidden = !untouched;
  stats.hidden = untouched;
  if (!untouched) {
    host.innerHTML = "";
    return false;
  }

  host.innerHTML = `
    <div class="console-placeholder">
      <span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-calendar_month"></use></svg></span>
      <h2>${escapeHtml(t("console.overview.setupTitle"))}</h2>
      <p>${escapeHtml(t("console.overview.setupBody"))}</p>
      <button type="button" class="btn btn-primary" id="overview-setup-cta">
        <span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-add"></use></svg></span>
        <span>${escapeHtml(t("console.years.add"))}</span>
      </button>
    </div>`;

  document
    .getElementById("overview-setup-cta")
    ?.addEventListener("click", () => {
      showSection("yearperiods");
      openYearForm();
    });
  return true;
}

async function loadOverviewStats() {
  try {
    const [students, sectionsList, allAttendance, teachers, subjects, rooms] =
      await Promise.all([
        data.listStudents(),
        state.activeYear
          ? data.listSections(state.activeYear.id)
          : Promise.resolve([]),
        // One unfiltered read serves both attendance figures below: the
        // at-risk count needs every record anyway, so the month is a filter
        // over a payload already in hand rather than a second round trip.
        data.listAllAttendance(),
        data.listTeachers(),
        data.listSubjects(),
        data.listRooms(),
      ]);
    state.students = students;
    state.sections = sectionsList;
    state.teachers = teachers;
    state.subjects = subjects;
    state.rooms = rooms;
    if (!state.gradeLevels.length)
      state.gradeLevels = await data.listGradeLevels();

    // A school with nothing in it yet gets guidance instead of seven em
    // dashes. This is the director's first screen on their first login, and
    // a grid of blank counters tells them nothing about what to do next.
    if (renderOverviewSetup({ students, teachers, subjects, sectionsList })) {
      return;
    }

    // Enrollment (active students).
    const active = students.filter((s) => s.status === "active");
    setStat("stat-enrollment", active.length);

    // Structure counts. Teachers are counted as staff on the books (active
    // ones); sections belong to the active year.
    setStat(
      "stat-teachers",
      teachers.filter((x) => x.status !== "inactive").length,
    );
    setStat("stat-subjects", subjects.length);
    setStat("stat-sections", sectionsList.length);

    // Room utilization: how many rooms this year's sections actually occupy,
    // out of all rooms on file — "8/12" answers "do we have room to grow?".
    const roomsInUse = new Set(
      sectionsList.map((s) => s.room_id).filter((id) => id != null),
    );
    setStat(
      "stat-rooms",
      rooms.length
        ? `${roomsInUse.size}/${rooms.length}`
        : t("console.overview.noData"),
    );

    // This month's attendance rate, with the month named on the card so the
    // percentage is not mistaken for a running total, and the record count
    // underneath so it reads as a sample rather than a claim.
    // The card's label is static ("Attendance this month") and translated by
    // applyTranslations; the month itself goes in the hint, where Intl can
    // name it per locale without a dictionary entry per month.
    const monthFrom = monthStartIso();
    const month = attendanceRate(allAttendance, monthFrom, todayIso());
    setStat(
      "stat-attendance",
      month.total ? `${month.rate}%` : t("console.overview.noData"),
    );
    const monthName = formatDate(monthFrom, { month: "long", year: "numeric" });
    setStat(
      "stat-attendance-hint",
      month.total
        ? `${monthName} · ${tn("console.overview.attendanceRecords", month.total, { count: month.total })}`
        : monthName,
    );

    // At-risk: how many students have crossed the absence threshold. Only
    // students still on the roster count.
    const absencesByStudent = new Map();
    allAttendance.forEach((r) => {
      if (r.status === "absent")
        absencesByStudent.set(
          r.student_id,
          (absencesByStudent.get(r.student_id) ?? 0) + 1,
        );
    });
    const atRiskCount = [...absencesByStudent.entries()].filter(
      ([studentId, n]) =>
        n >= AT_RISK_THRESHOLD && students.some((s) => s.id === studentId),
    ).length;
    setStat("stat-atrisk", atRiskCount);
  } catch (err) {
    console.error("loadOverviewStats:", err);
  }
}

async function fetchProfile() {
  const { data: row, error } = await supabase
    .from("profiles")
    .select("name, role")
    .eq("id", session.user.id)
    .single();
  if (error) throw error;
  return row;
}

// ───────────────────────────────────────────────────────────────
//  5b. YEAR & PERIODS
// ───────────────────────────────────────────────────────────────
async function loadYearPeriods() {
  renderMessageRow("years-body", 5, t("common.loading"));
  try {
    const years = await data.listSchoolYears();
    state.schoolYears = years; // the year form's name-uniqueness check
    state.activeYear = years.find((y) => y.is_active) ?? null;
    renderYears(years);
    await loadPeriods();
  } catch (err) {
    console.error("loadYearPeriods:", err);
    renderErrorRow("years-body", 5, loadYearPeriods);
  }
}

function renderYears(years) {
  const tbody = document.getElementById("years-body");
  tbody.innerHTML = "";
  if (!years.length) {
    renderEmptyRow("years-body", 5, t("console.years.empty"));
    return;
  }
  const activeIds = years.filter((y) => y.is_active).map((y) => y.id);
  years.forEach((y) => {
    const status = y.is_active
      ? `<span class="badge badge-success">${t("console.years.active")}</span>`
      : `<span class="badge badge-neutral">${t("console.years.inactive")}</span>`;
    const actions = [];
    if (!y.is_active) {
      actions.push(
        iconBtn("check_circle", t("console.years.setActive"), () =>
          activateYear(y, activeIds),
        ),
      );
    }
    actions.push(iconBtn("edit", t("common.edit"), () => openYearForm(y)));
    actions.push(
      iconBtn("delete", t("common.delete"), () => requestDeleteYear(y), true),
    );
    tbody.appendChild(
      tableRow(
        [
          escapeHtml(y.name),
          fmtDate(y.start_date),
          fmtDate(y.end_date),
          status,
        ],
        actions,
        y.id,
      ),
    );
  });
  applySavedFlash("years-body");
}

/**
 * Delete a school year, but only once nothing hangs off it.
 *
 * Every structural table cascades from school_years — grading_periods, classes
 * and class_subject_teachers directly, and through classes the enrolments,
 * schedules, attendance and grades. Deleting a populated year therefore erases
 * the school in a single click. The dialog has always told the Director its
 * periods and sections must go first; this makes that true.
 * @param {any} year
 */
async function requestDeleteYear(year) {
  /** @type {any[]} */
  let periods;
  /** @type {any[]} */
  let sections;
  try {
    [periods, sections] = await Promise.all([
      data.listPeriods(year.id),
      data.listSections(year.id),
    ]);
  } catch (err) {
    // Deliberately the opposite of activateYear's fall-through below: that one
    // is harmless when its pre-read fails, this one is irreversible, so a count
    // we could not verify has to stop the delete rather than wave it through.
    console.error("requestDeleteYear: could not count dependents:", err);
    showToast(t("console.years.deleteCheckFailed"), "error");
    return;
  }

  if (periods.length || sections.length) {
    openNotice(
      t("console.years.deleteBlocked", {
        name: year.name,
        periods: periods.length,
        sections: sections.length,
      }),
      { title: t("console.years.deleteBlockedTitle") },
    );
    return;
  }

  openConfirm(
    t("console.years.confirmDelete", { name: year.name }),
    async () => {
      await data.deleteSchoolYear(year.id);
      showToast(t("console.years.deleted"));
      loadYearPeriods();
    },
  );
}

/**
 * Make one year the active one. A year whose grading periods don't add up to
 * 100% is the state that silently breaks reporting downstream, so activating
 * one asks for confirmation first (and names the actual total) instead of
 * going through quietly.
 * @param {any} year
 * @param {number[]} previouslyActive
 */
async function activateYear(year, previouslyActive) {
  const commit = async () => {
    try {
      await data.setActiveYear(year.id, previouslyActive);
      showToast(t("console.years.activated"));
      loadYearPeriods();
    } catch (err) {
      showToast(errorText(err), "error");
    }
  };

  /** @type {any[]} */
  let periods;
  try {
    periods = await data.listPeriods(year.id);
  } catch (err) {
    // Can't verify the weights — don't block the activation on a read failure.
    console.error("activateYear: could not read periods:", err);
    await commit();
    return;
  }

  const total = totalWeight(periods);
  if (weightStatus(total, periods.length) === "ok") {
    await commit();
    return;
  }
  openConfirm(t("console.years.activateWeightWarn", { total }), commit, {
    title: t("console.years.setActive"),
    confirmLabel: t("console.years.activateAnyway"),
    danger: false,
  });
}

function openYearForm(year = null) {
  openModal({
    title: year ? t("console.years.editTitle") : t("console.years.addTitle"),
    fields: [
      {
        name: "name",
        maxLength: 20,
        label: t("console.years.name"),
        value: year?.name,
        required: true,
        placeholder: "2025-2026",
        rules: [
          v.unique(
            state.schoolYears.map((y) => y.name),
            { current: year?.name },
          ),
        ],
      },
      {
        name: "start_date",
        label: t("console.years.start"),
        type: "date",
        value: year?.start_date,
        required: true,
      },
      {
        name: "end_date",
        label: t("console.years.end"),
        type: "date",
        value: year?.end_date,
        required: true,
        rules: [v.endAfterStart("start_date")],
      },
    ],
    onSubmit: async (v) => {
      const payload = {
        name: v.name.trim(),
        start_date: v.start_date,
        end_date: v.end_date,
      };
      const saved = year
        ? await data.updateSchoolYear(year.id, payload).then(() => year)
        : await data.createSchoolYear({ ...payload, is_active: false });
      markSaved("years-body", saved?.id ?? year?.id);
      showToast(t("common.saved"));
      loadYearPeriods();
    },
  });
}

async function loadPeriods() {
  const label = document.getElementById("periods-year-label");
  const addBtn = document.getElementById("btn-add-period");
  if (!state.activeYear) {
    label.textContent = t("console.periods.noYear");
    addBtn.disabled = true;
    renderWeightTotal([]);
    renderEmptyRow("periods-body", 6, t("console.periods.noYear"));
    return;
  }
  addBtn.disabled = false;
  label.textContent = state.activeYear.name;
  renderMessageRow("periods-body", 6, t("common.loading"));
  try {
    const periods = await data.listPeriods(state.activeYear.id);
    state.periods = periods;
    renderPeriods(periods);
    renderWeightTotal(periods);
  } catch (err) {
    console.error("loadPeriods:", err);
    renderErrorRow("periods-body", 6, loadPeriods);
  }
}

/**
 * Running weight total for the year on screen. A year is only correctly
 * weighted at exactly 100%, so anything else is badged as a warning — the
 * director can see the shortfall while building the periods up one at a time.
 */
function renderWeightTotal(periods) {
  const el = document.getElementById("periods-weight-total");
  if (!el) return;
  if (!periods.length) {
    el.hidden = true;
    return;
  }
  const total = totalWeight(periods);
  const status = weightStatus(total, periods.length);
  el.hidden = false;
  el.textContent = t("console.periods.totalWeight", { total });
  el.classList.remove("badge-neutral"); // the markup's placeholder styling
  el.classList.toggle("badge-success", status === "ok");
  el.classList.toggle("badge-warning", status !== "ok");
  el.title =
    status === "ok" ? "" : t("console.periods.weightWarning", { total });
}

function renderPeriods(periods) {
  const tbody = document.getElementById("periods-body");
  tbody.innerHTML = "";
  if (!periods.length) {
    renderEmptyRow("periods-body", 6, t("console.periods.empty"));
    return;
  }
  periods.forEach((p) => {
    const actions = [
      iconBtn("edit", t("common.edit"), () => openPeriodForm(p)),
      iconBtn(
        "delete",
        t("common.delete"),
        () =>
          openConfirm(
            t("console.periods.confirmDelete", { name: p.name }),
            async () => {
              await data.deletePeriod(p.id);
              showToast(t("console.periods.deleted"));
              loadPeriods();
            },
          ),
        true,
      ),
    ];
    tbody.appendChild(
      tableRow(
        [
          escapeHtml(p.period_order),
          escapeHtml(p.name),
          fmtDate(p.start_date),
          fmtDate(p.end_date),
          p.weight != null ? `${escapeHtml(p.weight)}%` : "—",
        ],
        actions,
        p.id,
      ),
    );
  });
  applySavedFlash("periods-body");
}

function openPeriodForm(period = null) {
  // A period belongs to the active year, so its dates are bounded by that
  // year's range — both as input constraints and as a validation rule (the
  // matching DB trigger is the backstop for anything bypassing this form).
  const year = state.activeYear;
  const bounded = year?.start_date && year?.end_date;
  const withinYear = bounded
    ? [
        v.dateWithin(year.start_date, year.end_date, {
          start: fmtDate(year.start_date),
          end: fmtDate(year.end_date),
        }),
      ]
    : [];
  const dateRange = {
    min: year?.start_date,
    max: year?.end_date,
    help: bounded
      ? t("validation.dateWithin", {
          start: fmtDate(year.start_date),
          end: fmtDate(year.end_date),
        })
      : undefined,
  };

  openModal({
    title: period
      ? t("console.periods.editTitle")
      : t("console.periods.addTitle"),
    fields: [
      {
        name: "name",
        maxLength: 50,
        label: t("console.periods.name"),
        value: period?.name,
        required: true,
        placeholder: t("console.periods.namePlaceholder"),
      },
      {
        name: "period_order",
        label: t("console.periods.order"),
        type: "number",
        value: period?.period_order,
        required: true,
        min: 1,
        step: "1",
        rules: [
          v.integer(),
          v.min(1),
          v.unique(
            state.periods.map((p) => p.period_order),
            { current: period?.period_order },
          ),
        ],
      },
      {
        name: "start_date",
        label: t("console.periods.start"),
        type: "date",
        value: period?.start_date,
        required: true,
        ...dateRange,
        rules: withinYear,
      },
      {
        name: "end_date",
        label: t("console.periods.end"),
        type: "date",
        value: period?.end_date,
        required: true,
        ...dateRange,
        rules: [...withinYear, v.endAfterStart("start_date")],
      },
      {
        // A new period defaults to whatever weight is still unclaimed, so
        // building a year lands on 100% without arithmetic: 50/50 for Costa
        // Rica's two periodos, 33.33/33.33/33.34 for three trimestres. A fixed
        // default could only ever be right for one period count.
        name: "weight",
        label: t("console.periods.weight"),
        type: "number",
        value:
          period?.weight ??
          remainingWeight(state.periods, { excludeId: period?.id }),
        min: 0,
        max: 100,
        step: "0.01",
        rules: [v.percent()],
      },
    ],
    // Whole-form rule: the year's weights may never exceed 100% in total.
    // Falling short is allowed while the year is still being built (it warns
    // on save instead). Per-field rules above cover everything else.
    validate: (values) => {
      const prospective = totalWeight(state.periods, {
        excludeId: period?.id ?? null,
        extraWeight: num(values.weight),
      });
      return prospective > TARGET_WEIGHT
        ? { weight: t("console.periods.weightOver", { total: prospective }) }
        : {};
    },
    onSubmit: async (v) => {
      const payload = {
        name: v.name.trim(),
        period_order: num(v.period_order),
        start_date: v.start_date,
        end_date: v.end_date,
        weight: num(v.weight),
      };
      const saved = period
        ? await data.updatePeriod(period.id, payload).then(() => period)
        : await data.createPeriod({
            ...payload,
            school_year_id: state.activeYear.id,
          });
      markSaved("periods-body", saved?.id ?? period?.id);
      showToast(t("common.saved"));

      // Re-read first, then judge the year off the stored rows rather than the
      // submitted value, and say so loudly when it still isn't 100%.
      await loadPeriods();
      const total = totalWeight(state.periods);
      if (weightStatus(total, state.periods.length) !== "ok") {
        showToast(t("console.periods.weightWarning", { total }), "error");
      }
    },
  });
}

document
  .getElementById("btn-add-year")
  .addEventListener("click", () => openYearForm());
document
  .getElementById("btn-add-period")
  .addEventListener("click", () => openPeriodForm());

// ───────────────────────────────────────────────────────────────
//  5c. GRADES & SECTIONS
// ───────────────────────────────────────────────────────────────
async function loadGradesSections() {
  await Promise.all([loadGradeLevels(), loadRooms()]);
  await loadSections();
}

async function loadGradeLevels() {
  renderMessageRow("grades-body", 3, t("common.loading"));
  try {
    state.gradeLevels = await data.listGradeLevels();
    const tbody = document.getElementById("grades-body");
    tbody.innerHTML = "";
    if (!state.gradeLevels.length) {
      renderEmptyRow("grades-body", 3, t("console.grades.empty"));
      return;
    }
    state.gradeLevels.forEach((g) => {
      tbody.appendChild(
        tableRow(
          [escapeHtml(g.numeric_level), escapeHtml(g.name)],
          [
            iconBtn("edit", t("common.edit"), () => openGradeForm(g)),
            iconBtn(
              "delete",
              t("common.delete"),
              () =>
                openConfirm(
                  t("console.grades.confirmDelete", { name: g.name }),
                  async () => {
                    await data.deleteGradeLevel(g.id);
                    showToast(t("common.deleted"));
                    loadGradeLevels();
                  },
                ),
              true,
            ),
          ],
          g.id,
        ),
      );
    });
    applySavedFlash("grades-body");
  } catch (err) {
    console.error("loadGradeLevels:", err);
    renderErrorRow("grades-body", 3, loadGradeLevels);
  }
}

function openGradeForm(grade = null) {
  openModal({
    title: grade ? t("console.grades.editTitle") : t("console.grades.addTitle"),
    fields: [
      {
        name: "numeric_level",
        label: t("console.grades.level"),
        type: "number",
        value: grade?.numeric_level,
        required: true,
        min: 1,
        rules: [
          v.integer(),
          v.min(1),
          v.unique(
            state.gradeLevels.map((g) => g.numeric_level),
            { current: grade?.numeric_level },
          ),
        ],
      },
      {
        name: "name",
        maxLength: 50,
        label: t("console.grades.name"),
        value: grade?.name,
        required: true,
        placeholder: t("console.grades.namePlaceholder"),
        rules: [
          v.unique(
            state.gradeLevels.map((g) => g.name),
            { current: grade?.name },
          ),
        ],
      },
    ],
    onSubmit: async (v) => {
      const payload = {
        numeric_level: num(v.numeric_level),
        name: v.name.trim(),
      };
      const saved = grade
        ? await data.updateGradeLevel(grade.id, payload).then(() => grade)
        : await data.createGradeLevel(payload);
      markSaved("grades-body", saved?.id ?? grade?.id);
      showToast(t("common.saved"));
      loadGradeLevels();
    },
  });
}

async function loadRooms() {
  renderMessageRow("rooms-body", 4, t("common.loading"));
  try {
    state.rooms = await data.listRooms();
    const tbody = document.getElementById("rooms-body");
    tbody.innerHTML = "";
    if (!state.rooms.length) {
      renderEmptyRow("rooms-body", 4, t("console.rooms.empty"));
      return;
    }
    state.rooms.forEach((r) => {
      tbody.appendChild(
        tableRow(
          [
            escapeHtml(r.name),
            r.capacity != null ? escapeHtml(r.capacity) : "—",
            `<span class="badge badge-neutral">${escapeHtml(t(`console.rooms.types.${r.type ?? "classroom"}`))}</span>`,
          ],
          [
            iconBtn("edit", t("common.edit"), () => openRoomForm(r)),
            iconBtn(
              "delete",
              t("common.delete"),
              () =>
                openConfirm(
                  t("console.rooms.confirmDelete", { name: r.name }),
                  async () => {
                    await data.deleteRoom(r.id);
                    showToast(t("common.deleted"));
                    loadRooms();
                  },
                ),
              true,
            ),
          ],
          r.id,
        ),
      );
    });
    applySavedFlash("rooms-body");
  } catch (err) {
    console.error("loadRooms:", err);
    renderErrorRow("rooms-body", 4, loadRooms);
  }
}

const ROOM_TYPES = [
  "classroom",
  "lab",
  "gym",
  "library",
  "auditorium",
  "office",
];

function openRoomForm(room = null) {
  openModal({
    title: room ? t("console.rooms.editTitle") : t("console.rooms.addTitle"),
    fields: [
      {
        name: "name",
        maxLength: 50,
        label: t("console.rooms.name"),
        value: room?.name,
        required: true,
        rules: [
          v.unique(
            state.rooms.map((r) => r.name),
            { current: room?.name },
          ),
        ],
      },
      {
        name: "capacity",
        label: t("console.rooms.capacity"),
        type: "number",
        value: room?.capacity,
        min: 1,
        rules: [v.integer(), v.min(1)],
      },
      {
        name: "type",
        label: t("console.rooms.type"),
        type: "select",
        value: room?.type ?? "classroom",
        required: true,
        options: ROOM_TYPES.map((v) => ({
          value: v,
          label: t(`console.rooms.types.${v}`),
        })),
      },
    ],
    onSubmit: async (v) => {
      const payload = {
        name: v.name.trim(),
        capacity: num(v.capacity),
        type: v.type,
      };
      const saved = room
        ? await data.updateRoom(room.id, payload).then(() => room)
        : await data.createRoom(payload);
      markSaved("rooms-body", saved?.id ?? room?.id);
      showToast(t("common.saved"));
      loadRooms();
    },
  });
}

async function loadSections() {
  const label = document.getElementById("sections-year-label");
  const addBtn = document.getElementById("btn-add-section");
  if (!state.activeYear) {
    const years = await data.listSchoolYears();
    state.activeYear = years.find((y) => y.is_active) ?? null;
  }
  if (!state.activeYear) {
    label.textContent = t("console.sections.noYear");
    addBtn.disabled = true;
    renderEmptyRow("sections-body", 6, t("console.sections.noYear"));
    return;
  }
  addBtn.disabled = false;
  label.textContent = state.activeYear.name;
  renderMessageRow("sections-body", 6, t("common.loading"));
  try {
    const [sectionsList, teachers] = await Promise.all([
      data.listSections(state.activeYear.id),
      state.teachers.length
        ? Promise.resolve(state.teachers)
        : data.listTeachers(),
    ]);
    state.sections = sectionsList;
    state.teachers = teachers;
    renderSections(sectionsList);
  } catch (err) {
    console.error("loadSections:", err);
    renderErrorRow("sections-body", 6, loadSections);
  }
}

function gradeName(id) {
  const g = state.gradeLevels.find((x) => x.id === id);
  return g ? g.name : "—";
}
function roomName(id) {
  const r = state.rooms.find((x) => x.id === id);
  return r ? r.name : "—";
}
function teacherName(id) {
  const tch = state.teachers.find((x) => x.id === id);
  return tch ? `${tch.first_name} ${tch.last_name}` : "—";
}
/**
 * Human-readable label for a section — "10th Grade — Section A", the same
 * phrasing the student portal uses. `display_name` is a storage code
 * (numeric level + section, e.g. "1010-1") and reads as noise in a picker,
 * so it is only the fallback for when grade levels aren't loaded yet.
 */
function sectionName(sec) {
  const grade = state.gradeLevels.find((g) => g.id === sec.grade_level_id);
  if (!grade) return sec.display_name || String(sec.section ?? "—");
  return t("student.classLine", { grade: grade.name, section: sec.section });
}

function renderSections(list) {
  const tbody = document.getElementById("sections-body");
  tbody.innerHTML = "";
  if (!list.length) {
    renderEmptyRow("sections-body", 6, t("console.sections.empty"));
    return;
  }
  list.forEach((s) => {
    tbody.appendChild(
      tableRow(
        [
          escapeHtml(gradeName(s.grade_level_id)),
          escapeHtml(s.section),
          escapeHtml(
            s.homeroom_teacher_id ? teacherName(s.homeroom_teacher_id) : "—",
          ),
          escapeHtml(s.room_id ? roomName(s.room_id) : "—"),
          s.max_capacity != null ? escapeHtml(s.max_capacity) : "—",
        ],
        [
          iconBtn("edit", t("common.edit"), () => openSectionForm(s)),
          iconBtn(
            "delete",
            t("common.delete"),
            () =>
              openConfirm(
                t("console.sections.confirmDelete", { name: sectionName(s) }),
                async () => {
                  await data.deleteSection(s.id);
                  showToast(t("common.deleted"));
                  loadSections();
                },
              ),
            true,
          ),
        ],
        s.id,
      ),
    );
  });
  applySavedFlash("sections-body");
}

function openSectionForm(section = null) {
  if (!state.gradeLevels.length) {
    showToast(t("console.sections.needGrade"), "error");
    return;
  }
  openModal({
    title: section
      ? t("console.sections.editTitle")
      : t("console.sections.addTitle"),
    fields: [
      {
        name: "grade_level_id",
        label: t("console.sections.grade"),
        type: "select",
        value: section?.grade_level_id,
        required: true,
        options: optionsFrom(
          state.gradeLevels,
          (g) => `${g.name} (${g.numeric_level})`,
        ),
      },
      {
        name: "section",
        maxLength: 10,
        label: t("console.sections.section"),
        value: section?.section,
        required: true,
        placeholder: "A",
      },
      {
        // Optional on purpose: a section can exist before its lead teacher is
        // decided. The help text explains the role, which "Homeroom" alone
        // doesn't convey to a director setting up their first year.
        name: "homeroom_teacher_id",
        label: t("console.sections.homeroom"),
        type: "select",
        value: section?.homeroom_teacher_id,
        help: t("console.sections.homeroomHelp"),
        options: optionsFrom(
          state.teachers,
          (tch) => `${tch.first_name} ${tch.last_name}`,
        ),
      },
      {
        name: "room_id",
        label: t("console.sections.room"),
        type: "select",
        value: section?.room_id,
        options: optionsFrom(state.rooms, (r) => r.name),
      },
      {
        name: "max_capacity",
        label: t("console.sections.capacity"),
        type: "number",
        value: section?.max_capacity ?? 30,
        min: 1,
        rules: [
          v.integer(),
          v.min(1),
          // A section can't seat more students than its room holds. Nothing
          // enforced this before, in the client or the database.
          v.atMost(
            (values) =>
              state.rooms.find((r) => String(r.id) === String(values.room_id))
                ?.capacity,
            "validation.capacityRoom",
            (capacity, roomCapacity) => ({ capacity, roomCapacity }),
          ),
        ],
      },
    ],
    onSubmit: async (v) => {
      const gl = state.gradeLevels.find(
        (g) => String(g.id) === String(v.grade_level_id),
      );
      const sectionCode = v.section.trim();
      const payload = {
        grade_level_id: num(v.grade_level_id),
        section: sectionCode,
        display_name: gl ? `${gl.numeric_level}${sectionCode}` : sectionCode,
        homeroom_teacher_id: num(v.homeroom_teacher_id),
        room_id: num(v.room_id),
        max_capacity: num(v.max_capacity),
      };
      const saved = section
        ? await data.updateSection(section.id, payload).then(() => section)
        : await data.createSection({
            ...payload,
            school_year_id: state.activeYear.id,
          });
      markSaved("sections-body", saved?.id ?? section?.id);
      showToast(t("common.saved"));
      loadSections();
    },
  });
}

document
  .getElementById("btn-add-grade")
  .addEventListener("click", () => openGradeForm());
document
  .getElementById("btn-add-room")
  .addEventListener("click", () => openRoomForm());
document
  .getElementById("btn-add-section")
  .addEventListener("click", () => openSectionForm());

// ───────────────────────────────────────────────────────────────
//  5d. SUBJECTS (+ grade-level mapping)
// ───────────────────────────────────────────────────────────────
async function loadSubjects() {
  renderMessageRow("subjects-body", 5, t("common.loading"));
  try {
    const [subjects, gls, mapping] = await Promise.all([
      data.listSubjects(),
      state.gradeLevels.length
        ? Promise.resolve(state.gradeLevels)
        : data.listGradeLevels(),
      data.listGradeLevelSubjects(),
    ]);
    state.subjects = subjects;
    state.gradeLevels = gls;
    renderSubjects(subjects, mapping);
  } catch (err) {
    console.error("loadSubjects:", err);
    renderErrorRow("subjects-body", 5, loadSubjects);
  }
}

function renderSubjects(subjects, mapping) {
  const tbody = document.getElementById("subjects-body");
  tbody.innerHTML = "";
  if (!subjects.length) {
    renderEmptyRow("subjects-body", 5, t("console.subjects.empty"));
    return;
  }
  const bySubject = new Map();
  mapping.forEach((m) => {
    if (!bySubject.has(m.subject_id)) bySubject.set(m.subject_id, []);
    bySubject.get(m.subject_id).push(m);
  });

  subjects.forEach((s) => {
    const mapped = bySubject.get(s.id) ?? [];
    const gradeNames =
      mapped
        .map((m) => gradeName(m.grade_level_id))
        .filter((n) => n !== "—")
        .join(", ") || "—";
    const swatch = s.color
      ? `<span class="color-swatch" style="background:${escapeHtml(s.color)}"></span>${escapeHtml(s.color)}`
      : "—";
    tbody.appendChild(
      tableRow(
        [
          `<code>${escapeHtml(s.code ?? "—")}</code>`,
          escapeHtml(s.name),
          swatch,
          escapeHtml(gradeNames),
        ],
        [
          iconBtn("edit", t("common.edit"), () => openSubjectForm(s, mapped)),
          iconBtn(
            "delete",
            t("common.delete"),
            () =>
              openConfirm(
                t("console.subjects.confirmDelete", { name: s.name }),
                async () => {
                  await data.deleteSubject(s.id);
                  showToast(t("common.deleted"));
                  loadSubjects();
                },
              ),
            true,
          ),
        ],
        s.id,
      ),
    );
  });
  applySavedFlash("subjects-body");
}

function openSubjectForm(subject = null, mapped = []) {
  const mappedGradeIds = mapped.map((m) => m.grade_level_id);
  openModal({
    title: subject
      ? t("console.subjects.editTitle")
      : t("console.subjects.addTitle"),
    fields: [
      {
        name: "name",
        maxLength: 100,
        label: t("console.subjects.name"),
        value: subject?.name,
        required: true,
        rules: [
          v.unique(
            state.subjects.map((s) => s.name),
            { current: subject?.name },
          ),
        ],
      },
      {
        name: "code",
        maxLength: 10,
        label: t("console.subjects.code"),
        value: subject?.code,
        placeholder: "MATH7",
        rules: [
          v.unique(
            state.subjects.map((s) => s.code),
            { current: subject?.code },
          ),
        ],
      },
      {
        name: "color",
        label: t("console.subjects.color"),
        type: "color",
        value: subject?.color ?? "#7380ec",
      },
      {
        name: "description",
        label: t("console.subjects.description"),
        type: "textarea",
        value: subject?.description,
      },
      {
        name: "grades",
        label: t("console.subjects.gradeLevels"),
        type: "checkboxes",
        value: mappedGradeIds,
        options: optionsFrom(state.gradeLevels, (g) => g.name),
      },
    ],
    onSubmit: async (v) => {
      const payload = {
        name: v.name.trim(),
        code: nullable(v.code),
        color: nullable(v.color),
        description: nullable(v.description),
      };
      let subjectId = subject?.id;
      if (subject) await data.updateSubject(subject.id, payload);
      else {
        const created = await data.createSubject(payload);
        subjectId = created.id;
      }
      markSaved("subjects-body", subjectId);
      // Reconcile grade-level mapping (add checked, remove unchecked).
      const desired = new Set(v.grades.map(Number));
      const current = new Map(mapped.map((m) => [m.grade_level_id, m.id]));
      for (const gid of desired) {
        if (!current.has(gid))
          await data.createGradeLevelSubject({
            subject_id: subjectId,
            grade_level_id: gid,
            weekly_hours: 4,
          });
      }
      for (const [gid, mapId] of current) {
        if (!desired.has(gid)) await data.deleteGradeLevelSubject(mapId);
      }
      showToast(t("common.saved"));
      loadSubjects();
    },
  });
}

document
  .getElementById("btn-add-subject")
  .addEventListener("click", () => openSubjectForm());

// ───────────────────────────────────────────────────────────────
//  5e. TEACHERS (+ assignments)
// ───────────────────────────────────────────────────────────────
async function loadTeachers() {
  renderMessageRow("teachers-body", 6, t("common.loading"));
  try {
    state.teachers = await data.listTeachers();
    renderTeachers(state.teachers);
  } catch (err) {
    console.error("loadTeachers:", err);
    renderErrorRow("teachers-body", 6, loadTeachers);
  }
}

const TEACHER_STATUSES = ["active", "inactive", "on_leave"];

function renderTeachers(list) {
  const tbody = document.getElementById("teachers-body");
  tbody.innerHTML = "";
  if (!list.length) {
    renderEmptyRow("teachers-body", 6, t("console.teachers.empty"));
    return;
  }
  list.forEach((tch) => {
    const statusBadge = `<span class="badge ${tch.status === "active" ? "badge-success" : "badge-neutral"}">${escapeHtml(t(`console.teachers.statuses.${tch.status ?? "active"}`))}</span>`;
    tbody.appendChild(
      tableRow(
        [
          escapeHtml(`${tch.first_name} ${tch.last_name}`),
          escapeHtml(tch.national_id ?? "—"),
          escapeHtml(tch.email ?? "—"),
          escapeHtml(tch.specialization ?? "—"),
          statusBadge,
        ],
        [
          accountBtn(tch, "teacher", loadTeachers),
          iconBtn("edit", t("common.edit"), () => openTeacherForm(tch)),
          iconBtn(
            "delete",
            t("common.delete"),
            () =>
              openConfirm(
                t("console.teachers.confirmDelete", {
                  name: `${tch.first_name} ${tch.last_name}`,
                }),
                async () => {
                  await data.deleteTeacher(tch.id);
                  showToast(t("common.deleted"));
                  loadTeachers();
                },
              ),
            true,
          ),
        ],
        tch.id,
      ),
    );
  });
  applySavedFlash("teachers-body");
}

// ── Login accounts (Edge Function in real mode; simulated in demo) ──
// A record with a linked auth user shows "reset password"; otherwise
// "create login". `reload` re-renders the owning section afterward.
function accountBtn(record, kind, reload) {
  if (record.auth_user_id) {
    return iconBtn("lock_reset", t("console.accounts.reset"), () =>
      openConfirm(
        t("console.accounts.confirmReset", { email: record.email ?? "" }),
        async () => {
          const res = await resetPassword(record.email);
          showToast(
            res?.simulated
              ? t("console.accounts.resetDemo")
              : t("console.accounts.resetSent"),
          );
        },
      ),
    );
  }
  return iconBtn("person_add", t("console.accounts.create"), () =>
    openCreateAccount(record, kind, reload),
  );
}

function openCreateAccount(record, kind, reload) {
  const name = `${record.first_name} ${record.last_name}`.trim();
  openModal({
    title: t("console.accounts.createTitle", { name }),
    submitLabel: t("console.accounts.create"),
    fields: [
      {
        name: "email",
        label: t("console.accounts.email"),
        type: "email",
        value: record.email ?? "",
        required: true,
        rules: [v.email()],
      },
      {
        name: "password",
        label: t("console.accounts.tempPassword"),
        value: generateTempPassword(),
        required: true,
        help: t("console.accounts.tempPasswordHelp"),
        rules: [v.password()],
      },
    ],
    onSubmit: async (v) => {
      const res = await createAccount({
        email: v.email.trim(),
        password: v.password,
        role: kind,
        name,
        linkType: kind,
        linkId: record.id,
      });
      // Demo mode never mints a real user; reflect the link locally so the
      // row flips to "reset password" (discarded on refresh, like all demo
      // writes). Real mode already linked server-side; the reload re-fetches.
      if (res?.simulated) {
        const patch = { auth_user_id: `demo-${kind}-${record.id}` };
        if (kind === "teacher") await data.updateTeacher(record.id, patch);
        else await data.updateStudent(record.id, patch);
      }
      showToast(
        res?.simulated
          ? t("console.accounts.createdDemo")
          : t("console.accounts.created"),
      );
      reload();
    },
  });
}

function openTeacherForm(teacher = null) {
  openModal({
    title: teacher
      ? t("console.teachers.editTitle")
      : t("console.teachers.addTitle"),
    fields: [
      {
        name: "first_name",
        maxLength: 100,
        label: t("console.teachers.firstName"),
        value: teacher?.first_name,
        required: true,
      },
      {
        name: "last_name",
        maxLength: 100,
        label: t("console.teachers.lastName"),
        value: teacher?.last_name,
        required: true,
      },
      {
        // Optional by design: not every school records a national ID, and the
        // field is called something different in each country (see idLabel).
        name: "national_id",
        maxLength: 20,
        label: idLabel("teachers"),
        value: teacher?.national_id,
        rules: [
          v.unique(
            state.teachers.map((x) => x.national_id),
            { current: teacher?.national_id },
          ),
        ],
      },
      {
        name: "email",
        maxLength: 150,
        label: t("console.teachers.email"),
        type: "email",
        value: teacher?.email,
        rules: [
          v.email(),
          v.unique(
            state.teachers.map((x) => x.email),
            { current: teacher?.email },
          ),
        ],
      },
      {
        name: "phone",
        maxLength: 20,
        label: t("console.teachers.phone"),
        value: teacher?.phone,
        rules: [v.phone()],
      },
      {
        name: "specialization",
        maxLength: 100,
        label: t("console.teachers.specialization"),
        value: teacher?.specialization,
      },
      {
        name: "status",
        label: t("console.teachers.status"),
        type: "select",
        value: teacher?.status ?? "active",
        required: true,
        options: TEACHER_STATUSES.map((v) => ({
          value: v,
          label: t(`console.teachers.statuses.${v}`),
        })),
      },
    ],
    onSubmit: async (v) => {
      const payload = {
        first_name: v.first_name.trim(),
        last_name: v.last_name.trim(),
        national_id: nullable(v.national_id),
        email: nullable(v.email),
        phone: nullable(v.phone),
        specialization: nullable(v.specialization),
        status: v.status,
      };
      const saved = teacher
        ? await data.updateTeacher(teacher.id, payload).then(() => teacher)
        : await data.createTeacher(payload);
      markSaved("teachers-body", saved?.id ?? teacher?.id);
      showToast(t("common.saved"));
      loadTeachers();
    },
  });
}

async function loadAssignments() {
  const label = document.getElementById("assignments-year-label");
  const addBtn = document.getElementById("btn-add-assignment");
  if (!state.activeYear) {
    const years = await data.listSchoolYears();
    state.activeYear = years.find((y) => y.is_active) ?? null;
  }
  if (!state.activeYear) {
    label.textContent = t("console.assignments.noYear");
    addBtn.disabled = true;
    renderEmptyRow("assignments-body", 4, t("console.assignments.noYear"));
    return;
  }
  addBtn.disabled = false;
  label.textContent = state.activeYear.name;
  renderMessageRow("assignments-body", 4, t("common.loading"));
  try {
    // Assignments is its own tab now, so it can be the first thing opened —
    // it has to fetch the teachers it names rather than inherit them from
    // whichever section happened to load first.
    await ensureTeachers();
    const [assignments, sectionsList, subjects] = await Promise.all([
      data.listAssignments(state.activeYear.id),
      data.listSections(state.activeYear.id),
      state.subjects.length
        ? Promise.resolve(state.subjects)
        : data.listSubjects(),
    ]);
    state.sections = sectionsList;
    state.subjects = subjects;
    if (!state.gradeLevels.length)
      state.gradeLevels = await data.listGradeLevels();
    renderAssignments(assignments);
  } catch (err) {
    console.error("loadAssignments:", err);
    renderErrorRow("assignments-body", 4, loadAssignments);
  }
}

function subjectName(id) {
  const s = state.subjects.find((x) => x.id === id);
  return s ? s.name : "—";
}

function renderAssignments(list) {
  const tbody = document.getElementById("assignments-body");
  tbody.innerHTML = "";
  if (!list.length) {
    renderEmptyRow("assignments-body", 4, t("console.assignments.empty"));
    return;
  }
  list.forEach((a) => {
    const sec = state.sections.find((s) => s.id === a.class_id);
    tbody.appendChild(
      tableRow(
        [
          escapeHtml(sec ? sectionName(sec) : "—"),
          escapeHtml(subjectName(a.subject_id)),
          escapeHtml(teacherName(a.teacher_id)),
        ],
        [
          iconBtn("edit", t("common.edit"), () => openAssignmentForm(a)),
          iconBtn(
            "delete",
            t("common.delete"),
            () =>
              openConfirm(t("console.assignments.confirmDelete"), async () => {
                await data.deleteAssignment(a.id);
                showToast(t("common.deleted"));
                loadAssignments();
              }),
            true,
          ),
        ],
        a.id,
      ),
    );
  });
  applySavedFlash("assignments-body");
}

/**
 * Create an assignment, or reassign an existing one's teacher.
 *
 * Editing is deliberately limited to the teacher. Section and subject identify
 * the assignment — changing them would silently re-parent the grades,
 * assignments and categories that cascade off this row, and can collide with
 * the (class, subject, year) unique key. Correcting either of those is a
 * delete-and-recreate, which is safe precisely when there is nothing to lose.
 * @param {any} [assignment] the row to reassign; omit to create
 */
function openAssignmentForm(assignment = null) {
  if (
    !state.sections.length ||
    !state.subjects.length ||
    !state.teachers.length
  ) {
    showToast(t("console.assignments.needData"), "error");
    return;
  }

  const teacherField = {
    name: "teacher_id",
    label: t("console.assignments.teacher"),
    type: "select",
    required: true,
    value: assignment?.teacher_id,
    options: optionsFrom(
      state.teachers,
      (tch) => `${tch.first_name} ${tch.last_name}`,
    ),
  };

  if (assignment) {
    const sec = state.sections.find((s) => s.id === assignment.class_id);
    openModal({
      // The pair being reassigned is named in the title rather than shown as
      // dead form controls, so nothing on screen invites an edit that is not on
      // offer.
      title: t("console.assignments.editTitle", {
        section: sec ? sectionName(sec) : "—",
        subject: subjectName(assignment.subject_id),
      }),
      fields: [teacherField],
      onSubmit: async (v) => {
        await data.updateAssignment(assignment.id, {
          teacher_id: num(v.teacher_id),
        });
        markSaved("assignments-body", assignment.id);
        showToast(t("common.saved"));
        loadAssignments();
      },
    });
    return;
  }

  openModal({
    title: t("console.assignments.addTitle"),
    fields: [
      {
        name: "class_id",
        label: t("console.assignments.section"),
        type: "select",
        required: true,
        options: optionsFrom(state.sections, (s) => sectionName(s)),
      },
      {
        name: "subject_id",
        label: t("console.assignments.subject"),
        type: "select",
        required: true,
        options: optionsFrom(state.subjects, (s) => s.name),
      },
      teacherField,
    ],
    onSubmit: async (v) => {
      const created = await data.createAssignment({
        class_id: num(v.class_id),
        subject_id: num(v.subject_id),
        teacher_id: num(v.teacher_id),
        school_year_id: state.activeYear.id,
      });
      markSaved("assignments-body", created?.id);
      showToast(t("common.saved"));
      loadAssignments();
    },
  });
}

document
  .getElementById("btn-add-teacher")
  .addEventListener("click", () => openTeacherForm());
document
  .getElementById("btn-add-assignment")
  .addEventListener("click", () => openAssignmentForm());

// ───────────────────────────────────────────────────────────────
//  5f. SCHEDULES
// ───────────────────────────────────────────────────────────────
//  Two sub-tabs behind one nav entry:
//    • the weekly editor — one section's week as a grid, with a bell
//      schedule optionally laying out the rows;
//    • bell schedules — the reusable time-block templates themselves.
//
//  All the rules (overlaps, double-booked teachers and rooms, what a
//  copy would do) live in scheduleLogic.js; this section is DOM glue and
//  translation. Conflicts come back typed: a `section` clash is rejected,
//  a `teacher`/`room` clash is a warning the director can override —
//  co-teaching and shared rooms are real.

const scheduleRoot = document.getElementById("schedules-root");

/** Which sub-tab is showing. */
let schedTab = "editor";

const dayLabel = (dow) => {
  const key = sched.dayKey(Number(dow));
  return key ? t(`common.days.${key}`) : "—";
};

/** "08:00–08:45", the way a time slot reads everywhere in this tab. */
const slotLabel = (start, end) =>
  `${sched.normalizeTime(start)}–${sched.normalizeTime(end)}`;

/** The section currently being edited, if it still exists. */
function currentSchedSection() {
  return state.sections.find((s) => s.id === state.schedSectionId) ?? null;
}

/** Entries of the section on screen. */
function currentSchedEntries() {
  return state.yearSchedules.filter((e) => e.class_id === state.schedSectionId);
}

/**
 * One conflict as a sentence. The three kinds name the resource that is
 * double-booked, then where it is already committed.
 * @param {{ type: string, entry: any }} conflict
 */
function conflictText(conflict) {
  const { type, entry } = conflict;
  const section = state.sections.find((s) => s.id === entry.class_id);
  const where = `${dayLabel(entry.day_of_week)} ${slotLabel(entry.start_time, entry.end_time)}`;
  const detail = section
    ? `${sectionName(section)} · ${subjectName(entry.subject_id)} · ${where}`
    : where;
  if (type === "teacher") {
    return t("console.schedules.conflicts.teacher", {
      teacher: teacherName(entry.teacher_id),
      detail,
    });
  }
  if (type === "room") {
    return t("console.schedules.conflicts.room", {
      room: roomName(entry.room_id),
      detail,
    });
  }
  return t("console.schedules.conflicts.section", {
    section: section ? sectionName(section) : "—",
    detail,
  });
}

async function loadSchedulesTab() {
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

    const [config, bells, entries] = await Promise.all([
      optionalRead(
        "schedule_configs",
        data.getScheduleConfig(state.activeYear.id),
        null,
      ),
      optionalRead("bell_schedules", data.listBellSchedules(), []),
      data.listYearSchedules(sectionsList.map((s) => s.id)),
    ]);
    state.scheduleConfig = config;
    state.bellSchedules = bells;
    state.yearSchedules = entries;

    // Keep the chosen section across reloads when it is still around.
    if (!currentSchedSection()) {
      state.schedSectionId = sectionsList[0]?.id ?? null;
    }
    renderSchedulesTab();
  } catch (err) {
    console.error("loadSchedulesTab:", err);
    scheduleRoot.innerHTML = `<div class="console-panel"></div>`;
    renderErrorBlock(scheduleRoot.firstElementChild, loadSchedulesTab);
  }
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

/** Sub-tab rail + the active panel. Mirrors the settings rail's ARIA. */
function renderSchedulesTab() {
  scheduleRoot.innerHTML = "";
  const rail = document.createElement("div");
  rail.className = "settings-rail";
  rail.setAttribute("role", "tablist");
  [
    {
      id: "editor",
      labelKey: "console.schedules.rail.editor",
      icon: "schedule",
    },
    {
      id: "templates",
      labelKey: "console.schedules.rail.templates",
      icon: "list_alt",
    },
  ].forEach((tab) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `settings-rail-item${schedTab === tab.id ? " active" : ""}`;
    btn.dataset.section = tab.id;
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", String(schedTab === tab.id));
    btn.innerHTML = `<span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-${tab.icon}"></use></svg></span><span>${escapeHtml(t(tab.labelKey))}</span>`;
    btn.addEventListener("click", () => {
      schedTab = tab.id;
      renderSchedulesTab();
    });
    rail.appendChild(btn);
  });
  scheduleRoot.appendChild(rail);

  const panel = document.createElement("div");
  panel.className = "settings-panel active";
  panel.setAttribute("role", "tabpanel");
  scheduleRoot.appendChild(panel);
  if (schedTab === "templates") renderBellPanel(panel);
  else renderEditorPanel(panel);
}

// ── Weekly editor ──────────────────────────────────────────────
function renderEditorPanel(panel) {
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

  // Toolbar: which section, which bell schedule, and the week's shape.
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
        renderSchedulesTab();
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
        renderSchedulesTab();
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
  wrap.appendChild(toolbar);

  wrap.appendChild(buildScheduleGrid());
  panel.appendChild(wrap);
  panel.appendChild(buildConflictsPanel());
}

/** A labelled <select> for the toolbar. */
function labeledSelect(
  id,
  label,
  options,
  value,
  onChange,
  allowEmpty = false,
) {
  const group = document.createElement("div");
  group.className = "sched-field";
  const lab = document.createElement("label");
  lab.textContent = label;
  lab.htmlFor = id;
  group.appendChild(lab);
  const select = document.createElement("select");
  select.id = id;
  options.forEach((opt) => {
    const o = document.createElement("option");
    o.value = String(opt.value);
    o.textContent = opt.label;
    if (String(opt.value) === String(value ?? "")) o.selected = true;
    select.appendChild(o);
  });
  if (!allowEmpty && !options.length) select.disabled = true;
  select.addEventListener("change", () => onChange(select.value));
  group.appendChild(select);
  return group;
}

function ghostButton(icon, label, onClick) {
  const btn = document.createElement("button");
  btn.className = "btn btn-ghost btn-sm";
  btn.type = "button";
  btn.innerHTML = `<span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-${icon}"></use></svg></span><span>${escapeHtml(label)}</span>`;
  btn.addEventListener("click", onClick);
  return btn;
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
    cell.appendChild(add);
    return cell;
  }

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
  cell.appendChild(card);
  return cell;
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

/** Re-read the year's entries and repaint. */
async function reloadYearSchedules() {
  state.yearSchedules = await data.listYearSchedules(
    state.sections.map((s) => s.id),
  );
  renderSchedulesTab();
}

/**
 * Add or edit one class period.
 * @param {any} [entry] the row being edited, if any
 * @param {any} [prefill] day/time to start from (clicking an empty slot)
 */
function openScheduleEntryForm(entry = null, prefill = null) {
  const section = currentSchedSection();
  if (!section) {
    showToast(t("console.schedules.editor.pickSection"), "error");
    return;
  }
  const days = sched.resolveActiveDays(state.scheduleConfig);
  const source = entry ?? prefill ?? {};

  openModal({
    title: entry
      ? t("console.schedules.editor.editTitle")
      : t("console.schedules.editor.addTitle"),
    fields: [
      {
        name: "day_of_week",
        label: t("console.schedules.day"),
        type: "select",
        required: true,
        value: source.day_of_week ?? days[0],
        options: days.map((d) => ({ value: d, label: dayLabel(d) })),
      },
      {
        name: "start_time",
        label: t("console.schedules.start"),
        type: "time",
        required: true,
        value: sched.normalizeTime(source.start_time),
      },
      {
        name: "end_time",
        label: t("console.schedules.end"),
        type: "time",
        required: true,
        value: sched.normalizeTime(source.end_time),
        rules: [v.endAfterStart("start_time")],
      },
      {
        name: "subject_id",
        label: t("console.schedules.subject"),
        type: "select",
        required: true,
        value: source.subject_id,
        options: optionsFrom(state.subjects, (s) => s.name),
      },
      {
        name: "teacher_id",
        label: t("console.schedules.teacher"),
        type: "select",
        required: true,
        value: source.teacher_id,
        options: optionsFrom(
          state.teachers,
          (tch) => `${tch.first_name} ${tch.last_name}`,
        ),
      },
      {
        name: "room_id",
        label: t("console.schedules.room"),
        type: "select",
        value: source.room_id ?? "",
        options: optionsFrom(state.rooms, (r) => r.name),
      },
    ],
    // The section clashing with itself is rejected inline; a teacher or
    // room clash is confirmed instead (see below), never silently blocked.
    validate: (values) => {
      const candidate = entryFromValues(values, section.id);
      const clashes = sched.findConflicts(candidate, state.yearSchedules, {
        excludeId: entry?.id ?? null,
      });
      const own = clashes.find((c) => c.type === "section");
      return own ? { start_time: conflictText(own) } : {};
    },
    onSubmit: async (values) => {
      const candidate = entryFromValues(values, section.id);
      const warnings = sched
        .findConflicts(candidate, state.yearSchedules, {
          excludeId: entry?.id ?? null,
        })
        .filter((c) => c.type !== "section");

      const write = async () => {
        if (entry) await data.updateSchedule(entry.id, candidate);
        else await data.createSchedule(candidate);
        showToast(
          t(
            entry
              ? "console.schedules.editor.updated"
              : "console.schedules.editor.added",
          ),
        );
        await reloadYearSchedules();
      };

      if (!warnings.length) {
        await write();
        return;
      }
      // Deliberately not a hard stop: co-teaching, assemblies and split
      // rooms are legitimate, so the director gets the facts and decides.
      openConfirm(
        `${t("console.schedules.conflicts.reviewIntro")}\n\n${warnings
          .map(conflictText)
          .join("\n")}`,
        write,
        {
          title: t("console.schedules.conflicts.reviewTitle"),
          confirmLabel: t("console.schedules.conflicts.saveAnyway"),
          danger: false,
        },
      );
    },
  });
}

/** Modal values → a schedules row. */
function entryFromValues(values, classId) {
  return {
    class_id: classId,
    subject_id: Number(values.subject_id),
    teacher_id: Number(values.teacher_id),
    day_of_week: Number(values.day_of_week),
    start_time: values.start_time,
    end_time: values.end_time,
    room_id: num(values.room_id),
  };
}

/** Which days the school teaches on — drives the grid's columns. */
function openConfigureDaysModal() {
  const current = sched.resolveActiveDays(state.scheduleConfig);
  openModal({
    title: t("console.schedules.days.title"),
    fields: [
      {
        name: "active_days",
        label: t("console.schedules.days.configure"),
        type: "checkboxes",
        value: current.map(String),
        help: t("console.schedules.days.help"),
        options: sched.ALL_DAYS.map((d) => ({ value: d, label: dayLabel(d) })),
      },
    ],
    validate: (values) =>
      values.active_days?.length
        ? {}
        : { active_days: t("console.schedules.days.atLeastOne") },
    onSubmit: async (values) => {
      const active_days = values.active_days.map(Number).sort((a, b) => a - b);
      if (state.scheduleConfig?.id) {
        await data.updateScheduleConfig(state.scheduleConfig.id, {
          active_days,
        });
        state.scheduleConfig = { ...state.scheduleConfig, active_days };
      } else {
        state.scheduleConfig = await data.createScheduleConfig({
          school_year_id: state.activeYear.id,
          structure_type: "section",
          active_days,
        });
      }
      showToast(t("console.schedules.days.saved"));
      renderSchedulesTab();
    },
  });
}

/** Copy another section's week onto the one being edited. */
function openCopyScheduleModal() {
  const target = currentSchedSection();
  if (!target) {
    showToast(t("console.schedules.copy.needTarget"), "error");
    return;
  }
  const sources = state.sections.filter(
    (s) =>
      s.id !== target.id &&
      state.yearSchedules.some((e) => e.class_id === s.id),
  );
  if (!sources.length) {
    showToast(t("console.schedules.copy.noSource"), "error");
    return;
  }

  openModal({
    title: t("console.schedules.copy.title"),
    submitLabel: t("common.continue"),
    fields: [
      {
        name: "source_id",
        label: t("console.schedules.copy.source"),
        type: "select",
        required: true,
        help: t("console.schedules.copy.help"),
        options: optionsFrom(sources, sectionName),
      },
    ],
    onSubmit: async (values) => {
      const sourceId = Number(values.source_id);
      const plan = sched.copySchedulePlan(
        state.yearSchedules.filter((e) => e.class_id === sourceId),
        target.id,
        state.yearSchedules,
      );
      if (!plan.rows.length) {
        showToast(t("console.schedules.copy.nothing"), "error");
        return;
      }
      // Spell out what will and will not happen before writing anything.
      const lines = [
        t("console.schedules.copy.summary", {
          count: plan.rows.length,
          section: sectionName(target),
        }),
      ];
      if (plan.skipped.length) {
        lines.push(
          t("console.schedules.copy.skipped", {
            count: plan.skipped.length,
            section: sectionName(target),
          }),
        );
      }
      if (plan.conflicts.length) {
        lines.push(
          t("console.schedules.copy.warnings", {
            count: plan.conflicts.length,
          }),
        );
      }
      openConfirm(
        lines.join("\n"),
        async () => {
          await data.bulkInsert("schedules", plan.rows);
          showToast(
            t("console.schedules.copy.done", { count: plan.rows.length }),
          );
          await reloadYearSchedules();
        },
        {
          title: t("console.schedules.copy.title"),
          confirmLabel: t("common.confirm"),
          danger: false,
        },
      );
    },
  });
}

// ── Bell schedules (time-block templates) ──────────────────────
/** Load one template's blocks once, then serve them from state. */
async function ensureBellBlocks(bellId) {
  if (state.bellBlocks[bellId]) return state.bellBlocks[bellId];
  const blocks = await data.listBellBlocks(bellId);
  state.bellBlocks[bellId] = blocks;
  return blocks;
}

async function refreshBellBlocks(bellId) {
  state.bellBlocks[bellId] = await data.listBellBlocks(bellId);
  renderSchedulesTab();
}

function renderBellPanel(panel) {
  const wrap = document.createElement("div");
  wrap.className = "console-panel";
  wrap.innerHTML = `
    <div class="panel-head">
      <div>
        <h2>${escapeHtml(t("console.schedules.templates.title"))}</h2>
        <p class="panel-sub">${escapeHtml(t("console.schedules.templates.subtitle"))}</p>
      </div>
    </div>`;

  const actions = document.createElement("div");
  actions.className = "panel-actions";
  const add = document.createElement("button");
  add.className = "btn btn-primary btn-sm";
  add.type = "button";
  add.id = "btn-add-bell";
  add.innerHTML = `<span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-add"></use></svg></span><span>${escapeHtml(t("console.schedules.templates.add"))}</span>`;
  add.addEventListener("click", () => openBellForm());
  actions.appendChild(add);
  wrap.querySelector(".panel-head")?.appendChild(actions);

  const scroll = document.createElement("div");
  scroll.className = "table-scroll";
  const table = document.createElement("table");
  table.className = "data-table";
  table.innerHTML = `<thead><tr>
      <th>${escapeHtml(t("console.schedules.templates.name"))}</th>
      <th>${escapeHtml(t("console.schedules.templates.blocks"))}</th>
      <th class="actions-col"></th>
    </tr></thead>`;
  const tbody = document.createElement("tbody");
  tbody.id = "bell-body";

  if (!state.bellSchedules.length) {
    tbody.innerHTML = `<tr><td colspan="3" class="loading-cell">${escapeHtml(t("console.schedules.templates.empty"))}</td></tr>`;
  } else {
    state.bellSchedules.forEach((bell) => {
      const count = state.bellBlocks[bell.id]?.length;
      tbody.appendChild(
        tableRow(
          [
            escapeHtml(bell.name),
            count == null ? "—" : escapeHtml(String(count)),
          ],
          [
            iconBtn(
              "list_alt",
              t("console.schedules.templates.blocks"),
              async () => {
                state.schedBellId = bell.id;
                await ensureBellBlocks(bell.id);
                renderSchedulesTab();
              },
            ),
            iconBtn("edit", t("common.edit"), () => openBellForm(bell)),
            iconBtn(
              "delete",
              t("common.delete"),
              () =>
                openConfirm(
                  t("console.schedules.templates.confirmDelete"),
                  async () => {
                    await data.deleteBellSchedule(bell.id);
                    delete state.bellBlocks[bell.id];
                    if (state.schedBellId === bell.id) state.schedBellId = null;
                    if (state.schedTemplateId === bell.id)
                      state.schedTemplateId = null;
                    state.bellSchedules = await data.listBellSchedules();
                    showToast(t("common.deleted"));
                    renderSchedulesTab();
                  },
                ),
              true,
            ),
          ],
          bell.id,
        ),
      );
    });
  }
  table.appendChild(tbody);
  scroll.appendChild(table);
  wrap.appendChild(scroll);
  panel.appendChild(wrap);

  const selected = state.bellSchedules.find((b) => b.id === state.schedBellId);
  if (selected) panel.appendChild(buildBlocksPanel(selected));
}

function openBellForm(bell = null) {
  openModal({
    title: bell
      ? t("console.schedules.templates.editTitle")
      : t("console.schedules.templates.addTitle"),
    fields: [
      {
        name: "name",
        maxLength: 80,
        label: t("console.schedules.templates.name"),
        required: true,
        value: bell?.name ?? "",
        rules: [
          v.unique(
            state.bellSchedules.map((b) => b.name),
            { current: bell?.name },
          ),
        ],
      },
    ],
    onSubmit: async (values) => {
      if (bell) await data.updateBellSchedule(bell.id, { name: values.name });
      else {
        const created = await data.createBellSchedule({ name: values.name });
        state.schedBellId = created?.id ?? null;
        markSaved("bell-body", created?.id);
      }
      state.bellSchedules = await data.listBellSchedules();
      showToast(t("common.saved"));
      renderSchedulesTab();
    },
  });
}

/** The blocks of one bell schedule, in running order. */
function buildBlocksPanel(bell) {
  const blocks = state.bellBlocks[bell.id] ?? [];
  const panel = document.createElement("div");
  panel.className = "console-panel";
  panel.innerHTML = `
    <div class="panel-head">
      <div>
        <h2>${escapeHtml(bell.name)}</h2>
        <p class="panel-sub">${escapeHtml(t("console.schedules.templates.blocks"))}</p>
      </div>
    </div>`;
  const actions = document.createElement("div");
  actions.className = "panel-actions";
  const add = document.createElement("button");
  add.className = "btn btn-primary btn-sm";
  add.type = "button";
  add.id = "btn-add-block";
  add.innerHTML = `<span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-add"></use></svg></span><span>${escapeHtml(t("console.schedules.templates.addBlock"))}</span>`;
  add.addEventListener("click", () => openBlockForm(bell));
  actions.appendChild(add);
  panel.querySelector(".panel-head")?.appendChild(actions);

  const scroll = document.createElement("div");
  scroll.className = "table-scroll";
  const table = document.createElement("table");
  table.className = "data-table";
  table.innerHTML = `<thead><tr>
      <th>${escapeHtml(t("console.schedules.templates.order"))}</th>
      <th>${escapeHtml(t("console.schedules.templates.label"))}</th>
      <th>${escapeHtml(t("console.schedules.templates.kind"))}</th>
      <th>${escapeHtml(t("console.schedules.time"))}</th>
      <th class="actions-col"></th>
    </tr></thead>`;
  const tbody = document.createElement("tbody");
  tbody.id = "bell-blocks-body";
  if (!blocks.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="loading-cell">${escapeHtml(t("console.schedules.templates.blocksEmpty"))}</td></tr>`;
  } else {
    blocks.forEach((block) => {
      tbody.appendChild(
        tableRow(
          [
            escapeHtml(String(block.block_order)),
            escapeHtml(block.label),
            escapeHtml(
              t(
                block.kind === "break"
                  ? "console.schedules.templates.kindBreak"
                  : "console.schedules.templates.kindClass",
              ),
            ),
            escapeHtml(slotLabel(block.start_time, block.end_time)),
          ],
          [
            iconBtn("edit", t("common.edit"), () => openBlockForm(bell, block)),
            iconBtn(
              "delete",
              t("common.delete"),
              () =>
                openConfirm(
                  t("console.schedules.templates.confirmDeleteBlock"),
                  async () => {
                    await data.deleteBellBlock(block.id);
                    showToast(t("common.deleted"));
                    await refreshBellBlocks(bell.id);
                  },
                ),
              true,
            ),
          ],
          block.id,
        ),
      );
    });
  }
  table.appendChild(tbody);
  scroll.appendChild(table);
  panel.appendChild(scroll);
  return panel;
}

function openBlockForm(bell, block = null) {
  const blocks = state.bellBlocks[bell.id] ?? [];
  const nextOrder = blocks.length
    ? Math.max(...blocks.map((b) => Number(b.block_order) || 0)) + 1
    : 1;

  openModal({
    title: block
      ? t("console.schedules.templates.editBlockTitle")
      : t("console.schedules.templates.addBlockTitle"),
    fields: [
      {
        name: "label",
        label: t("console.schedules.templates.label"),
        required: true,
        value: block?.label ?? "",
      },
      {
        name: "kind",
        label: t("console.schedules.templates.kind"),
        type: "select",
        required: true,
        value: block?.kind ?? "class",
        options: [
          { value: "class", label: t("console.schedules.templates.kindClass") },
          { value: "break", label: t("console.schedules.templates.kindBreak") },
        ],
      },
      {
        name: "block_order",
        label: t("console.schedules.templates.order"),
        type: "number",
        required: true,
        min: 1,
        value: block?.block_order ?? nextOrder,
        rules: [v.integer(), v.min(1)],
      },
      {
        name: "start_time",
        label: t("console.schedules.start"),
        type: "time",
        required: true,
        value: sched.normalizeTime(block?.start_time),
      },
      {
        name: "end_time",
        label: t("console.schedules.end"),
        type: "time",
        required: true,
        value: sched.normalizeTime(block?.end_time),
        rules: [v.endAfterStart("start_time")],
      },
    ],
    // Validate the block against the template it is joining, so an overlap
    // or a repeated order is caught before the unique constraint fires.
    validate: (values) => {
      const others = blocks.filter((b) => b.id !== block?.id);
      const errors = sched.validateBlocks([...others, values]);
      const problem = errors[others.length];
      if (problem === "overlap")
        return { start_time: t("console.schedules.templates.overlap") };
      if (problem === "duplicateOrder")
        return { block_order: t("console.schedules.templates.duplicateOrder") };
      return {};
    },
    onSubmit: async (values) => {
      const row = {
        bell_schedule_id: bell.id,
        label: values.label,
        kind: values.kind,
        block_order: Number(values.block_order),
        start_time: values.start_time,
        end_time: values.end_time,
      };
      if (block) await data.updateBellBlock(block.id, row);
      else markSaved("bell-blocks-body", (await data.createBellBlock(row))?.id);
      showToast(t("common.saved"));
      await refreshBellBlocks(bell.id);
    },
  });
}

// ───────────────────────────────────────────────────────────────
//  5g. STUDENTS & ENROLLMENT (+ CSV roster import)
// ───────────────────────────────────────────────────────────────
const STUDENT_STATUSES = [
  "active",
  "inactive",
  "graduated",
  "transferred",
  "withdrawn",
];

function genderLabel(g) {
  return g ? t(`enums.gender.${g}`) : "—";
}
function coerceGender(raw) {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (["m", "male", "masculino", "hombre", "h"].includes(s)) return "M";
  if (["f", "female", "femenino", "mujer"].includes(s)) return "F";
  if (s === "o" || s === "other" || s === "otro") return "O";
  return null;
}
/** Normalize a birthdate to ISO yyyy-mm-dd; null if unparseable. */
function coerceDate(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/); // dd/mm/yyyy
  if (m) {
    const [, d, mo, y] = m;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return null;
}

async function loadStudents() {
  renderMessageRow("students-body", 7, t("common.loading"));
  try {
    if (!state.activeYear) {
      const years = await data.listSchoolYears();
      state.activeYear = years.find((y) => y.is_active) ?? null;
    }
    const [students, sectionsList] = await Promise.all([
      data.listStudents(),
      state.activeYear
        ? data.listSections(state.activeYear.id)
        : Promise.resolve([]),
    ]);
    state.students = students;
    state.sections = sectionsList;
    if (!state.gradeLevels.length)
      state.gradeLevels = await data.listGradeLevels();
    renderStudentFilter();
    renderStudents();
  } catch (err) {
    console.error("loadStudents:", err);
    renderErrorRow("students-body", 7, loadStudents);
  }
}

/**
 * Students filter. "All students" and "No section assigned" are enrollment
 * states, not places — grouping the real sections under their own heading
 * stops "unassigned" from reading like a section the school actually has.
 */
function renderStudentFilter() {
  const sel = document.getElementById("students-filter");
  const prev = String(state.studentFilter);
  sel.innerHTML = "";

  const addOption = (parent, value, label) => {
    const el = document.createElement("option");
    el.value = value;
    el.textContent = label;
    if (value === prev) el.selected = true;
    parent.appendChild(el);
  };

  addOption(sel, "all", t("console.students.allStudents"));
  addOption(sel, "unassigned", t("console.students.unassigned"));

  if (state.sections.length) {
    const group = document.createElement("optgroup");
    group.label = t("console.students.sectionsGroup");
    state.sections.forEach((s) =>
      addOption(group, String(s.id), sectionName(s)),
    );
    sel.appendChild(group);
  }
}

function filteredStudents() {
  if (state.studentFilter === "all") return state.students;
  if (state.studentFilter === "unassigned")
    return state.students.filter((s) => !s.class_id);
  return state.students.filter(
    (s) => String(s.class_id) === String(state.studentFilter),
  );
}

function renderStudents() {
  const list = filteredStudents();
  const countEl = document.getElementById("students-count");
  countEl.textContent = tn("console.students.count", list.length, {
    count: list.length,
  });
  const tbody = document.getElementById("students-body");
  tbody.innerHTML = "";
  if (!list.length) {
    renderEmptyRow("students-body", 7, t("console.students.empty"));
    return;
  }
  list.forEach((s) => {
    const active = s.status === "active";
    const statusBadge = `<span class="badge ${active ? "badge-success" : "badge-neutral"}">${escapeHtml(t(`enums.studentStatus.${s.status ?? "active"}`))}</span>`;
    const secName = s.class_id
      ? (state.sections.find((x) => x.id === s.class_id) &&
          sectionName(state.sections.find((x) => x.id === s.class_id))) ||
        "—"
      : "—";
    tbody.appendChild(
      tableRow(
        [
          escapeHtml(`${s.first_name} ${s.last_name}`),
          escapeHtml(s.enrollment_number ?? "—"),
          escapeHtml(s.national_id ?? "—"),
          escapeHtml(genderLabel(s.gender)),
          escapeHtml(secName),
          statusBadge,
        ],
        [
          accountBtn(s, "student", loadStudents),
          iconBtn("edit", t("common.edit"), () => openStudentForm(s)),
          iconBtn(
            active ? "block" : "check_circle",
            active
              ? t("console.students.deactivate")
              : t("console.students.reactivate"),
            async () => {
              await data.updateStudent(s.id, {
                status: active ? "inactive" : "active",
              });
              showToast(t("common.saved"));
              loadStudents();
            },
          ),
          iconBtn(
            "delete",
            t("common.delete"),
            () =>
              openConfirm(
                t("console.students.confirmDelete", {
                  name: `${s.first_name} ${s.last_name}`,
                }),
                async () => {
                  await data.deleteStudent(s.id);
                  showToast(t("common.deleted"));
                  loadStudents();
                },
              ),
            true,
          ),
        ],
        s.id,
      ),
    );
  });
  applySavedFlash("students-body");
}

function sectionOptions() {
  return state.sections.map((s) => ({ value: s.id, label: sectionName(s) }));
}

function openStudentForm(student = null) {
  openModal({
    title: student
      ? t("console.students.editTitle")
      : t("console.students.addTitle"),
    fields: [
      {
        name: "first_name",
        maxLength: 100,
        label: t("console.students.firstName"),
        value: student?.first_name,
        required: true,
      },
      {
        name: "last_name",
        maxLength: 100,
        label: t("console.students.lastName"),
        value: student?.last_name,
        required: true,
      },
      {
        name: "enrollment_number",
        maxLength: 20,
        label: t("console.students.enrollmentNumber"),
        value: student?.enrollment_number,
        help: t("console.students.enrollmentHelp"),
        rules: [
          v.unique(
            state.students.map((s) => s.enrollment_number),
            {
              current: student?.enrollment_number,
              messageKey: "validation.enrollmentTaken",
            },
          ),
        ],
      },
      {
        // Optional, with a per-school label — same treatment as teachers.
        name: "national_id",
        maxLength: 20,
        label: idLabel("students"),
        value: student?.national_id,
        rules: [
          v.unique(
            state.students.map((s) => s.national_id),
            { current: student?.national_id },
          ),
        ],
      },
      {
        name: "date_of_birth",
        label: t("console.students.dateOfBirth"),
        type: "date",
        value: student?.date_of_birth,
        max: todayIso(),
        rules: [v.notFuture()],
      },
      {
        name: "gender",
        label: t("console.students.gender"),
        type: "select",
        value: student?.gender,
        options: ["M", "F", "O"].map((v) => ({
          value: v,
          label: t(`enums.gender.${v}`),
        })),
      },
      {
        name: "email",
        maxLength: 150,
        label: t("console.students.email"),
        type: "email",
        value: student?.email,
        rules: [v.email()],
      },
      {
        name: "phone",
        maxLength: 20,
        label: t("console.students.phone"),
        value: student?.phone,
        rules: [v.phone()],
      },
      {
        name: "class_id",
        label: t("console.students.section"),
        type: "select",
        value: student?.class_id,
        options: sectionOptions(),
      },
      {
        name: "status",
        label: t("console.students.status"),
        type: "select",
        value: student?.status ?? "active",
        required: true,
        options: STUDENT_STATUSES.map((v) => ({
          value: v,
          label: t(`enums.studentStatus.${v}`),
        })),
      },
    ],
    onSubmit: async (v) => {
      const enrollment =
        nullable(v.enrollment_number) ?? generateEnrollment(student);
      const payload = {
        first_name: v.first_name.trim(),
        last_name: v.last_name.trim(),
        enrollment_number: enrollment,
        national_id: nullable(v.national_id),
        date_of_birth: nullable(v.date_of_birth),
        gender: nullable(v.gender),
        email: nullable(v.email),
        phone: nullable(v.phone),
        class_id: num(v.class_id),
        status: v.status,
      };
      const saved = student
        ? await data.updateStudent(student.id, payload).then(() => student)
        : await data.createStudent(payload);
      markSaved("students-body", saved?.id ?? student?.id);
      showToast(t("common.saved"));
      loadStudents();
    },
  });
}

// Unique-enough enrollment number when the admin leaves it blank. Existing
// students keep theirs (edit passes the current value through).
function generateEnrollment(student) {
  if (student?.enrollment_number) return student.enrollment_number;
  const existing = new Set(
    state.students.map((s) => s.enrollment_number).filter(Boolean),
  );
  let candidate;
  do {
    candidate = `S-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4)}`;
  } while (existing.has(candidate));
  return candidate;
}

document
  .getElementById("btn-add-student")
  .addEventListener("click", () => openStudentForm());
document.getElementById("students-filter").addEventListener("change", (e) => {
  state.studentFilter = e.target.value;
  renderStudents();
});

// ── CSV import (generic, descriptor-driven) ────────────────────
// One import wizard drives every structure table. Each entity is a
// descriptor: which fields to map (+ header aliases), how to turn a mapped
// row into a DB payload (resolving foreign keys by name), which fields must
// be unique, and how to preview + reload. Students keep an optional
// "enroll into section" target; sections/periods bind to the active year.
const importOverlay = document.getElementById("import-overlay");
const importBody = document.getElementById("import-body");
const importFooter = document.getElementById("import-footer");

// ── value coercion + name→id resolvers ─────────────────────────
function coerceInt(v) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = parseInt(s, 10);
  return Number.isNaN(n) ? null : n;
}
function coerceNum(v) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isNaN(n) ? null : n;
}
function coerceEnum(v, allowed, dflt) {
  const s = String(v ?? "")
    .trim()
    .toLowerCase();
  return allowed.find((a) => a.toLowerCase() === s) ?? dflt;
}
function resolveGradeLevel(raw) {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase();
  const n = Number(raw);
  return (
    state.gradeLevels.find(
      (g) =>
        (!Number.isNaN(n) && s !== "" && g.numeric_level === n) ||
        g.name.toLowerCase() === s,
    ) ?? null
  );
}
function resolveTeacherId(raw) {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (!s) return null;
  const tch = state.teachers.find(
    (x) =>
      (x.email && x.email.toLowerCase() === s) ||
      `${x.first_name} ${x.last_name}`.toLowerCase() === s,
  );
  return tch ? tch.id : null;
}
function resolveRoomId(raw) {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (!s) return null;
  const r = state.rooms.find((x) => x.name.toLowerCase() === s);
  return r ? r.id : null;
}

// ── reference-list loaders used by descriptor prepare() ────────
async function ensureSchoolYears() {
  state.schoolYears = await data.listSchoolYears();
  state.activeYear = state.schoolYears.find((y) => y.is_active) ?? null;
}
async function ensureActiveYear() {
  if (!state.activeYear) await ensureSchoolYears();
}
async function ensureGradeLevels() {
  if (!state.gradeLevels.length)
    state.gradeLevels = await data.listGradeLevels();
}
async function ensureRooms() {
  if (!state.rooms.length) state.rooms = await data.listRooms();
}
async function ensureTeachers() {
  if (!state.teachers.length) state.teachers = await data.listTeachers();
}

const REQ = (key) => t("console.import.errRequired", { field: t(key) });

// ── Entity descriptors ─────────────────────────────────────────
const IMPORT_DESCRIPTORS = {
  students: {
    table: "students",
    titleKey: "console.import.entity.students",
    reload: () => loadStudents(),
    targetSection: true,
    uniqueFields: ["enrollment_number"],
    autogen: {
      field: "enrollment_number",
      make: (i) =>
        `S-${Date.now().toString(36)}-${i}-${Math.floor(Math.random() * 1e4)}`,
    },
    existing: () => state.students,
    fields: [
      {
        key: "first_name",
        labelKey: "console.students.firstName",
        required: true,
        aliases: ["first name", "firstname", "nombre", "nombres", "given name"],
      },
      {
        key: "last_name",
        labelKey: "console.students.lastName",
        required: true,
        aliases: ["last name", "lastname", "apellido", "apellidos", "surname"],
      },
      {
        key: "enrollment_number",
        labelKey: "console.students.enrollmentNumber",
        aliases: [
          "enrollment number",
          "enrollment",
          "matricula",
          "matrícula",
          "student id",
          "studentid",
          "carnet",
          "id",
        ],
      },
      {
        key: "national_id",
        labelKey: "console.students.nationalId",
        aliases: ["national id", "nationalid", "cedula", "cédula", "dni"],
      },
      {
        key: "gender",
        labelKey: "console.students.gender",
        aliases: ["gender", "sex", "genero", "género", "sexo"],
      },
      {
        key: "date_of_birth",
        labelKey: "console.students.dateOfBirth",
        aliases: [
          "date of birth",
          "dob",
          "birthdate",
          "fecha de nacimiento",
          "nacimiento",
        ],
      },
      {
        key: "email",
        labelKey: "console.students.email",
        aliases: ["email", "correo", "e-mail", "mail"],
      },
      {
        key: "phone",
        labelKey: "console.students.phone",
        aliases: ["phone", "telefono", "teléfono", "celular", "mobile", "tel"],
      },
    ],
    async prepare() {
      if (!state.students.length) state.students = await data.listStudents();
      await ensureActiveYear();
      if (state.activeYear)
        state.sections = await data.listSections(state.activeYear.id);
      if (!state.gradeLevels.length)
        state.gradeLevels = await data.listGradeLevels();
      return { ok: true, ctx: {} };
    },
    resolve(get, ctx) {
      const first = get("first_name");
      const last = get("last_name");
      if (!first || !last) return { error: t("console.import.errMissingName") };
      return {
        payload: {
          first_name: first,
          last_name: last,
          enrollment_number: get("enrollment_number") || null,
          national_id: get("national_id") || null,
          gender: coerceGender(get("gender")),
          date_of_birth: coerceDate(get("date_of_birth")),
          email: get("email") || null,
          phone: get("phone") || null,
          class_id: ctx.targetSection ?? null,
          status: "active",
        },
      };
    },
    previewCols: [
      {
        labelKey: "console.students.name",
        get: (p) => `${p.first_name} ${p.last_name}`,
      },
      {
        labelKey: "console.students.enrollmentNumber",
        get: (p) => p.enrollment_number,
      },
      {
        labelKey: "console.students.gender",
        get: (p) => genderLabel(p.gender),
      },
    ],
  },

  teachers: {
    table: "teachers",
    titleKey: "console.import.entity.teachers",
    reload: () => loadTeachers(),
    uniqueFields: ["national_id", "email"],
    existing: () => state.teachers,
    fields: [
      {
        key: "first_name",
        labelKey: "console.teachers.firstName",
        required: true,
        aliases: ["first name", "firstname", "nombre", "nombres"],
      },
      {
        key: "last_name",
        labelKey: "console.teachers.lastName",
        required: true,
        aliases: ["last name", "lastname", "apellido", "apellidos"],
      },
      {
        key: "national_id",
        labelKey: "console.teachers.nationalId",
        aliases: ["national id", "cedula", "cédula", "dni", "id"],
      },
      {
        key: "email",
        labelKey: "console.teachers.email",
        aliases: ["email", "correo", "e-mail", "mail"],
      },
      {
        key: "phone",
        labelKey: "console.teachers.phone",
        aliases: ["phone", "telefono", "teléfono", "celular"],
      },
      {
        key: "specialization",
        labelKey: "console.teachers.specialization",
        aliases: [
          "specialization",
          "especializacion",
          "especialización",
          "subject",
          "area",
        ],
      },
      {
        key: "status",
        labelKey: "console.teachers.status",
        aliases: ["status", "estado"],
      },
    ],
    async prepare() {
      await ensureTeachers();
      return { ok: true, ctx: {} };
    },
    resolve(get) {
      const first = get("first_name");
      const last = get("last_name");
      if (!first || !last) return { error: t("console.import.errMissingName") };
      return {
        payload: {
          first_name: first,
          last_name: last,
          national_id: get("national_id") || null,
          email: get("email") || null,
          phone: get("phone") || null,
          specialization: get("specialization") || null,
          status: coerceEnum(get("status"), TEACHER_STATUSES, "active"),
        },
      };
    },
    previewCols: [
      {
        labelKey: "console.teachers.name",
        get: (p) => `${p.first_name} ${p.last_name}`,
      },
      { labelKey: "console.teachers.email", get: (p) => p.email ?? "—" },
      {
        labelKey: "console.teachers.specialization",
        get: (p) => p.specialization ?? "—",
      },
    ],
  },

  subjects: {
    table: "subjects",
    titleKey: "console.import.entity.subjects",
    reload: () => loadSubjects(),
    uniqueFields: ["name", "code"],
    existing: () => state.subjects,
    fields: [
      {
        key: "name",
        labelKey: "console.subjects.name",
        required: true,
        aliases: ["name", "nombre", "subject", "materia"],
      },
      {
        key: "code",
        labelKey: "console.subjects.code",
        aliases: ["code", "codigo", "código", "abbr"],
      },
      {
        key: "color",
        labelKey: "console.subjects.color",
        aliases: ["color", "colour"],
      },
      {
        key: "description",
        labelKey: "console.subjects.description",
        aliases: ["description", "descripcion", "descripción"],
      },
    ],
    async prepare() {
      if (!state.subjects.length) state.subjects = await data.listSubjects();
      return { ok: true, ctx: {} };
    },
    resolve(get) {
      const name = get("name");
      if (!name) return { error: REQ("console.subjects.name") };
      const color = get("color");
      return {
        payload: {
          name,
          code: get("code") || null,
          color: /^#?[0-9a-fA-F]{6}$/.test(color)
            ? color.startsWith("#")
              ? color
              : `#${color}`
            : null,
          description: get("description") || null,
        },
      };
    },
    previewCols: [
      { labelKey: "console.subjects.name", get: (p) => p.name },
      { labelKey: "console.subjects.code", get: (p) => p.code ?? "—" },
    ],
  },

  gradeLevels: {
    table: "grade_levels",
    titleKey: "console.import.entity.gradeLevels",
    reload: () => loadGradeLevels(),
    uniqueFields: ["name", "numeric_level"],
    existing: () => state.gradeLevels,
    fields: [
      {
        key: "numeric_level",
        labelKey: "console.grades.level",
        required: true,
        aliases: ["level", "numeric level", "nivel", "grade", "grado"],
      },
      {
        key: "name",
        labelKey: "console.grades.name",
        required: true,
        aliases: ["name", "nombre", "grade name", "grado"],
      },
    ],
    async prepare() {
      await ensureGradeLevels();
      return { ok: true, ctx: {} };
    },
    resolve(get) {
      const name = get("name");
      const level = coerceInt(get("numeric_level"));
      if (!name) return { error: REQ("console.grades.name") };
      if (level == null) return { error: REQ("console.grades.level") };
      return { payload: { name, numeric_level: level } };
    },
    previewCols: [
      { labelKey: "console.grades.level", get: (p) => p.numeric_level },
      { labelKey: "console.grades.name", get: (p) => p.name },
    ],
  },

  rooms: {
    table: "rooms",
    titleKey: "console.import.entity.rooms",
    reload: () => loadRooms(),
    uniqueFields: ["name"],
    existing: () => state.rooms,
    fields: [
      {
        key: "name",
        labelKey: "console.rooms.name",
        required: true,
        aliases: ["name", "nombre", "room", "aula"],
      },
      {
        key: "capacity",
        labelKey: "console.rooms.capacity",
        aliases: ["capacity", "capacidad", "seats"],
      },
      {
        key: "type",
        labelKey: "console.rooms.type",
        aliases: ["type", "tipo", "kind"],
      },
    ],
    async prepare() {
      await ensureRooms();
      return { ok: true, ctx: {} };
    },
    resolve(get) {
      const name = get("name");
      if (!name) return { error: REQ("console.rooms.name") };
      return {
        payload: {
          name,
          capacity: coerceInt(get("capacity")),
          type: coerceEnum(get("type"), ROOM_TYPES, "classroom"),
        },
      };
    },
    previewCols: [
      { labelKey: "console.rooms.name", get: (p) => p.name },
      { labelKey: "console.rooms.capacity", get: (p) => p.capacity ?? "—" },
      {
        labelKey: "console.rooms.type",
        get: (p) => t(`console.rooms.types.${p.type}`),
      },
    ],
  },

  schoolYears: {
    table: "school_years",
    titleKey: "console.import.entity.schoolYears",
    reload: () => loadYearPeriods(),
    uniqueFields: ["name"],
    existing: () => state.schoolYears,
    fields: [
      {
        key: "name",
        labelKey: "console.years.name",
        required: true,
        aliases: ["name", "nombre", "year", "año", "ciclo"],
      },
      {
        key: "start_date",
        labelKey: "console.years.start",
        required: true,
        aliases: ["start", "start date", "inicio", "fecha inicio"],
      },
      {
        key: "end_date",
        labelKey: "console.years.end",
        required: true,
        aliases: ["end", "end date", "fin", "fecha fin"],
      },
    ],
    async prepare() {
      await ensureSchoolYears();
      return { ok: true, ctx: {} };
    },
    resolve(get) {
      const name = get("name");
      if (!name) return { error: REQ("console.years.name") };
      const start = coerceDate(get("start_date"));
      const end = coerceDate(get("end_date"));
      if (!start || !end) return { error: t("console.import.errDates") };
      // Never activate on import — the admin sets the active year in the UI.
      return {
        payload: { name, start_date: start, end_date: end, is_active: false },
      };
    },
    previewCols: [
      { labelKey: "console.years.name", get: (p) => p.name },
      { labelKey: "console.years.start", get: (p) => fmtDate(p.start_date) },
      { labelKey: "console.years.end", get: (p) => fmtDate(p.end_date) },
    ],
  },

  gradingPeriods: {
    table: "grading_periods",
    titleKey: "console.import.entity.gradingPeriods",
    reload: () => loadYearPeriods(),
    uniqueFields: ["period_order"],
    existing: () => state._importPeriods ?? [],
    fields: [
      {
        key: "period_order",
        labelKey: "console.periods.order",
        required: true,
        aliases: ["order", "period", "número", "numero", "orden", "#"],
      },
      {
        key: "name",
        labelKey: "console.periods.name",
        required: true,
        aliases: ["name", "nombre", "period name"],
      },
      {
        key: "start_date",
        labelKey: "console.periods.start",
        required: true,
        aliases: ["start", "start date", "inicio"],
      },
      {
        key: "end_date",
        labelKey: "console.periods.end",
        required: true,
        aliases: ["end", "end date", "fin"],
      },
      {
        key: "weight",
        labelKey: "console.periods.weight",
        aliases: ["weight", "peso", "percent", "porcentaje"],
      },
    ],
    async prepare() {
      await ensureActiveYear();
      if (!state.activeYear)
        return { ok: false, error: t("console.periods.noYear") };
      state._importPeriods = await data.listPeriods(state.activeYear.id);
      return { ok: true, ctx: { activeYear: state.activeYear } };
    },
    resolve(get, ctx) {
      const name = get("name");
      const order = coerceInt(get("period_order"));
      if (order == null) return { error: REQ("console.periods.order") };
      if (!name) return { error: REQ("console.periods.name") };
      const start = coerceDate(get("start_date"));
      const end = coerceDate(get("end_date"));
      if (!start || !end) return { error: t("console.import.errDates") };
      return {
        payload: {
          name,
          period_order: order,
          start_date: start,
          end_date: end,
          weight: coerceNum(get("weight")) ?? 50,
          school_year_id: ctx.activeYear.id,
        },
      };
    },
    previewCols: [
      { labelKey: "console.periods.order", get: (p) => p.period_order },
      { labelKey: "console.periods.name", get: (p) => p.name },
    ],
  },

  sections: {
    table: "classes",
    titleKey: "console.import.entity.sections",
    reload: () => loadSections(),
    // Composite unique (grade + section within the active year).
    dedupKey: (p) => `${p.grade_level_id}|${p.section.toLowerCase()}`,
    existingKeys: () =>
      new Set(
        state.sections.map(
          (s) => `${s.grade_level_id}|${String(s.section).toLowerCase()}`,
        ),
      ),
    dupErrorKey: "console.import.errDupSection",
    fields: [
      {
        key: "grade",
        labelKey: "console.sections.grade",
        required: true,
        aliases: ["grade", "grade level", "grado", "nivel", "level"],
      },
      {
        key: "section",
        labelKey: "console.sections.section",
        required: true,
        aliases: ["section", "seccion", "sección", "group", "grupo"],
      },
      {
        key: "homeroom",
        labelKey: "console.sections.homeroom",
        aliases: [
          "homeroom",
          "homeroom teacher",
          "guia",
          "guía",
          "teacher",
          "docente",
        ],
      },
      {
        key: "room",
        labelKey: "console.sections.room",
        aliases: ["room", "aula", "classroom"],
      },
      {
        key: "max_capacity",
        labelKey: "console.sections.capacity",
        aliases: ["capacity", "max capacity", "capacidad", "cupo"],
      },
    ],
    async prepare() {
      await ensureActiveYear();
      if (!state.activeYear)
        return { ok: false, error: t("console.sections.noYear") };
      await ensureGradeLevels();
      if (!state.gradeLevels.length)
        return { ok: false, error: t("console.sections.needGrade") };
      await ensureTeachers();
      await ensureRooms();
      state.sections = await data.listSections(state.activeYear.id);
      return { ok: true, ctx: { activeYear: state.activeYear } };
    },
    resolve(get, ctx) {
      const sectionCode = get("section");
      const gradeRaw = get("grade");
      if (!sectionCode) return { error: REQ("console.sections.section") };
      if (!gradeRaw) return { error: REQ("console.sections.grade") };
      const gl = resolveGradeLevel(gradeRaw);
      if (!gl)
        return {
          error: t("console.import.errUnknownGrade", { value: gradeRaw }),
        };
      return {
        payload: {
          grade_level_id: gl.id,
          section: sectionCode,
          display_name: `${gl.numeric_level}${sectionCode}`,
          homeroom_teacher_id: resolveTeacherId(get("homeroom")),
          room_id: resolveRoomId(get("room")),
          max_capacity: coerceInt(get("max_capacity")) ?? 30,
          school_year_id: ctx.activeYear.id,
        },
      };
    },
    previewCols: [
      {
        labelKey: "console.sections.grade",
        get: (p) => gradeName(p.grade_level_id),
      },
      { labelKey: "console.sections.section", get: (p) => p.section },
      {
        labelKey: "console.sections.homeroom",
        get: (p) =>
          p.homeroom_teacher_id ? teacherName(p.homeroom_teacher_id) : "—",
      },
    ],
  },
};

let importCtx = null;

async function openImportModal(key) {
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

function closeImportModal() {
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
      onClick: () => {
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
      },
    },
  ]);
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

// Build normalized payloads + validation report from the current mapping.
function buildImportRows() {
  const d = importCtx.descriptor;
  const { rows } = importCtx.parsed;
  const map = importCtx.mapping;
  const rowGet = (row) => (key) =>
    map[key] ? (row[map[key]] ?? "").trim() : "";
  const ctx = { ...importCtx.ctx };
  if (d.targetSection)
    ctx.targetSection = importCtx.targetSection
      ? Number(importCtx.targetSection)
      : null;

  const uniqueFields = d.uniqueFields ?? [];
  const existingSets = {};
  const seen = {};
  uniqueFields.forEach((uf) => {
    existingSets[uf] = new Set(
      (d.existing?.() ?? [])
        .map((r) => r[uf])
        .filter((v) => v != null && v !== "")
        .map(String),
    );
    seen[uf] = new Set();
  });
  const existingKeys = d.existingKeys ? d.existingKeys() : null;
  const seenKeys = new Set();

  const valid = [];
  const errors = [];

  rows.forEach((row, i) => {
    const line = i + 2; // 1-based + header row
    const res = d.resolve(rowGet(row), ctx);
    if (res.error) {
      errors.push({ line, reason: res.error });
      return;
    }
    const p = res.payload;

    // Auto-generate a value where the source left a unique field blank.
    if (d.autogen) {
      const f = d.autogen.field;
      if (p[f] == null || p[f] === "") {
        let v;
        do {
          v = d.autogen.make(valid.length);
        } while (existingSets[f]?.has(String(v)) || seen[f]?.has(String(v)));
        p[f] = v;
      }
    }

    // Per-field uniqueness.
    let dup = false;
    for (const uf of uniqueFields) {
      const v = p[uf];
      if (v == null || v === "") continue;
      if (existingSets[uf].has(String(v)) || seen[uf].has(String(v))) {
        const label = d.fields.find((f) => f.key === uf)?.labelKey;
        errors.push({
          line,
          reason: t("console.import.errDuplicate", {
            field: label ? t(label) : uf,
            value: v,
          }),
        });
        dup = true;
        break;
      }
    }
    if (dup) return;

    // Composite uniqueness (e.g., grade+section).
    if (existingKeys) {
      const k = d.dedupKey(p);
      if (existingKeys.has(k) || seenKeys.has(k)) {
        errors.push({ line, reason: t(d.dupErrorKey) });
        return;
      }
      seenKeys.add(k);
    }

    uniqueFields.forEach((uf) => {
      if (p[uf] != null && p[uf] !== "") seen[uf].add(String(p[uf]));
    });
    valid.push(p);
  });
  return { valid, errors };
}

// Step 3 — preview valid rows + validation summary, then import.
function renderImportPreview() {
  const d = importCtx.descriptor;
  const { valid, errors } = buildImportRows();
  const preview = valid.slice(0, 8);
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
    .slice(0, 8)
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
    ${errors.length ? `<div class="import-errors"><h3>${escapeHtml(t("console.import.skippedRows"))}</h3><ul>${errorList}</ul>${errors.length > 8 ? `<p class="import-help">${escapeHtml(t("console.import.andMore", { count: errors.length - 8 }))}</p>` : ""}</div>` : ""}`;

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
      onClick: async () => {
        try {
          await data.bulkInsert(d.table, valid);
          showToast(t("console.import.done", { count: valid.length }));
          closeImportModal();
          d.reload();
        } catch (err) {
          showToast(errorText(err), "error");
        }
      },
    },
  ]);
}

// Wire every section's "Import CSV" button to its descriptor.
const IMPORT_BUTTONS = {
  "btn-import-csv": "students",
  "btn-import-teachers": "teachers",
  "btn-import-subjects": "subjects",
  "btn-import-grades": "gradeLevels",
  "btn-import-rooms": "rooms",
  "btn-import-sections": "sections",
  "btn-import-years": "schoolYears",
  "btn-import-periods": "gradingPeriods",
};
Object.entries(IMPORT_BUTTONS).forEach(([id, key]) => {
  document
    .getElementById(id)
    ?.addEventListener("click", () => openImportModal(key));
});
// Backdrop clicks are ignored here too — a pasted roster and its column
// mapping are exactly the kind of work a stray click used to destroy.
document
  .getElementById("import-close")
  .addEventListener("click", closeImportModal);

// ── Dialog keyboard contract ───────────────────────────────────
// Focus trap, Escape, focus-in on open and focus-back-to-trigger on close,
// for all three console dialogs. Escape is routed through each dialog's own
// closer, so the form's unsaved-changes warning still stands in its way.
registerDialog(modalOverlay, { close: requestCloseModal });
registerDialog(confirmOverlay, { close: closeConfirm });
registerDialog(importOverlay, { close: closeImportModal });

// ───────────────────────────────────────────────────────────────
//  5h. SETTINGS (read-only)
// ───────────────────────────────────────────────────────────────
/**
 * School profile card: the school's name and what it calls the national-ID
 * field. Rendered here rather than in settings.js because that renderer is
 * shared with the student/teacher portals and is documented as read-only.
 */
async function renderSchoolProfile() {
  const root = document.getElementById("school-profile-root");
  if (!root) return;
  await loadSchoolSettings();

  const unavailable = state.school === null;
  root.innerHTML = `
    <div class="console-panel">
      <div class="panel-head">
        <div>
          <h2>${escapeHtml(t("console.school.title"))}</h2>
          <p class="panel-sub">${escapeHtml(t("console.school.subtitle"))}</p>
        </div>
      </div>
      <div class="modal-body school-profile-form">
        <div class="field-group">
          <label for="school-name">${escapeHtml(t("console.school.name"))}</label>
          <input id="school-name" type="text"
            value="${escapeHtml(state.school?.name ?? "")}"
            placeholder="${escapeHtml(t("console.school.namePlaceholder"))}" />
        </div>
        <div class="field-group">
          <label for="school-id-label">${escapeHtml(t("console.school.idLabel"))}</label>
          <input id="school-id-label" type="text"
            value="${escapeHtml(state.school?.id_label ?? "")}"
            placeholder="${escapeHtml(t("console.teachers.nationalId"))}" />
          <small class="field-help">${escapeHtml(t("console.school.idLabelHelp"))}</small>
        </div>
        ${unavailable ? `<p class="field-help">${escapeHtml(t("console.school.unavailable"))}</p>` : ""}
        <div>
          <button type="button" class="btn btn-primary btn-sm" id="btn-save-school"
            ${unavailable ? "disabled" : ""}>
            ${escapeHtml(t("common.save"))}
          </button>
        </div>
      </div>
    </div>`;

  document
    .getElementById("btn-save-school")
    ?.addEventListener("click", async () => {
      const patch = {
        name: nullable(
          /** @type {HTMLInputElement} */ (
            document.getElementById("school-name")
          ).value,
        ),
        id_label: nullable(
          /** @type {HTMLInputElement} */ (
            document.getElementById("school-id-label")
          ).value,
        ),
      };
      try {
        if (state.school?.id != null) {
          await data.updateSchoolSettings(state.school.id, patch);
          state.school = { ...state.school, ...patch };
        } else {
          state.school = await data.createSchoolSettings({ id: 1, ...patch });
        }
        showToast(t("console.school.saved"));
        // The ID label feeds table headers and both create forms.
        applyIdLabels();
      } catch (err) {
        showToast(errorText(err), "error");
      }
    });
}

async function loadSettings() {
  await renderSchoolProfile();
  const root = document.getElementById("settings-root");
  if (!root) return;
  let profile = PROFILE;
  if (!profile) {
    try {
      profile = await fetchProfile();
      PROFILE = profile;
    } catch (err) {
      console.error("loadSettings:", err);
      loaded.settings = false;
      renderErrorBlock(root, loadSettings);
      return;
    }
  }
  const email = session.user.email ?? "";
  renderSettings(root, {
    context: "admin",
    identity: {
      displayName: profile.name || t("console.profile.admin"),
      subtitle: t("settings.roleAdmin"),
      avatarIcon: "admin_panel_settings",
      roleBadge: { text: t("settings.roleAdmin"), className: "badge-primary" },
    },
    personal: [
      { label: t("settings.fields.name"), value: profile.name, icon: "badge" },
      { label: t("settings.fields.email"), value: email, icon: "mail" },
    ],
    username: email,
    email,
  });
}

// ───────────────────────────────────────────────────────────────
//  INIT
// ───────────────────────────────────────────────────────────────
if (DEMO_MODE) {
  const logo = document.querySelector("aside .logo");
  if (logo) {
    const badge = document.createElement("span");
    badge.className = "demo-badge";
    badge.dataset.i18n = "admin.demo.badge";
    badge.dataset.i18nTitle = "admin.demo.sandboxNotice";
    badge.textContent = t("admin.demo.badge");
    badge.title = t("admin.demo.sandboxNotice");
    logo.appendChild(badge);
  }
}

// Read the school profile up front: the ID-field label it carries is needed by
// the teachers/students tables and their create forms, whichever loads first.
loadSchoolSettings().then(applyIdLabels);

loadOverview();
showSection("overview");
