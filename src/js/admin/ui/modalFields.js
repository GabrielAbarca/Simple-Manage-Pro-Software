// ─────────────────────────────────────────────────────────────────
//  modalFields.js — field spec → DOM, for the admin console's generic
//  form modal. Split out of admin.js's openModal so the dialog module
//  is left with the parts that matter: validation, dirty tracking and
//  the submit gate.
// ─────────────────────────────────────────────────────────────────
import { t } from "../../i18n.js";

/**
 * A field spec rendered as a `.field-group`: heading, control, optional help.
 * @param {any} field
 */
export function buildFieldGroup(field) {
  const group = document.createElement("div");
  group.className = "field-group";
  group.appendChild(buildHeading(field));
  const build = FIELD_BUILDERS[field.type] ?? buildTextInput;
  group.appendChild(build(field));
  if (field.help) group.appendChild(buildHelp(field.help));
  return group;
}

/**
 * Read the open form back out as name → value. Checkbox groups yield arrays;
 * everything else yields the control's string value.
 * @param {any[]} fields
 * @param {HTMLFormElement} form
 */
export function collectValues(fields, form) {
  /** @type {Record<string, any>} */
  const values = {};
  fields.forEach((field) => {
    if (field.type === "checkboxes") {
      values[field.name] = [
        ...form.querySelectorAll(`input[name="${field.name}"]:checked`),
      ].map((el) => /** @type {HTMLInputElement} */ (el).value);
      return;
    }
    const el = form.querySelector(`[name="${field.name}"]`);
    values[field.name] = el ? /** @type {any} */ (el).value : "";
  });
  return values;
}

// A checkbox group has no single control for a <label> to point at, so it gets
// a plain legend instead — a label with a dangling `for` is worse than none.
function buildHeading(field) {
  if (field.type === "checkboxes") {
    const legend = document.createElement("span");
    legend.className = "field-legend";
    legend.textContent = field.label;
    return legend;
  }
  const label = document.createElement("label");
  label.textContent = field.label;
  label.htmlFor = `modal-field-${field.name}`;
  return label;
}

function buildHelp(text) {
  const help = document.createElement("small");
  help.className = "field-help";
  help.textContent = text;
  return help;
}

function buildSelect(field) {
  const select = document.createElement("select");
  select.id = `modal-field-${field.name}`;
  select.name = field.name;
  if (field.required) select.required = true;

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = field.required
    ? t("common.selectPlaceholder", { label: field.label.toLowerCase() })
    : t("common.none");
  select.appendChild(placeholder);

  (field.options ?? []).forEach((opt) => {
    const o = document.createElement("option");
    o.value = opt.value;
    o.textContent = opt.label;
    if (String(opt.value) === String(field.value)) o.selected = true;
    select.appendChild(o);
  });
  return select;
}

function buildCheckboxes(field) {
  const grid = document.createElement("div");
  grid.className = "checkbox-grid";
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
    grid.appendChild(wrap);
  });
  return grid;
}

function buildTextarea(field) {
  const textarea = document.createElement("textarea");
  textarea.id = `modal-field-${field.name}`;
  textarea.name = field.name;
  textarea.rows = 3;
  textarea.value = field.value ?? "";
  if (field.placeholder) textarea.placeholder = field.placeholder;
  if (field.maxLength != null) textarea.maxLength = field.maxLength;
  return textarea;
}

function buildTextInput(field) {
  const input = document.createElement("input");
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
  return input;
}

const FIELD_BUILDERS = {
  select: buildSelect,
  checkboxes: buildCheckboxes,
  textarea: buildTextarea,
};
