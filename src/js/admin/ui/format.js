import { formatDate } from "../../i18n.js";

export function num(v) {
  return v === "" || v == null ? null : Number(v);
}

export function nullable(v) {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
}

export const fmtDate = (value) => (value ? formatDate(value) : "—");

export function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** First day of the month `date` falls in, as a local-time `YYYY-MM-DD`. */
export function monthStartIso(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`;
}
