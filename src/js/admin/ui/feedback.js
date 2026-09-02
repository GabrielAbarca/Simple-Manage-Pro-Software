// ─────────────────────────────────────────────────────────────────
//  feedback.js — the admin console's non-form feedback surfaces: the
//  toast strip, the database-error translator, and the confirm/notice
//  dialog. Split out of admin.js's UI helpers.
//
//  Deliberately imports no data layer and no form modal, so both of
//  those can depend on it without a cycle.
// ─────────────────────────────────────────────────────────────────
import { registerDialog } from "../../dialog.js";
import { t } from "../../i18n.js";
import { mapDbError } from "../../dbErrors.js";
import { escapeHtml } from "./format.js";

const toastContainer = document.getElementById("toast-container");

export function showToast(message, type = "success") {
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
export function errorText(err) {
  console.error("[SMP] Write failed:", err);
  return t(mapDbError(err).key);
}

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
export function openConfirm(message, onConfirm, opts = {}) {
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
export function openNotice(message, opts = {}) {
  openConfirm(message, () => {}, {
    title: opts.title,
    confirmLabel: opts.closeLabel ?? t("common.close"),
    danger: false,
  });
  confirmCancelBtn.style.display = "none";
}

export function closeConfirm() {
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

// Focus trap, Escape and focus restoration. Escape routes through closeConfirm
// so it behaves exactly like the Cancel button.
registerDialog(confirmOverlay, { close: closeConfirm });
