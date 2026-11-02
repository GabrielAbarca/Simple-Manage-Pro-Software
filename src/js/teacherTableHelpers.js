import { t } from "./i18n.js";
import { renderErrorBlock, iconBtn } from "./ui.js";
import { IS_ADMIN, applyAdminLock } from "./teacherAuth.js";
import { state } from "./teacherState.js";

/**
 * Render why a context-dependent section cannot draw. Three distinct states:
 * a failed resolve is transient and gets a retry, an account with no teachers
 * row is expected (an admin using the console for oversight), and a school
 * with no active year is a setup gap — saying "no teacher record" for either
 * of the last two would send the reader after the wrong problem.
 * @param {Element | null} host element to render into
 * @param {() => any} onRetry re-resolves the context, then reloads the section
 */
export function renderContextGap(host, onRetry) {
  if (!host) return;
  if (state.contextError) {
    renderErrorBlock(host, onRetry);
    return;
  }
  const message =
    state.teacherId == null
      ? t("admin.today.noTeacherRecordBody")
      : t("admin.today.noActiveYear");
  host.innerHTML = `<div class="loading-cell">${message}</div>`;
}

export function makeActionBtn(
  icon,
  label,
  onClick,
  danger = false,
  adminOnly = false,
) {
  if (!adminOnly || IS_ADMIN) return iconBtn(icon, label, onClick, danger);
  // applyAdminLock only stops propagation, so the real handler must never be
  // attached to a locked button.
  const btn = iconBtn(icon, label, () => {}, danger);
  applyAdminLock(btn);
  return btn;
}
