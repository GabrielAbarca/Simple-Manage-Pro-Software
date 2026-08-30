// ─────────────────────────────────────────────────────────────────
//  teacherModal.js — the generic add/edit form modal shared by every
//  create/edit flow in the teacher console. Split out of teacher.js.
// ─────────────────────────────────────────────────────────────────
import { registerDialog } from "./dialog.js";
import { t } from "./i18n.js";
import * as v from "./validate.js";
import { showToast, errorText, openConfirm } from "./teacherFeedback.js";

// ── Generic Modal ──────────────────────────────────────────────
const modalOverlay = document.getElementById("modal-overlay");
const modalTitle = document.getElementById("modal-title");
const modalForm = /** @type {HTMLFormElement} */ (
  document.getElementById("modal-form")
);
const modalClose = document.getElementById("modal-close");
const modalCancel = document.getElementById("modal-cancel");
const modalSubmit = /** @type {HTMLButtonElement} */ (
  document.getElementById("modal-submit")
);

let currentSubmitHandler = null;
let modalDirty = false;

/** Inline validation message bound to its field (see admin.js for the rationale). */
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
  input?.setAttribute("aria-invalid", "true");
  input?.setAttribute("aria-describedby", msg.id);
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
 * Field specs → the { field: Rule[] } map validate.js runs. Mirrors
 * admin.js: a spec marked `required` gets required() prepended, so switching
 * off the browser's own validation does not quietly drop the check.
 * @param {any[]} fields
 */
function collectRules(fields) {
  /** @type {Record<string, import("./validate.js").Rule[]>} */
  const map = {};
  fields.forEach((field) => {
    if (field.disabled) return;
    const rules = [...(field.rules ?? [])];
    if (field.required) rules.unshift(v.required());
    if (field.maxLength != null) rules.push(v.maxLen(field.maxLength));
    if (rules.length) map[field.name] = rules;
  });
  return map;
}

/** validate.js message descriptors → display strings. */
function translateMessages(messages) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const [field, message] of Object.entries(messages)) {
    out[field] = t(message.key, message.vars);
  }
  return out;
}

export function openModal({
  title,
  fields,
  onSubmit,
  validate,
  submitLabel = t("common.save"),
}) {
  modalTitle.textContent = title;
  modalSubmit.textContent = submitLabel;
  modalForm.innerHTML = "";
  modalDirty = false;
  // This console still handed validation to the browser, which answers with a
  // native popup: always English, unstyleable, one field at a time, and gone
  // the moment focus moves. The admin console stopped doing that; this brings
  // the teacher console onto the same inline, translated messages.
  modalForm.noValidate = true;

  fields.forEach((field) => {
    const group = document.createElement("div");
    group.className = "field-group";

    const label = document.createElement("label");
    label.textContent = field.label;
    label.htmlFor = `modal-field-${field.name}`;
    group.appendChild(label);

    let input;

    if (field.type === "select") {
      input = document.createElement("select");
      input.id = `modal-field-${field.name}`;
      input.name = field.name;
      if (field.required) input.required = true;

      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = field.required
        ? t("common.selectPlaceholder", { label: field.label.toLowerCase() })
        : t("common.none");
      input.appendChild(placeholder);

      (field.options ?? []).forEach((opt) => {
        const o = document.createElement("option");
        o.value = opt.value;
        o.textContent = opt.label;
        if (String(opt.value) === String(field.value)) o.selected = true;
        input.appendChild(o);
      });
    } else if (field.type === "textarea") {
      input = document.createElement("textarea");
      input.id = `modal-field-${field.name}`;
      input.name = field.name;
      input.rows = 3;
      input.value = field.value ?? "";
      if (field.placeholder) input.placeholder = field.placeholder;
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
    }

    // Disabled fields render but are excluded from FormData on submit — used for
    // read-only context like national_id (registrar-owned).
    if (field.disabled) input.disabled = true;

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
    const formData = Object.fromEntries(new FormData(modalForm));

    // Validation gate: render every message under its own field and stop.
    // Field rules win over whole-form ones — a malformed value is more
    // actionable than the aggregate complaint it produces.
    clearFieldErrors();
    const errors = {
      ...(validate ? (validate(formData) ?? {}) : {}),
      ...translateMessages(v.runRules(collectRules(fields), formData)),
    };
    const invalid = Object.keys(errors);
    if (invalid.length) {
      invalid.forEach((name) => setFieldError(name, errors[name]));
      const first = modalForm.querySelector(`[name="${invalid[0]}"]`);
      if (first instanceof HTMLElement) first.focus();
      return;
    }

    modalSubmit.disabled = true;
    try {
      await onSubmit(formData);
      closeModal();
    } catch (err) {
      showToast(errorText(err), "error");
    } finally {
      modalSubmit.disabled = false;
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
 * Close on explicit intent only, confirming first when the form carries
 * unsaved edits. The X and Cancel both used to discard a half-filled form
 * without a word — the admin console already warns, this matches it.
 */
export function requestCloseModal() {
  if (!modalDirty) {
    closeModal();
    return;
  }
  openConfirm(t("admin.confirm.discardMessage"), () => closeModal(), {
    title: t("admin.confirm.discardTitle"),
    confirmLabel: t("admin.confirm.discard"),
    cancelLabel: t("admin.confirm.keepEditing"),
  });
}

// Any edit to any control marks the form dirty (delegated: the contents are
// rebuilt on every open but the <form> element itself persists), and retires
// that field's error so a correction clears the message immediately.
["input", "change"].forEach((evt) =>
  modalForm.addEventListener(evt, (e) => {
    modalDirty = true;
    const name = /** @type {any} */ (e.target)?.name;
    if (name) clearFieldError(name);
  }),
);

modalClose.addEventListener("click", requestCloseModal);
modalCancel.addEventListener("click", requestCloseModal);

registerDialog(modalOverlay, { close: requestCloseModal });
