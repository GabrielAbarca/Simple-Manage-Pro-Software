// ─────────────────────────────────────────────────────────────────
//  datepicker.js — the app's own calendar, over <input type="date">.
//
//  Two separate problems with the native control.
//
//  1. Its calendar popup is drawn by the OS: unstyleable, off the type
//     scale, and (before color-scheme) light in dark mode.
//  2. Its TEXT follows the BROWSER's locale, not the app's. A director
//     using the app in Spanish on an English-locale browser reads
//     mm/dd/yyyy. The app's own language toggle has no say — which is
//     the same defect as the rest of this pass, one layer down.
//
//  ENHANCE, NEVER REPLACE. The native input stays in the DOM, clipped,
//  keeping its id and name, and remains the source of truth: it holds
//  the ISO value that FormData submits, validate.js checks
//  (dateWithin / endAfterStart / notFuture) and the e2e suite sets with
//  page.fill(). A spike confirmed fill() still works on a clipped input.
//  What the user sees and types into is a text field formatted in the
//  APP's locale, which writes back to it.
//
//  Touch devices keep the OS picker.
// ─────────────────────────────────────────────────────────────────

import { showPopover } from "./popover.js";
import { t, localeTag } from "../i18n.js";

let uid = 0;

function prefersNative() {
  return window.matchMedia?.("(pointer: coarse)").matches ?? false;
}

import {
  toIso,
  fromIso,
  dateFieldOrder,
  firstDayOfWeek,
  parseDisplay,
  formatDisplay,
  monthGrid,
  withinRange,
} from "./dateUtils.js";

// ── Component ────────────────────────────────────────────────────

/**
 * Give one <input type="date"> the app's calendar. Idempotent.
 * @param {HTMLInputElement} native
 */
