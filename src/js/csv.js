// ─────────────────────────────────────────────────────────────────
//  csv.js — dependency-free CSV/TSV parsing for the roster import, and
//  the serializer behind the console's exports.
//
//  Handles quoted fields (commas/newlines inside quotes), escaped
//  quotes ("" → "), CRLF or LF line endings, and auto-detects the
//  delimiter (comma, semicolon or tab — the three a spreadsheet export
//  produces). Returns the header row plus data rows as objects keyed by
//  header, so the import UI can map columns by name.
// ─────────────────────────────────────────────────────────────────

/**
 * Guess the delimiter from the first line by counting candidates
 * outside quotes. Comma wins ties.
 * @param {string} text
 * @returns {string}
 */
export function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const candidates = [",", ";", "\t"];
  let best = ",";
  let bestCount = -1;
  for (const d of candidates) {
    let count = 0;
    let inQuotes = false;
    for (const ch of firstLine) {
      if (ch === '"') inQuotes = !inQuotes;
      else if (ch === d && !inQuotes) count++;
    }
    if (count > bestCount) {
      bestCount = count;
      best = d;
    }
  }
  return best;
}

/**
 * Parse delimited text into a matrix of string cells.
 * @param {string} text
 * @param {string} [delimiter] defaults to auto-detected
 * @returns {string[][]}
 */
export function parseRows(text, delimiter = detectDelimiter(text)) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  const src = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  // Flush the trailing field/row unless the input ended on a newline.
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// The apostrophes toCsv puts before a formula character come off again, so an
// exported file imports back unchanged.
const GUARDED_FORMULA = /(^|[,;\r\n][\s"]*)'(?=[=+\-@])/g;

/**
 * Parse into { headers, rows } where each row is an object keyed by the
 * trimmed header. Fully blank lines are dropped.
 * @param {string} text
 * @returns {{ headers: string[], rows: Record<string, string>[] }}
 */
export function parseCsv(text) {
  const matrix = parseRows(text).filter(
    (r) => !(r.length === 1 && r[0].trim() === ""),
  );
  if (!matrix.length) return { headers: [], rows: [] };

  const headers = matrix[0].map((h) => h.trim());
  const rows = matrix.slice(1).map((cells) => {
    /** @type {Record<string, string>} */
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = (cells[i] ?? "").trim().replace(GUARDED_FORMULA, "$1");
    });
    return obj;
  });
  return { headers, rows };
}

/**
 * Best-effort auto-mapping of source headers to a set of target field
 * keys, using per-field alias lists (case/space/accent-insensitive).
 * @param {string[]} headers
 * @param {Record<string, string[]>} aliases target key → accepted header aliases
 * @returns {Record<string, string>} target key → matched header ("" if none)
 */
export function autoMap(headers, aliases) {
  const norm = (/** @type {string} */ s) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]/g, "");
  const normHeaders = headers.map((h) => ({ raw: h, key: norm(h) }));
  /** @type {Record<string, string>} */
  const mapping = {};
  for (const [target, names] of Object.entries(aliases)) {
    const wanted = names.map(norm);
    const hit = normHeaders.find((h) => wanted.includes(h.key));
    mapping[target] = hit ? hit.raw : "";
  }
  return mapping;
}

// A spreadsheet runs a cell that starts with one of these as a formula, so
// exported text that does is prefixed with an apostrophe (CSV injection).
// Excel splits a .csv on the reader's list separator, a comma or a semicolon,
// so one of these after either inside a field would start a cell of its own.
const FORMULA_START = /^[=+\-@\t\r]/;
const FORMULA_AFTER_SEPARATOR = /([,;\r\n][\s"]*)([=+\-@])/g;

/** @param {Date} date */
function isoDate(date) {
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

/**
 * One cell as CSV text. Numbers stay numbers; text that a spreadsheet would
 * read as a formula is neutralised; anything holding the delimiter, a quote
 * or a line break is quoted.
 * @param {unknown} value
 * @param {string} delimiter
 */
function csvCell(value, delimiter) {
  if (value == null) return "";
  if (typeof value === "number")
    return Number.isFinite(value) ? String(value) : "";
  if (value instanceof Date) return isoDate(value);
  let text = String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  text = text.replace(FORMULA_AFTER_SEPARATOR, "$1'$2");
  return /["\r\n]/.test(text) || text.includes(delimiter)
    ? `"${text.replace(/"/g, '""')}"`
    : text;
}

/**
 * Serialize rows to CSV, with a UTF-8 byte-order mark so Excel reads
 * accented names correctly.
 * @param {Array<Array<unknown>>} rows the header row first
 * @param {{ delimiter?: string, bom?: boolean }} [opts]
 * @returns {string}
 */
export function toCsv(rows, { delimiter = ",", bom = true } = {}) {
  const body = rows
    .map((row) => row.map((cell) => csvCell(cell, delimiter)).join(delimiter))
    .join("\r\n");
  return (bom ? "\uFEFF" : "") + body + "\r\n";
}
