// ─────────────────────────────────────────────────────────────────
//  xlsx.js — a dependency-free writer for a one-sheet .xlsx workbook.
//
//  CSV leaves the delimiter and decimal separator to the reader's
//  locale, and Excel set to Spanish (Costa Rica) splits on semicolons,
//  so a comma-separated export opens as one column. A real workbook has
//  no such ambiguity: numbers are stored as numbers and text as text.
//
//  The file is a minimal Office Open XML package, zipped without
//  compression (the "stored" method), which needs nothing beyond a
//  CRC-32.
// ─────────────────────────────────────────────────────────────────

const encoder = new TextEncoder();

/** @type {Uint32Array | null} */
let crcTable = null;

/** @param {Uint8Array} bytes */
export function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const b of bytes) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Escape text for XML, dropping the characters XML 1.0 forbids.
 * @param {string} text
 */
function escapeXml(text) {
  let clean = "";
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code === 0xfffe || code === 0xffff) continue;
    if (code >= 0x20 || code === 0x09 || code === 0x0a || code === 0x0d)
      clean += ch;
  }
  return clean
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Spreadsheet column letters for a zero-based index: 0 → A, 26 → AA. */
export function columnName(index) {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  }
  return name;
}

/** The most characters Excel holds in one cell. */
const CELL_LIMIT = 32767;

/**
 * Cut text to `max` UTF-16 units without splitting a surrogate pair.
 * @param {string} text
 * @param {number} max
 */
function cut(text, max) {
  if (text.length <= max) return text;
  const code = text.charCodeAt(max - 1);
  return text.slice(0, code >= 0xd800 && code <= 0xdbff ? max - 1 : max);
}

/**
 * Cell text as Excel reads it back: within its length limit, and with a
 * literal `_xHHHH_` kept literal rather than decoded as a character escape.
 * @param {string} text
 */
function cellText(text) {
  return escapeXml(cut(text, CELL_LIMIT)).replace(
    /_(x[0-9a-fA-F]{4}_)/g,
    "_x005F_$1",
  );
}

/**
 * Excel's serial day number for a date: days since 1899-12-30, read in UTC
 * like the dates the console stores.
 * @param {Date} date
 */
function serialDay(date) {
  return (date.getTime() - Date.UTC(1899, 11, 30)) / 86400000;
}

/**
 * A sheet name Excel accepts: none of : \ / ? * [ ], no apostrophe at
 * either end, at most 31 characters, never empty, and never "History",
 * which Excel keeps for itself.
 * @param {string} name
 */
export function sheetName(name) {
  const ends = (/** @type {string} */ s) => s.replace(/^['\s]+|['\s]+$/g, "");
  const clean = String(name ?? "")
    .replace(/[\\/?*[\]:]/g, " ")
    .replace(/\s+/g, " ");
  const named = ends(cut(ends(clean), 31)) || "Sheet1";
  return named.toLowerCase() === "history" ? `${named} (1)` : named;
}

/** Style indexes into styles.xml's cellXfs. */
const STYLE = { header: 1, date: 2 };

/**
 * @param {unknown} value
 * @param {string} ref e.g. "B3"
 * @param {boolean} header
 */
function cellXml(value, ref, header) {
  if (value == null || value === "") return "";
  const style = header ? ` s="${STYLE.header}"` : "";
  if (typeof value === "number") {
    return Number.isFinite(value)
      ? `<c r="${ref}"${style}><v>${value}</v></c>`
      : "";
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? ""
      : `<c r="${ref}" s="${STYLE.date}"><v>${serialDay(value)}</v></c>`;
  }
  return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${cellText(String(value))}</t></is></c>`;
}

/**
 * Column widths that fit the longest value in each column, within reason.
 * @param {Array<Array<unknown>>} rows
 */
function colsXml(rows) {
  /** @type {number[]} */
  const widest = [];
  for (const row of rows) {
    row.forEach((value, c) => {
      const length =
        value instanceof Date ? 10 : value == null ? 0 : String(value).length;
      widest[c] = Math.max(widest[c] ?? 0, length);
    });
  }
  if (!widest.length) return "";
  const cols = widest
    .map((length, c) => {
      const width = Math.min(Math.max(length + 2, 8), 60);
      return `<col min="${c + 1}" max="${c + 1}" width="${width}" customWidth="1"/>`;
    })
    .join("");
  return `<cols>${cols}</cols>`;
}

/**
 * @param {Array<Array<unknown>>} rows
 * @param {string} sheetName
 * @returns {Record<string, string>} path → XML
 */
function packageParts(rows, sheetName) {
  const sheetRows = rows
    .map(
      (row, r) =>
        `<row r="${r + 1}">${row
          .map((v, c) => cellXml(v, `${columnName(c)}${r + 1}`, r === 0))
          .join("")}</row>`,
    )
    .join("");
  const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const ns = "http://schemas.openxmlformats.org";
  return {
    "[Content_Types].xml": `${head}<Types xmlns="${ns}/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    "_rels/.rels": `${head}<Relationships xmlns="${ns}/package/2006/relationships"><Relationship Id="rId1" Type="${ns}/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `${head}<workbook xmlns="${ns}/spreadsheetml/2006/main" xmlns:r="${ns}/officeDocument/2006/relationships"><sheets><sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `${head}<Relationships xmlns="${ns}/package/2006/relationships"><Relationship Id="rId1" Type="${ns}/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${ns}/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    "xl/styles.xml": `${head}<styleSheet xmlns="${ns}/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
    "xl/worksheets/sheet1.xml": `${head}<worksheet xmlns="${ns}/spreadsheetml/2006/main">${colsXml(rows)}<sheetData>${sheetRows}</sheetData></worksheet>`,
  };
}

/** 1980-01-01, the earliest date a zip entry can carry. */
const DOS_DATE = 0x0021;

/**
 * Zip files with the "stored" method.
 * @param {Record<string, Uint8Array>} files path → bytes
 * @returns {Uint8Array<ArrayBuffer>}
 */
export function zipStored(files) {
  /** @type {Uint8Array[]} */
  const chunks = [];
  /** @type {Uint8Array[]} */
  const central = [];
  let offset = 0;
  for (const [path, data] of Object.entries(files)) {
    const name = encoder.encode(path);
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);
    local.setUint16(12, DOS_DATE, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    chunks.push(new Uint8Array(local.buffer), name, data);

    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 20, true);
    entry.setUint16(8, 0x0800, true);
    entry.setUint16(14, DOS_DATE, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, data.length, true);
    entry.setUint32(24, data.length, true);
    entry.setUint16(28, name.length, true);
    entry.setUint32(42, offset, true);
    central.push(new Uint8Array(entry.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const centralSize = central.reduce((n, c) => n + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, Object.keys(files).length, true);
  end.setUint16(10, Object.keys(files).length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);

  const all = [...chunks, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of all) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/**
 * A one-sheet workbook with the first row in bold. A `Date` cell is written
 * as a date in the reader's short date format.
 * @param {Array<Array<unknown>>} rows the header row first
 * @param {{ sheetName?: string }} [opts]
 * @returns {Uint8Array<ArrayBuffer>} the .xlsx file
 */
export function toXlsx(rows, opts = {}) {
  const parts = packageParts(rows, sheetName(opts.sheetName ?? ""));
  /** @type {Record<string, Uint8Array>} */
  const files = {};
  for (const [path, xml] of Object.entries(parts))
    files[path] = encoder.encode(xml);
  return zipStored(files);
}
