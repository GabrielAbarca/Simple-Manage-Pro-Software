// ─────────────────────────────────────────────────────────────────
//  typeahead.js — type-to-jump resolution for the custom select.
//
//  DOM-free so it can be unit-tested (see dateUtils.js for why).
// ─────────────────────────────────────────────────────────────────

/**
 * Resolve a typeahead buffer to an option index.
 *
 * Exported for unit testing, and deliberately pure. Two behaviours matter
 * and are easy to get wrong: repeating the SAME character cycles through
 * the options starting with it (how native selects behave, and how users
 * expect to reach the third "Math…"), while a longer buffer matches a
 * prefix. Search wraps from the current position so repeated presses walk
 * forward rather than sticking on the first match.
 *
 * @param {Array<{ kind: string, label: string, disabled?: boolean }>} rows
 * @param {string} buffer characters typed within the timeout
 * @param {number} from index to start searching after
 * @returns {number} matching row index, or -1
 */
export function resolveTypeahead(rows, buffer, from) {
  if (!buffer) return -1;
  const q = buffer.toLowerCase();
  const allSame = [...q].every((c) => c === q[0]);
  const needle = allSame ? q[0] : q;
  const n = rows.length;
  // Same-character cycling advances; a real prefix re-searches from where we
  // are so refining the buffer does not jump backwards.
  const start = allSame ? from + 1 : from;
  for (let i = 0; i < n; i++) {
    const idx = (start + i + n) % n;
    const row = rows[idx];
    if (row.kind !== "option" || row.disabled) continue;
    if (row.label.trim().toLowerCase().startsWith(needle)) return idx;
  }
  return -1;
}
