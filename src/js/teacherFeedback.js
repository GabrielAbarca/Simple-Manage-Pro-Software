// ─────────────────────────────────────────────────────────────────
//  teacherFeedback.js — toast notices, write-failure text, and the shared
//  confirm dialog. Split out of teacher.js's UI-helpers section.
// ─────────────────────────────────────────────────────────────────
import { t } from "./i18n.js";
import { mapDbError } from "./dbErrors.js";
import { registerDialog } from "./dialog.js";

// ── Toast ──────────────────────────────────────────────────────
const toastContainer = document.getElementById("toast-container");

export function showToast(message, type = "success") {
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  const icon = type === "success" ? "check_circle" : "error";
  toast.innerHTML = `<span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-${icon}"></use></svg></span>${message}`;
  toastContainer.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

/**
 * User-facing text for a failed write — the same treatment the admin console
 * gives it. `err.message` on a PostgREST failure names constraints and columns
 * ("violates foreign key constraint class_subject_teachers_teacher_id_fkey")
 * and means nothing to a teacher; this maps the SQLSTATE to a translated
 * sentence and keeps the raw error in the console for debugging.
 * @param {any} err
 */
export function errorText(err) {
  console.error("[SMP] Write failed:", err);
  return t(mapDbError(err).key);
}

// ── Confirm Modal ──────────────────────────────────────────────
const confirmOverlay = document.getElementById("confirm-overlay");
const confirmTitle = document.getElementById("confirm-title");
const confirmMessage = document.getElementById("confirm-message");
const confirmDelete = /** @type {HTMLButtonElement} */ (
  document.getElementById("confirm-delete")
);
const confirmCancel = document.getElementById("confirm-cancel");

let confirmHandler = null;

/**
 * Ask before an irreversible action. Defaults to the delete wording; `opts`
 * retitles it and relabels the buttons so a non-delete decision (discarding a
 * dirty form) can reuse the same dialog rather than inventing another.
 * @param {string} message
 * @param {() => any} onConfirm
 * @param {{ title?: string, confirmLabel?: string, cancelLabel?: string,
 *   danger?: boolean }} [opts]
 */
export function openConfirm(message, onConfirm, opts = {}) {
  const danger = opts.danger !== false;
  confirmTitle.textContent = opts.title ?? t("admin.confirm.title");
  confirmMessage.textContent = message;
  confirmDelete.textContent = opts.confirmLabel ?? t("common.delete");
  confirmDelete.classList.toggle("btn-danger", danger);
  confirmDelete.classList.toggle("btn-primary", !danger);
  confirmCancel.textContent = opts.cancelLabel ?? t("common.cancel");
  confirmHandler = onConfirm;
  confirmOverlay.classList.add("active");
}

export function closeConfirm() {
  confirmOverlay.classList.remove("active");
  confirmHandler = null;
}

confirmDelete.addEventListener("click", async () => {
  if (!confirmHandler) return;
  confirmDelete.disabled = true;
  try {
    await confirmHandler();
    closeConfirm();
  } catch (err) {
    showToast(errorText(err), "error");
  } finally {
    confirmDelete.disabled = false;
  }
});
confirmCancel.addEventListener("click", closeConfirm);

registerDialog(confirmOverlay, { close: closeConfirm });
