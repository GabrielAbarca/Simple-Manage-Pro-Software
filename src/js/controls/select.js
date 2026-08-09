// ─────────────────────────────────────────────────────────────────
//  select.js — the app's own dropdown, over the browser's <select>.
//
//  A <select>'s option list is drawn by the operating system. It cannot
//  be styled, it ignores the app's type scale and spacing, and before
//  `color-scheme` landed it ignored dark mode outright. That list is the
//  last thing in the app the design system did not own.
//
//  ENHANCE, NEVER REPLACE. The native <select> stays in the DOM with its
//  id, name and <option>s, and remains the single source of truth:
//    • FormData and the modal submit path read it,
//    • validate.js rules run against it,
//    • the demo-mode delta layer writes through it,
//    • and the e2e suite drives it with page.selectOption().
//  It is visually clipped, never `display: none` — a spike confirmed
//  Playwright still acts on an opacity:0 control but not a hidden one.
//  If this module ever throws, what is left behind is a working select.
//
//  Touch devices keep the OS picker: a wheel picker beats any custom
//  list on a phone, and both Material and HIG keep them.
//
//  Keyboard follows the APG select-only combobox pattern — focus stays
//  on the trigger and the active option is tracked with
//  aria-activedescendant, rather than moving DOM focus into the list.
// ─────────────────────────────────────────────────────────────────

import { showPopover } from "./popover.js";
import { resolveTypeahead } from "./typeahead.js";

let uid = 0;

/** Coarse pointers keep the native control. Re-read per call — a hybrid
 *  laptop can change primary pointer without a reload. */
function prefersNative() {
  return window.matchMedia?.("(pointer: coarse)").matches ?? false;
}

/**
 * Options as flat rows, keeping group headings inline so the listbox can
 * render <optgroup> without a nested structure to walk.
 * @param {HTMLSelectElement} native
 */
function readOptions(native) {
  /** @type {Array<{ kind: "group"|"option", label: string, value?: string,
   *   disabled?: boolean, selected?: boolean, index?: number }>} */
  const rows = [];
  [...native.children].forEach((child) => {
    if (child instanceof HTMLOptGroupElement) {
      rows.push({ kind: "group", label: child.label });
      [...child.children].forEach((o) => {
        if (o instanceof HTMLOptionElement) rows.push(toRow(o));
      });
    } else if (child instanceof HTMLOptionElement) {
      rows.push(toRow(child));
    }
  });
  return rows;
}

/** @param {HTMLOptionElement} o */
function toRow(o) {
  return {
    kind: /** @type {const} */ ("option"),
    label: o.textContent ?? "",
    value: o.value,
    disabled: o.disabled,
    selected: o.selected,
    index: o.index,
  };
}

/**
 * Line the overlay's text up with where the native control puts its own.
 *
 * Padding is the one box property that differs per surface — the modal, the
 * panel toolbar and a data-table cell all pad a select differently — and the
 * only one that never changes with the theme, so reading it once is safe
 * where reading colours would go stale on a theme switch.
 *
 * @param {HTMLElement} from @param {HTMLElement} to
 */
function copyPadding(from, to) {
  const cs = getComputedStyle(from);
  to.style.paddingTop = cs.paddingTop;
  to.style.paddingBottom = cs.paddingBottom;
  to.style.paddingLeft = cs.paddingLeft;
  to.style.paddingRight = cs.paddingRight;
}

/**
 * The `[data-index]` row an event landed on, typed so `.dataset` is reachable.
 * @param {EventTarget | null} target
 * @returns {HTMLElement | null}
 */
function rowElementFrom(target) {
  if (!(target instanceof Element)) return null;
  const el = target.closest("[data-index]");
  return el instanceof HTMLElement ? el : null;
}

/**
 * Give one <select> the app's dropdown. Idempotent.
 * @param {HTMLSelectElement} native
 */
