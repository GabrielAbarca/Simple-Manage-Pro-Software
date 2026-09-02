// ─────────────────────────────────────────────────────────────────
//  messages.js — shared error phrasing for the import descriptors.
// ─────────────────────────────────────────────────────────────────
import { t } from "../../../i18n.js";

/** "X is required" for a field named by its own translation key. */
export const REQ = (key) => t("console.import.errRequired", { field: t(key) });
