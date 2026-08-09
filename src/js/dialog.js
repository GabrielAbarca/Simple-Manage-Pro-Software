// ─────────────────────────────────────────────────────────────────
//  dialog.js — the keyboard contract every modal in the app owes.
//
//  The two consoles between them raise ten dialogs (add/edit form,
//  confirm, CSV import, student drawer, manage assignments, per-student
//  grades, categories, post grades, column entry). Each was opened by
//  toggling a single `.active` class, which is enough to make a dialog
//  APPEAR and nothing else: Tab walked straight out of it into the page
//  behind, Escape did nothing, focus never entered on open and never
//  came back to the trigger on close. A keyboard or screen-reader user
//  had no way to tell a dialog had opened, and no way out of it.
//
//  Rather than patch ten call sites, this module watches the overlays.
//  `register()` attaches a MutationObserver to the `class` attribute, so
//  the existing `classList.add("active")` calls keep working untouched
//  and simply gain the contract. That also means a dialog added later
//  cannot forget to opt in — it only has to be registered.
//
//  Stack-based, because the consoles genuinely nest: the shared form and
//  confirm dialogs open ON TOP of Manage Assignments. Only the topmost
//  dialog traps focus and answers Escape.
// ─────────────────────────────────────────────────────────────────

/**
 * Things a user can Tab to. `:not([disabled])` matters for the submit
 * button, which is disabled for the duration of an in-flight save.
 */
const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/** @type {Array<{ overlay: HTMLElement, close: (() => void) | null, trigger: Element | null }>} */
const stack = [];

/**
 * Visible focusables, in DOM order. `offsetParent` is null for anything
 * `display: none`, which is how the login form hides its sign-up-only
 * fields — those must not be Tab stops while hidden.
 * @param {HTMLElement} root
 */
function focusablesIn(root) {
  return /** @type {HTMLElement[]} */ ([
    ...root.querySelectorAll(FOCUSABLE),
  ]).filter((el) => el.offsetParent !== null || el === document.activeElement);
}

/**
 * Where focus should land when a dialog opens. The first field beats the
 * close button: a director opening "Add student" wants the cursor in the
 * name box, not on the X. Falls back to the dialog itself so focus at
 * least leaves the page behind (the panel carries tabindex="-1" for this).
 * @param {HTMLElement} overlay
 */
function initialFocus(overlay) {
  const panel = overlay.querySelector('[role="dialog"], [role="alertdialog"]');
  const scope = /** @type {HTMLElement} */ (panel ?? overlay);
  const candidates = focusablesIn(scope);
  const field = candidates.find(
    (el) =>
      !el.classList.contains("modal-close") &&
      (el instanceof HTMLInputElement ||
        el instanceof HTMLSelectElement ||
        el instanceof HTMLTextAreaElement),
  );
  return field ?? candidates[0] ?? scope;
}

/** Everything outside the open dialog stops being reachable. */
function setBackgroundInert(on) {
  document.querySelectorAll("body > *").forEach((el) => {
    if (el.classList?.contains("modal-overlay")) return;
    if (el.classList?.contains("drawer-overlay")) return;
    if (el.classList?.contains("toast-container")) return;
    // Select/date popups are rendered into a body-level root so they escape
    // the modal's `overflow-y: auto` clipping. They belong to whatever dialog
    // is open, so they must not be inerted along with the background.
    if (el.classList?.contains("smp-popover-root")) return;
    if (on) el.setAttribute("inert", "");
    else el.removeAttribute("inert");
  });
}

/**
 * Things that get first refusal on Escape.
 *
 * This module listens on `document` at CAPTURE phase, which means it sees
 * Escape before anything rendered inside the dialog does. That is right for a
 * bare dialog and wrong the moment something transient is open inside one: a
 * combobox listbox inside the add/edit form would otherwise have its Escape
 * eaten by the form, closing the whole dialog when the user only meant to
 * dismiss the list.
 *
 * A guard returns true while it owns Escape. Registered by the controls
 * module; the dependency runs one way (controls → dialog) so there is no
 * import cycle.
 * @type {Array<() => boolean>}
 */
