// ─────────────────────────────────────────────────────────────────
//  controls/index.js — apply the custom controls, everywhere, forever.
//
//  The app builds form controls in a lot of places: openModal() in both
//  consoles (27 selects, 13 date fields between them), labeledSelect()
//  in the schedules toolbar, and several template-string rebuilds like
//  #gradebook-period that replace their markup on every render.
//
//  Enhancing at each call site would mean touching all of them and
//  would silently miss the next one somebody adds. Observing the
//  document instead means every control — present, re-rendered or added
//  later — is enhanced exactly once, and the call sites stay untouched.
//  Same approach dialog.js already takes for overlays.
// ─────────────────────────────────────────────────────────────────

import { enhanceSelect } from "./select.js";
import { enhanceDate } from "./datepicker.js";
import { closeAllPopovers } from "./popover.js";

const SELECTOR =
  'select:not([data-smp-enhanced]), input[type="date"]:not([data-smp-enhanced])';

/** @param {ParentNode} [root] */
export function enhanceAll(root = document) {
  root.querySelectorAll?.(SELECTOR).forEach((el) => {
    if (el instanceof HTMLSelectElement) enhanceSelect(el);
    else if (el instanceof HTMLInputElement) enhanceDate(el);
  });
}

let started = false;

/**
 * Enhance what is on the page now, and anything added afterwards.
 * Safe to call more than once.
 */
export function initControls() {
  if (started) return;
  started = true;

  const run = () => enhanceAll(document);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run, { once: true });
  } else {
    run();
  }

  // Batched via rAF: a modal render inserts a dozen fields in one tick, and
  // enhancing per-mutation would thrash layout while the form is still being
  // assembled.
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      enhanceAll(document);
    });
  }).observe(document.body, { childList: true, subtree: true });

  // A control can be torn out from under an open popover — closing a modal
  // drops the whole form. Leaving the surface behind would strand it on
  // screen with nothing to return to.
  document.addEventListener("smp:view-changed", closeAllPopovers);
  window.addEventListener("pagehide", closeAllPopovers);
}
