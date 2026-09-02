// ─────────────────────────────────────────────────────────────────
//  rows.js — turn the wizard's current mapping into normalized DB
//  payloads plus a validation report. Split out of admin.js.
//
//  Nothing here touches the DOM or writes: it answers "what would be
//  imported, and which lines would be skipped and why", which is
//  exactly what the preview step shows before anything is committed.
// ─────────────────────────────────────────────────────────────────
import { t } from "../../i18n.js";

/**
 * @param {any} ctx the wizard's live context (descriptor, parsed rows, mapping)
 * @returns {{ valid: any[], errors: Array<{ line: number, reason: string }> }}
 */
export function buildImportRows(ctx) {
  const d = ctx.descriptor;
  const { rows } = ctx.parsed;
  const map = ctx.mapping;
  const rowGet = (row) => (key) =>
    map[key] ? (row[map[key]] ?? "").trim() : "";
  const resolveCtx = { ...ctx.ctx };
  if (d.targetSection)
    resolveCtx.targetSection = ctx.targetSection
      ? Number(ctx.targetSection)
      : null;

  const uniqueFields = d.uniqueFields ?? [];
  const existingSets = {};
  const seen = {};
  uniqueFields.forEach((uf) => {
    existingSets[uf] = new Set(
      (d.existing?.() ?? [])
        .map((r) => r[uf])
        .filter((v) => v != null && v !== "")
        .map(String),
    );
    seen[uf] = new Set();
  });
  const existingKeys = d.existingKeys ? d.existingKeys() : null;
  const seenKeys = new Set();

  const valid = [];
  const errors = [];

  rows.forEach((row, i) => {
    const line = i + 2; // 1-based + header row
    const res = d.resolve(rowGet(row), resolveCtx);
    if (res.error) {
      errors.push({ line, reason: res.error });
      return;
    }
    const p = res.payload;

    if (d.autogen) fillAutogen(d, p, existingSets, seen, valid.length);

    const dup = findDuplicateField(d, p, uniqueFields, existingSets, seen);
    if (dup) {
      errors.push({ line, reason: dup });
      return;
    }

    // Composite uniqueness (e.g., grade+section).
    if (existingKeys) {
      const k = d.dedupKey(p);
      if (existingKeys.has(k) || seenKeys.has(k)) {
        errors.push({ line, reason: t(d.dupErrorKey) });
        return;
      }
      seenKeys.add(k);
    }

    uniqueFields.forEach((uf) => {
      if (p[uf] != null && p[uf] !== "") seen[uf].add(String(p[uf]));
    });
    valid.push(p);
  });
  return { valid, errors };
}

/** Auto-generate a value where the source left a unique field blank. */
function fillAutogen(d, payload, existingSets, seen, index) {
  const f = d.autogen.field;
  if (payload[f] != null && payload[f] !== "") return;
  let value;
  do {
    value = d.autogen.make(index);
  } while (existingSets[f]?.has(String(value)) || seen[f]?.has(String(value)));
  payload[f] = value;
}

/**
 * The first per-field uniqueness clash, phrased for the skipped-rows list.
 * @returns {string | null} null when the row is clear
 */
function findDuplicateField(d, payload, uniqueFields, existingSets, seen) {
  for (const uf of uniqueFields) {
    const value = payload[uf];
    if (value == null || value === "") continue;
    if (existingSets[uf].has(String(value)) || seen[uf].has(String(value))) {
      const label = d.fields.find((f) => f.key === uf)?.labelKey;
      return t("console.import.errDuplicate", {
        field: label ? t(label) : uf,
        value,
      });
    }
  }
  return null;
}