export function enhanceDate(native) {
  if (!(native instanceof HTMLInputElement) || native.type !== "date") return;
  if (native.dataset.smpEnhanced) return;
  native.dataset.smpEnhanced = "true";

  const id = native.id || `smp-date-${++uid}`;
  const fieldId = `${id}-display`;
  const gridId = `${id}-grid`;

  const wrap = document.createElement("div");
  wrap.className = "smp-date";
  native.parentNode?.insertBefore(wrap, native);
  wrap.appendChild(native);
  native.classList.add("smp-date__native");
  native.setAttribute("aria-hidden", "true");
  native.tabIndex = -1;

  // What the user actually reads and types into. Deliberately has NO `name`:
  // admin.js collects values with [name="…"] and teacher.js uses FormData, so
  // an unnamed field cannot shadow the native one that holds the real value.
  const field = document.createElement("input");
  field.type = "text";
  field.id = fieldId;
  field.className = "smp-date__field";
  field.autocomplete = "off";
  field.inputMode = "numeric";
  wrap.appendChild(field);
  // Same reasoning as the select: match the surface's own padding, and keep
  // the right edge clear of the calendar button.
  const cs = getComputedStyle(native);
  field.style.paddingTop = cs.paddingTop;
  field.style.paddingBottom = cs.paddingBottom;
  field.style.paddingLeft = cs.paddingLeft;
  field.style.paddingRight = "2.4rem";

  const openBtn = document.createElement("button");
  openBtn.type = "button";
  openBtn.className = "smp-date__button";
  openBtn.innerHTML = `<span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-calendar_month"></use></svg></span>`;
  wrap.appendChild(openBtn);

  const label =
    (native.id &&
      document.querySelector(`label[for="${CSS.escape(native.id)}"]`)) ||
    native.closest("label");
  if (label instanceof HTMLLabelElement) {
    if (!label.id) label.id = `${id}-label`;
    label.htmlFor = fieldId;
  }

  const pop = document.createElement("div");
  pop.className = "smp-date__pop";
  pop.hidden = true;
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-modal", "false");

  /**
   * The day button for an ISO date, typed so `.focus()` is reachable.
   * @param {string} iso
   * @returns {HTMLElement | null}
   */
  const dayCell = (iso) => {
    const el = pop.querySelector(`[data-iso="${iso}"]`);
    return el instanceof HTMLElement ? el : null;
  };

  let detach = null;
  let viewY = 0;
  let viewM = 0;
  let focusIso = "";

  const isOpen = () => !pop.hidden;
  const locale = () => localeTag();

  function applyLabels() {
    field.placeholder = dateFieldOrder(locale())
      .map((f) => (f === "year" ? "yyyy" : f === "month" ? "mm" : "dd"))
      .join("/");
    openBtn.title = t("a11y.openCalendar");
    openBtn.setAttribute("aria-label", t("a11y.openCalendar"));
    if (label?.id) pop.setAttribute("aria-labelledby", label.id);
  }

  function syncFromNative() {
    field.value = formatDisplay(native.value, locale());
    field.disabled = native.disabled;
    openBtn.disabled = native.disabled;
    if (native.required) field.setAttribute("aria-required", "true");
  }

  /** Write an ISO date back to the native input and tell the app. */
  function commitIso(iso) {
    if (native.value === iso) return;
    native.value = iso;
    // Bubbling events carrying the native element's `name` — this is what
    // marks the modal dirty and clears that field's inline error.
    native.dispatchEvent(new Event("input", { bubbles: true }));
    native.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function renderCal() {
    const loc = locale();
    const ws = firstDayOfWeek(loc);
    const min = native.min || "";
    const max = native.max || "";
    const todayIso = toIso(new Date());
    const monthName = new Intl.DateTimeFormat(loc, {
      month: "long",
      year: "numeric",
    }).format(new Date(viewY, viewM, 1));

    const dayNames = [];
    const fmt = new Intl.DateTimeFormat(loc, { weekday: "short" });
    for (let i = 0; i < 7; i++) {
      // 2024-01-07 was a Sunday — a stable anchor for weekday names.
      dayNames.push(fmt.format(new Date(2024, 0, 7 + ((ws + i) % 7))));
    }

    const cells = monthGrid(viewY, viewM, ws);
    pop.innerHTML = `
      <div class="smp-date__head">
        <button type="button" class="smp-date__nav" data-nav="-1"
          aria-label="${t("a11y.prevMonth")}" title="${t("a11y.prevMonth")}">
          <span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-chevron_left"></use></svg></span>
        </button>
        <span class="smp-date__month" aria-live="polite">${monthName}</span>
        <button type="button" class="smp-date__nav" data-nav="1"
          aria-label="${t("a11y.nextMonth")}" title="${t("a11y.nextMonth")}">
          <span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-chevron_right"></use></svg></span>
        </button>
      </div>
      <div class="smp-date__grid" role="grid" id="${gridId}">
        <div class="smp-date__row" role="row">
          ${dayNames.map((n) => `<span class="smp-date__dow" role="columnheader" abbr="${n}">${n}</span>`).join("")}
        </div>
        ${[0, 1, 2, 3, 4, 5]
          .map(
            (r) =>
              `<div class="smp-date__row" role="row">${cells
                .slice(r * 7, r * 7 + 7)
                .map((c) => {
                  const off = withinRange(c.iso, min, max)
                    ? ""
                    : " is-disabled";
                  const out = c.outside ? " is-outside" : "";
                  const sel = c.iso === native.value ? " is-selected" : "";
                  const tod = c.iso === todayIso ? " is-today" : "";
                  const focusable = c.iso === focusIso ? "0" : "-1";
                  return `<button type="button" role="gridcell" tabindex="${focusable}"
                class="smp-date__day${off}${out}${sel}${tod}" data-iso="${c.iso}"
                ${off ? "disabled" : ""} aria-selected="${c.iso === native.value}">${c.day}</button>`;
                })
                .join("")}</div>`,
          )
          .join("")}
      </div>`;
  }

  function focusDay(iso, { render = true } = {}) {
    focusIso = iso;
    const d = fromIso(iso);
    if (d && (d.getFullYear() !== viewY || d.getMonth() !== viewM)) {
      viewY = d.getFullYear();
      viewM = d.getMonth();
    }
    if (render) renderCal();
    dayCell(iso)?.focus();
  }

  function shift(days) {
    const d = fromIso(focusIso) ?? new Date();
    d.setDate(d.getDate() + days);
    focusDay(toIso(d));
  }

  function shiftMonth(n) {
    const d = fromIso(focusIso) ?? new Date();
    const day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + n);
    // Clamp so 31 Jan → 28/29 Feb rather than rolling into March.
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, last));
    focusDay(toIso(d));
  }

  function open() {
    if (isOpen() || native.disabled || prefersNative()) return;
    const start = fromIso(native.value) ?? new Date();
    viewY = start.getFullYear();
    viewM = start.getMonth();
    focusIso = native.value || toIso(start);
    renderCal();
    detach = showPopover(pop, wrap, () => close(), { matchWidth: false });
    // Focus into the grid: arrow keys are expected to walk the calendar.
    dayCell(focusIso)?.focus();
  }

  function close({ focus = true } = {}) {
    if (!isOpen()) return;
    detach?.();
    detach = null;
    if (focus) openBtn.focus();
  }

  function pick(iso) {
    if (!withinRange(iso, native.min || "", native.max || "")) return;
    commitIso(iso);
    syncFromNative();
    close();
  }

  openBtn.addEventListener("click", () => (isOpen() ? close() : open()));

  pop.addEventListener("click", (e) => {
    const el = /** @type {HTMLElement} */ (e.target);
    const nav = el.closest?.("[data-nav]");
    if (nav) {
      shiftMonth(Number(/** @type {HTMLElement} */ (nav).dataset.nav));
      return;
    }
    const day = el.closest?.("[data-iso]");
    if (day) pick(/** @type {HTMLElement} */ (day).dataset.iso);
  });

  pop.addEventListener("keydown", (e) => {
    switch (e.key) {
      case "ArrowLeft":
        e.preventDefault();
        shift(-1);
        break;
      case "ArrowRight":
        e.preventDefault();
        shift(1);
        break;
      case "ArrowUp":
        e.preventDefault();
        shift(-7);
        break;
      case "ArrowDown":
        e.preventDefault();
        shift(7);
        break;
      case "Home":
        e.preventDefault();
        shift(-(fromIso(focusIso)?.getDay() ?? 0));
        break;
      case "End":
        e.preventDefault();
        shift(6 - (fromIso(focusIso)?.getDay() ?? 0));
        break;
      case "PageUp":
        e.preventDefault();
        shiftMonth(e.shiftKey ? -12 : -1);
        break;
      case "PageDown":
        e.preventDefault();
        shiftMonth(e.shiftKey ? 12 : 1);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        pick(focusIso);
        break;
      case "Escape":
        e.preventDefault();
        close();
        break;
      case "Tab":
        close({ focus: false });
        break;
      default:
        break;
    }
  });

  // Typing: parse on blur and on Enter, never mid-keystroke — reformatting
  // while someone is still typing moves the caret out from under them.
  const commitTyped = () => {
    const iso = parseDisplay(field.value, locale());
    if (iso === null) return; // unparseable: leave it for inline validation
    commitIso(iso);
    field.value = formatDisplay(iso, locale());
  };
  field.addEventListener("blur", commitTyped);
  field.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      commitTyped();
    }
    if (e.key === "ArrowDown" && e.altKey) {
      e.preventDefault();
      open();
    }
  });

  native.addEventListener("change", syncFromNative);
  new MutationObserver(syncFromNative).observe(native, {
    attributes: true,
    attributeFilter: ["value", "min", "max", "disabled", "required"],
  });

  applyLabels();
  syncFromNative();
}