const escapeGuards = [];

/** @param {() => boolean} fn true while the caller should receive Escape first */
export function registerEscapeGuard(fn) {
  escapeGuards.push(fn);
}

function top() {
  return stack[stack.length - 1] ?? null;
}

/**
 * Keep Tab inside the topmost dialog. Native `inert` on the background
 * already does most of this in current browsers; the explicit wrap is the
 * fallback for the rest, and it also handles the nested-dialog case where
 * the thing behind is another dialog rather than the page.
 * @param {KeyboardEvent} e
 */
function onKeydown(e) {
  const current = top();
  if (!current) return;

  if (e.key === "Escape") {
    // Something transient inside the dialog owns this Escape — a combobox
    // listbox, a calendar popover. Let it close itself; the dialog stays.
    if (escapeGuards.some((fn) => fn())) return;
    e.preventDefault();
    // Deliberately routed through the dialog's OWN closer, not a blanket
    // hide: the admin form's closer is the one that warns before throwing
    // away unsaved edits, and Escape must not be a way around that.
    current.close?.();
    return;
  }

  if (e.key !== "Tab") return;

  const panel = current.overlay.querySelector(
    '[role="dialog"], [role="alertdialog"]',
  );
  const items = focusablesIn(
    /** @type {HTMLElement} */ (panel ?? current.overlay),
  );
  if (!items.length) return;

  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;

  if (e.shiftKey && (active === first || !current.overlay.contains(active))) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
}

document.addEventListener("keydown", onKeydown, true);

/** @param {HTMLElement} overlay @param {(() => void) | null} close */
function activate(overlay, close) {
  if (stack.some((d) => d.overlay === overlay)) return;
  stack.push({
    overlay,
    close,
    // Captured BEFORE focus moves, so closing can put the user back on the
    // row action they came from instead of dumping them at the top of the
    // page with the whole tab order to walk again.
    trigger: document.activeElement,
  });
  setBackgroundInert(true);
  initialFocus(overlay).focus();
}

/** @param {HTMLElement} overlay */
function deactivate(overlay) {
  const i = stack.findIndex((d) => d.overlay === overlay);
  if (i === -1) return;
  const [entry] = stack.splice(i, 1);
  if (!stack.length) setBackgroundInert(false);
  const trigger = entry.trigger;
  if (trigger instanceof HTMLElement && document.contains(trigger)) {
    trigger.focus();
  }
}

/**
 * Give an overlay the full dialog contract. Idempotent per element.
 *
 * @param {HTMLElement | null} overlay the `.modal-overlay` / `.drawer-overlay`
 * @param {{ close?: () => void }} [opts] `close` is what Escape calls — pass the
 *   same function the X button uses, so both routes honour any dirty-form
 *   warning. Omit it and Escape does nothing for that dialog.
 */
export function registerDialog(overlay, opts = {}) {
  if (!overlay || overlay.dataset.dialogRegistered) return;
  overlay.dataset.dialogRegistered = "true";

  // The panel needs to be focusable as a last resort (a dialog whose body is
  // still loading has nothing else to focus).
  const panel = overlay.querySelector('[role="dialog"], [role="alertdialog"]');
  if (panel && !panel.hasAttribute("tabindex")) {
    panel.setAttribute("tabindex", "-1");
  }

  const observer = new MutationObserver(() => {
    const isOpen = overlay.classList.contains("active");
    const wasOpen = stack.some((d) => d.overlay === overlay);
    if (isOpen && !wasOpen) activate(overlay, opts.close ?? null);
    else if (!isOpen && wasOpen) deactivate(overlay);
  });
  observer.observe(overlay, {
    attributes: true,
    attributeFilter: ["class"],
  });
}

/** True while any registered dialog is open (used to suppress page-level keys). */
export function isDialogOpen() {
  return stack.length > 0;
}