export function enhanceSelect(native) {
  if (!(native instanceof HTMLSelectElement)) return;
  if (native.dataset.smpEnhanced) return;
  if (native.multiple || native.size > 1) return; // not this component's job
  native.dataset.smpEnhanced = "true";

  const id = native.id || `smp-select-${++uid}`;
  const triggerId = `${id}-trigger`;
  const listId = `${id}-listbox`;

  const wrap = document.createElement("div");
  wrap.className = "smp-select";
  native.parentNode?.insertBefore(wrap, native);
  wrap.appendChild(native);
  native.classList.add("smp-select__native");
  // Hidden from assistive tech so there is exactly ONE accessible control:
  // the trigger. The element itself stays for data, forms and tests.
  native.setAttribute("aria-hidden", "true");
  native.tabIndex = -1;

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.id = triggerId;
  trigger.className = "smp-select__trigger";
  trigger.setAttribute("role", "combobox");
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-controls", listId);
  const valueEl = document.createElement("span");
  valueEl.className = "smp-select__value";
  trigger.appendChild(valueEl);
  wrap.appendChild(trigger);
  copyPadding(native, trigger);

  // The <label for> pointed at the native select, which is now hidden from
  // AT — move it to the trigger so the accessible name survives and clicking
  // the label still focuses the control.
  const label =
    (native.id &&
      document.querySelector(`label[for="${CSS.escape(native.id)}"]`)) ||
    native.closest("label");
  if (label instanceof HTMLLabelElement) {
    if (!label.id) label.id = `${id}-label`;
    label.htmlFor = triggerId;
    trigger.setAttribute("aria-labelledby", label.id);
  }

  const listbox = document.createElement("ul");
  listbox.className = "smp-select__listbox";
  listbox.id = listId;
  listbox.setAttribute("role", "listbox");
  listbox.hidden = true;

  let rows = [];
  let activeIndex = -1;
  let detach = null;
  let typeahead = "";
  let typeaheadTimer = 0;

  const isOpen = () => !listbox.hidden;

  function syncTrigger() {
    const selected = native.selectedOptions[0];
    valueEl.textContent = selected?.textContent?.trim() || "";
    // The placeholder option carries an empty value; grey it like one.
    trigger.classList.toggle("is-placeholder", !native.value);
    trigger.disabled = native.disabled;
    if (native.required) trigger.setAttribute("aria-required", "true");
    else trigger.removeAttribute("aria-required");
  }

  function renderList() {
    rows = readOptions(native);
    listbox.innerHTML = "";
    rows.forEach((row, i) => {
      const li = document.createElement("li");
      if (row.kind === "group") {
        li.className = "smp-select__group";
        li.setAttribute("role", "presentation");
        li.textContent = row.label;
      } else {
        li.className = "smp-select__option";
        li.id = `${listId}-opt-${i}`;
        li.setAttribute("role", "option");
        li.setAttribute("aria-selected", String(!!row.selected));
        if (row.disabled) li.setAttribute("aria-disabled", "true");
        li.textContent = row.label;
        li.dataset.index = String(i);
      }
      listbox.appendChild(li);
    });
  }

  function setActive(i, { scroll = true } = {}) {
    if (i < 0 || i >= rows.length) return;
    activeIndex = i;
    listbox
      .querySelectorAll(".is-active")
      .forEach((el) => el.classList.remove("is-active"));
    const el = listbox.querySelector(`[data-index="${i}"]`);
    if (!el) return;
    el.classList.add("is-active");
    trigger.setAttribute("aria-activedescendant", el.id);
    if (scroll) el.scrollIntoView({ block: "nearest" });
  }

  /** @param {1|-1} dir @param {number} step */
  function move(dir, step = 1) {
    let i = activeIndex;
    for (let n = 0; n < step; n++) {
      let next = i;
      do {
        next += dir;
        if (next < 0 || next >= rows.length) {
          next = i;
          break;
        }
      } while (rows[next].kind !== "option" || rows[next].disabled);
      if (next === i) break;
      i = next;
    }
    setActive(i);
  }

  function edge(which) {
    const idx =
      which === "first"
        ? rows.findIndex((r) => r.kind === "option" && !r.disabled)
        : rows.length -
          1 -
          [...rows]
            .reverse()
            .findIndex((r) => r.kind === "option" && !r.disabled);
    if (idx >= 0 && idx < rows.length) setActive(idx);
  }

  function open() {
    if (isOpen() || native.disabled || prefersNative()) return;
    renderList();
    detach = showPopover(listbox, trigger, close);
    trigger.setAttribute("aria-expanded", "true");
    const sel = rows.findIndex((r) => r.kind === "option" && r.selected);
    setActive(
      sel >= 0
        ? sel
        : rows.findIndex((r) => r.kind === "option" && !r.disabled),
    );
  }

  function close({ focus = false } = {}) {
    if (!isOpen()) return;
    detach?.();
    detach = null;
    trigger.setAttribute("aria-expanded", "false");
    trigger.removeAttribute("aria-activedescendant");
    if (focus) trigger.focus();
  }

  /** Commit the active option to the native element and tell the app. */
  function commit(i = activeIndex) {
    const row = rows[i];
    if (!row || row.kind !== "option" || row.disabled) return;
    if (native.value !== row.value) {
      native.value = /** @type {string} */ (row.value);
      // Real events, so existing listeners (labeledSelect's onChange, filter
      // handlers, the modal's dirty tracking) fire exactly as before.
      native.dispatchEvent(new Event("input", { bubbles: true }));
      native.dispatchEvent(new Event("change", { bubbles: true }));
    }
    syncTrigger();
    close({ focus: true });
  }

  trigger.addEventListener("click", () =>
    isOpen() ? close({ focus: true }) : open(),
  );

  trigger.addEventListener("keydown", (e) => {
    if (prefersNative()) return;
    const k = e.key;
    if (!isOpen()) {
      if (k === "ArrowDown" || k === "ArrowUp" || k === "Enter" || k === " ") {
        e.preventDefault();
        open();
        return;
      }
    } else {
      switch (k) {
        case "ArrowDown":
          e.preventDefault();
          move(1);
          return;
        case "ArrowUp":
          e.preventDefault();
          move(-1);
          return;
        case "PageDown":
          e.preventDefault();
          move(1, 10);
          return;
        case "PageUp":
          e.preventDefault();
          move(-1, 10);
          return;
        case "Home":
          e.preventDefault();
          edge("first");
          return;
        case "End":
          e.preventDefault();
          edge("last");
          return;
        case "Enter":
        case " ":
          e.preventDefault();
          commit();
          return;
        case "Escape":
          e.preventDefault();
          close({ focus: true });
          return;
        case "Tab":
          commit();
          return; // Tab commits, like a native select
        default:
          break;
      }
    }
    // Typeahead: printable, unmodified characters only, so shortcuts survive.
    if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      if (!isOpen()) open();
      typeahead += k;
      clearTimeout(typeaheadTimer);
      typeaheadTimer = window.setTimeout(() => (typeahead = ""), 700);
      const hit = resolveTypeahead(rows, typeahead, activeIndex);
      if (hit >= 0) setActive(hit);
    }
  });

  listbox.addEventListener("click", (e) => {
    const li = rowElementFrom(e.target);
    if (li) commit(Number(li.dataset.index));
  });
  // Pointer highlight tracks the keyboard's notion of "active" so the two
  // never disagree about what Enter would pick.
  listbox.addEventListener("pointermove", (e) => {
    const li = rowElementFrom(e.target);
    if (li) setActive(Number(li.dataset.index), { scroll: false });
  });

  // The native element is still the source of truth, so anything that changes
  // it from outside — app code, page.selectOption() — has to be reflected.
  native.addEventListener("change", syncTrigger);
  // Options are frequently rebuilt (year switches, dependent dropdowns).
  new MutationObserver(() => {
    syncTrigger();
    if (isOpen()) renderList();
  }).observe(native, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["disabled", "required"],
  });

  syncTrigger();
}
