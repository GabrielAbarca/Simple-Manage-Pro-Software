// ─────────────────────────────────────────────────────────────────
//  tableExport.js — save a table the console is showing as an Excel
//  workbook or a CSV file, built in the browser.
// ─────────────────────────────────────────────────────────────────
import { toCsv } from "./csv.js";
import { toXlsx } from "./xlsx.js";

/** @typedef {"xlsx" | "csv"} ExportFormat */

/** @type {ExportFormat[]} */
export const EXPORT_FORMATS = ["xlsx", "csv"];

/**
 * @param {string} filename
 * @param {BlobPart} content
 * @param {string} type MIME type
 */
function downloadFile(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  // Safari on iPad asks before downloading and reads the file only then.
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/**
 * A stored YYYY-MM-DD date as an export cell, so the workbook holds a real
 * date. Anything else comes back unchanged.
 * @param {string | null | undefined} iso
 * @returns {Date | string | null | undefined}
 */
export function dateCell(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "");
  if (!m) return iso;
  const date = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  const real = date.getUTCMonth() === +m[2] - 1 && date.getUTCDate() === +m[3];
  return real ? date : iso;
}

/**
 * @param {Array<Array<unknown>>} rows the header row first
 * @param {{ filename: string, sheetName: string, format: ExportFormat }} opts
 *   `filename` without its extension
 */
export function exportTable(rows, { filename, sheetName, format }) {
  if (format === "csv") {
    downloadFile(`${filename}.csv`, toCsv(rows), "text/csv;charset=utf-8");
  } else {
    downloadFile(
      `${filename}.xlsx`,
      toXlsx(rows, { sheetName }),
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
  }
}
