import { t } from "../i18n.js";

/** Student/teacher status label from the DB status value. */
export function statusLabel(status) {
  return status ? t(`enums.studentStatus.${status}`) : "";
}

/** A score wrapped in its pass/mid/fail color-coding span. */
export function scoreHtml(score) {
  const cls =
    score >= 70 ? "score-high" : score >= 50 ? "score-mid" : "score-low";
  return `<span class="${cls}">${score}</span>`;
}
