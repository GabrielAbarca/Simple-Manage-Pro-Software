// ─────────────────────────────────────────────────────────────────
//  setupChecklist.js — the overview's guided setup for a new school:
//  the steps from an empty project to a running one, in dependency
//  order, each linking to the screen that does it.
// ─────────────────────────────────────────────────────────────────
import { t, tn } from "../../i18n.js";
import { state } from "../state.js";
import { showSection } from "../nav.js";
import { escapeHtml } from "../ui/format.js";
import { setupSteps } from "../domain/setupSteps.js";
import { openYearForm } from "./years.js";

/** Each step's screen → its sidebar label key. */
const NAV_KEYS = {
  yearperiods: "console.nav.yearPeriods",
  gradessections: "console.nav.gradesSections",
  subjects: "console.nav.subjects",
  teachers: "console.nav.teachers",
  assignments: "console.nav.assignments",
  students: "console.nav.students",
};

// Per school year, so a new curso lectivo brings the checklist back.
const hiddenKey = () =>
  `smp-setup-checklist-hidden:${state.activeYear?.id ?? "none"}`;

function isHidden() {
  try {
    return localStorage.getItem(hiddenKey()) === "1";
  } catch {
    return false;
  }
}

/** @param {boolean} hidden */
function setHidden(hidden) {
  try {
    if (hidden) localStorage.setItem(hiddenKey(), "1");
    else localStorage.removeItem(hiddenKey());
  } catch {
    /* the choice holds for this visit only */
  }
}

/** Move focus to a screen's heading after navigating to it. */
function focusHeading(selector) {
  const heading = /** @type {HTMLElement | null} */ (
    document.querySelector(selector)
  );
  if (!heading) return;
  heading.tabIndex = -1;
  heading.focus();
}

/** @param {import("../domain/setupSteps.js").SetupStep} step */
function buttonLabel(step) {
  if (step.id === "year" && !step.activate) return t("console.years.add");
  if (step.id === "logins") return t("console.overview.setup.goLogins");
  return t("console.overview.setup.go", { page: t(NAV_KEYS[step.page]) });
}

/**
 * Render the checklist into `host`. An untouched school always gets it, with
 * no way to hide it, since it is the only thing on the screen. Otherwise it
 * shows until every step is done, unless the director hid it for this year.
 * @param {HTMLElement} host
 * @param {import("../domain/setupSteps.js").SetupFacts | null} facts null
 *   when the checklist's own reads failed
 * @param {{ untouched: boolean }} opts
 */
export function renderSetupChecklist(host, facts, { untouched }) {
  const list = facts ? setupSteps(facts) : [];
  const left = list.filter((s) => !s.done).length;
  if (!facts || !left) {
    host.hidden = true;
    host.innerHTML = "";
    return;
  }
  host.hidden = false;

  if (!untouched && isHidden()) {
    host.innerHTML = `<button type="button" class="btn btn-ghost btn-sm" id="setup-show">${escapeHtml(
      tn("console.overview.setup.show", left),
    )}</button>`;
    host.querySelector("#setup-show")?.addEventListener("click", () => {
      setHidden(false);
      renderSetupChecklist(host, facts, { untouched });
      focusHeading("#overview-setup h2");
    });
    return;
  }

  const next = list.find((s) => !s.done);
  const items = list
    .map((s, i) => {
      const action = s.done
        ? ""
        : `<button type="button" class="btn ${s === next ? "btn-primary" : "btn-ghost"} btn-sm" data-setup-step="${s.id}">${escapeHtml(buttonLabel(s))}</button>`;
      const mark = s.done
        ? `<span class="setup-step-mark" role="img" aria-label="${escapeHtml(t("console.overview.setup.stepDone"))}"><svg aria-hidden="true"><use href="#icon-check_circle"></use></svg></span>`
        : `<span class="setup-step-mark" aria-hidden="true">${i + 1}</span>`;
      const hintKey = s.activate ? "activateHint" : "hint";
      return `
        <li class="setup-step${s.done ? " is-done" : ""}">
          ${mark}
          <div class="setup-step-body">
            <b>${escapeHtml(t(`console.overview.setup.steps.${s.id}.title`))}</b>
            <span>${escapeHtml(t(`console.overview.setup.steps.${s.id}.${hintKey}`))}</span>
          </div>
          ${action}
        </li>`;
    })
    .join("");

  host.innerHTML = `
    <div class="console-panel setup-checklist">
      <div class="panel-head">
        <div>
          <h2>${escapeHtml(t("console.overview.setupTitle"))}</h2>
          <p class="panel-sub">${escapeHtml(
            t("console.overview.setup.progress", {
              done: list.length - left,
              total: list.length,
            }),
          )}</p>
        </div>
        ${
          untouched
            ? ""
            : `<div class="panel-actions"><button type="button" class="btn btn-ghost btn-sm" id="setup-hide" aria-label="${escapeHtml(
                t("console.overview.setup.hideLabel"),
              )}">${escapeHtml(t("console.overview.setup.hide"))}</button></div>`
        }
      </div>
      <ol class="setup-steps" role="list">${items}</ol>
    </div>`;

  host.querySelectorAll("[data-setup-step]").forEach((btn) => {
    const step = list.find(
      (s) => s.id === /** @type {HTMLElement} */ (btn).dataset.setupStep,
    );
    btn.addEventListener("click", () => {
      showSection(step.page);
      if (step.id === "year" && !step.activate) openYearForm();
      else focusHeading(`#view-${step.page} h1`);
    });
  });
  host.querySelector("#setup-hide")?.addEventListener("click", () => {
    setHidden(true);
    renderSetupChecklist(host, facts, { untouched });
    /** @type {HTMLElement | null} */ (
      host.querySelector("#setup-show")
    )?.focus();
  });
}
