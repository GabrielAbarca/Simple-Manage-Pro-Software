// ─────────────────────────────────────────────────────────────────
//  modal.js — the generic add/edit form dialog every create/edit flow
//  in the admin console opens. Split out of admin.js.
//
//  Owns validation, inline field errors, dirty tracking and the submit
//  gate; the field-spec → DOM work lives in modalFields.js.
// ─────────────────────────────────────────────────────────────────
import { registerDialog } from "../../dialog.js";
import { t } from "../../i18n.js";
import * as v from "../../validate.js";
import { showToast, errorText, openConfirm } from "./feedback.js";
import { buildFieldGroup, collectValues } from "./modalFields.js";

const modalOverlay = document.getElementById("modal-overlay");
const modalTitle = document.getElementById("modal-title");
const modalForm = /** @type {HTMLFormElement} */ (
  document.getElementById("modal-form")
);

let currentSubmitHandler = null;
// Has the open form been touched? Drives the discard confirmation, so a stray
// click or a mistaken Cancel can never silently throw away typed work.
let modalDirty = false;

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
  /** @type {Record<string, import("../../validate.js").Rule[]>} */
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
 * @param {Record<string, import("../../validate.js").Message>} messages
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
 * Render every failing field's message inline and focus the first one.
 * @returns {boolean} true when the form is invalid and the write must not run
 */
function renderErrors(errors) {
  const invalid = Object.keys(errors);
  if (!invalid.length) return false;
  invalid.forEach((name) => setFieldError(name, errors[name]));
  const first = modalForm.querySelector(`[name="${invalid[0]}"]`);
  if (first instanceof HTMLElement) first.focus();
  return true;
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
export function openModal({
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

  fields.forEach((field) => modalForm.appendChild(buildFieldGroup(field)));

  if (currentSubmitHandler)
    modalForm.removeEventListener("submit", currentSubmitHandler);

  currentSubmitHandler = async (e) => {
    e.preventDefault();
    const values = collectValues(fields, modalForm);

    // Inline validation gate: render every message under its field and stop.
    // Field rules take precedence over whole-form ones — a malformed value is
    // more actionable than the aggregate complaint it causes (a weight of 150
    // should read "enter 0–100", not "the year now totals 200%").
    clearFieldErrors();
    const errors = {
      ...(validate ? (validate(values) ?? {}) : {}),
      ...translateMessages(v.runRules(collectRules(fields), values)),
    };
    if (renderErrors(errors)) return;

    const submitBtn = /** @type {HTMLButtonElement} */ (
      document.getElementById("modal-submit")
    );
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

export function closeModal() {
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
export function requestCloseModal() {
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

// Escape routes through requestCloseModal, so the unsaved-changes warning
// still stands in its way.
registerDialog(modalOverlay, { close: requestCloseModal });
