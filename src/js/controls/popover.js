// ─────────────────────────────────────────────────────────────────
//  popover.js — the anchored transient surface both custom controls
//  hang off (the select's listbox, the date picker's calendar).
//
//  Two constraints shape this.
//
//  1. It cannot live next to its trigger. Both controls appear inside
//     the shared modal, and `.modal` is `overflow-y: auto` — an
//     absolutely positioned child gets clipped at the modal's edge, so
//     a listbox on the last field of a form would be cut in half. The
//     surface is therefore rendered into a body-level root and
//     positioned with `position: fixed` from the trigger's rect.
//
//  2. It is NOT a dialog. It must not trap focus and must not make the
//     page inert — a listbox is part of the form behind it, not a layer
//     over it. What it does need is first refusal on Escape, which it
//     gets by registering a guard with dialog.js.
// ─────────────────────────────────────────────────────────────────

import { registerEscapeGuard } from "../dialog.js";

/** Gap between the trigger and the surface, and the margin kept off-screen. */
const OFFSET = 4;
const VIEWPORT_MARGIN = 8;

/** @type {HTMLElement | null} */
let root = null;

/** @type {Set<{ el: HTMLElement, anchor: HTMLElement, close: () => void }>} */
const open = new Set();

/**
 * The body-level container every popover renders into.
 *
 * `dialog.js` skips `.smp-popover-root` when it inerts the background, so a
 * popover opened from inside a modal stays interactive. Do not rename the
 * class without updating that skip list.
 */
export function popoverRoot() {
  if (root && document.body.contains(root)) return root;
  root = document.createElement("div");
  root.className = "smp-popover-root";
  document.body.appendChild(root);
  return root;
}

/** True while any popover is showing. */
export function isAnyPopoverOpen() {
  return open.size > 0;
}

/** Close every open popover — used when focus leaves the app, or on resize. */
export function closeAllPopovers() {
  [...open].forEach((entry) => entry.close());
}

/**
 * Place `el` under `anchor`, flipping above when there is not enough room
 * below.
 *
 * `matchWidth` is opt-in because the two surfaces want opposite things: a
 * listbox should span its trigger so the options line up under the value it
 * replaces, while a calendar has its own natural width and stretching it to a
 * wide field just scatters the day cells.
 *
 * @param {HTMLElement} el
 * @param {HTMLElement} anchor
 * @param {boolean} [matchWidth]
 */
export function positionPopover(el, anchor, matchWidth = true) {
  const a = anchor.getBoundingClientRect();
  // Measure before placing: the surface has to be laid out to know its height.
  if (matchWidth) el.style.minWidth = `${a.width}px`;
  el.style.maxHeight = "";
  const h = el.offsetHeight;

  const below = window.innerHeight - a.bottom - OFFSET - VIEWPORT_MARGIN;
  const above = a.top - OFFSET - VIEWPORT_MARGIN;
  const flip = h > below && above > below;

  // Never taller than the space it has; the surface scrolls internally.
  el.style.maxHeight = `${Math.max(120, flip ? above : below)}px`;

  const top = flip ? a.top - Math.min(h, above) - OFFSET : a.bottom + OFFSET;
  el.style.top = `${Math.round(top)}px`;

  // Keep it on screen horizontally without letting it drift off the anchor.
  const width = el.offsetWidth;
  const maxLeft = window.innerWidth - width - VIEWPORT_MARGIN;
  el.style.left = `${Math.round(Math.min(Math.max(VIEWPORT_MARGIN, a.left), Math.max(VIEWPORT_MARGIN, maxLeft)))}px`;
  el.dataset.placement = flip ? "top" : "bottom";
}

/**
 * Show `el` anchored to `anchor`.
 *
 * The caller owns what the surface contains and what closing means; this owns
 * placement, staying placed, and the two ways every popover must be
 * dismissible (pointer outside, Escape).
 *
 * @param {HTMLElement} el
 * @param {HTMLElement} anchor
 * @param {() => void} close invoked for outside-pointer and Escape
 * @param {{ matchWidth?: boolean }} [opts]
 * @returns {() => void} detach — call from the caller's own close path
 */
export function showPopover(el, anchor, close, opts = {}) {
  const matchWidth = opts.matchWidth !== false;
  popoverRoot().appendChild(el);
  el.hidden = false;
  positionPopover(el, anchor, matchWidth);

  const entry = { el, anchor, close };
  open.add(entry);

  const reposition = () => positionPopover(el, anchor, matchWidth);
  // `true` (capture) so a scroll in ANY ancestor — the modal body, the page —
  // moves the surface with its trigger instead of leaving it stranded.
  window.addEventListener("scroll", reposition, true);
  window.addEventListener("resize", reposition);

  const onPointerDown = (e) => {
    if (el.contains(e.target) || anchor.contains(e.target)) return;
    close();
  };
  // Capture again: a click on some other control should dismiss this before
  // that control acts on it.
  document.addEventListener("pointerdown", onPointerDown, true);

  return () => {
    open.delete(entry);
    window.removeEventListener("scroll", reposition, true);
    window.removeEventListener("resize", reposition);
    document.removeEventListener("pointerdown", onPointerDown, true);
    el.hidden = true;
    if (el.parentElement === root) root.removeChild(el);
  };
}

// Escape belongs to the innermost open thing. Without this, Escape inside a
// modal reaches dialog.js first and closes the whole form.
registerEscapeGuard(isAnyPopoverOpen);

document.addEventListener(
  "keydown",
  (e) => {
    if (e.key !== "Escape" || !open.size) return;
    e.preventDefault();
    e.stopPropagation();
    // Innermost first — popovers do not nest today, but closing the most
    // recently opened is the behaviour that stays correct if they ever do.
    [...open].pop()?.close();
  },
  true,
);
