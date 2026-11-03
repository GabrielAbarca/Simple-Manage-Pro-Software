import { t } from "../i18n.js";
import { state } from "../studentState.js";
import { bandClass } from "../promotion.js";

/** Student/teacher status label from the DB status value. */
export function statusLabel(status) {
  return status ? t(`enums.studentStatus.${status}`) : "";
}

/** A score wrapped in its pass/mid/fail color-coding span. */
export function scoreHtml(score) {
  return `<span class="${bandClass(score, state.school)}">${score}</span>`;
}
