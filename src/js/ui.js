/** Skeleton rows for a <tbody> while a table loads. */
export function skeletonRows(rows = 4, cols = 4) {
  const cell = '<td><span class="skeleton skeleton-text"></span></td>';
  let out = "";
  for (let r = 0; r < rows; r++) {
    out += `<tr class="skeleton-row">${cell.repeat(cols)}</tr>`;
  }
  return out;
}

/** Skeleton lines for a card / list / panel while it loads. */
export function skeletonBlock(lines = 3) {
  let out = '<div class="skeleton-block">';
  for (let i = 0; i < lines; i++) {
    out += '<span class="skeleton skeleton-line"></span>';
  }
  return out + "</div>";
}

/** Bare skeleton cards — for a parent that is already a card grid. */
export function skeletonCardItems(count = 3) {
  return '<div class="skeleton skeleton-card"></div>'.repeat(count);
}

/** Self-contained skeleton card grid — for a plain (non-grid) container. */
export function skeletonCards(count = 3) {
  return `<div class="skeleton-cards">${skeletonCardItems(count)}</div>`;
}

/**
 * A section that failed to load, with a way to try again.
 *
 * Distinct from the empty states on purpose: "no grades recorded yet" and
 * "we couldn't reach the server" look identical to a user but mean opposite
 * things, and showing the first when the second happened is how a dropped
 * connection turns into a support call about missing grades.
 *
 * The caller wires the button; this only marks it with `data-retry`.
 *
 * @param {string} message what went wrong, already translated
 * @param {string} retryLabel button text, already translated
 */
export function errorState(message, retryLabel) {
  return `
    <div class="load-error" role="alert">
      <p class="load-error-text">${message}</p>
      <button type="button" class="btn-retry" data-retry>${retryLabel}</button>
    </div>`;
}

/**
 * The same block as a full-width table row, for a <tbody>.
 * @param {number} colspan columns in the parent table
 * @param {string} message what went wrong, already translated
 * @param {string} retryLabel button text, already translated
 */
export function errorRow(colspan, message, retryLabel) {
  return `<tr><td colspan="${colspan}">${errorState(message, retryLabel)}</td></tr>`;
}

/** Wire the mobile nav drawer (open, close, scrim, Escape). Returns the closer. */
export function initSidebarToggle() {
  const aside = document.querySelector(".container > aside");
  const open = () => {
    aside.classList.add("active");
    document.body.classList.add("nav-open");
  };
  const close = () => {
    aside.classList.remove("active");
    document.body.classList.remove("nav-open");
  };
  document.getElementById("menu-btn")?.addEventListener("click", open);
  const closeBtn = document.getElementById("close-btn");
  closeBtn?.addEventListener("click", close);
  closeBtn?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      close();
    }
  });
  document.body.addEventListener("click", (e) => {
    if (e.target === document.body) close();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });
  return close;
}
