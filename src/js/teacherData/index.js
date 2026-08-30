// ─────────────────────────────────────────────────────────────────
//  teacherData/index.js — composes the per-domain query modules into the
//  same `db` shape teacher.js used to expose as an inline object, and
//  applies the demo-mode overlay exactly as before.
// ─────────────────────────────────────────────────────────────────
import { DEMO_MODE } from "../demoMode.js";
import { wrapDbForDemo } from "../demoDb.js";
import { t } from "../i18n.js";
import { showToast } from "../teacherFeedback.js";
import * as identity from "./identity.js";
import * as classes from "./classes.js";
import * as students from "./students.js";
import * as gradebook from "./gradebook.js";
import * as categories from "./categories.js";
import * as attendance from "./attendance.js";
import * as schedule from "./schedule.js";
import * as reference from "./reference.js";

const realDb = {
  ...identity,
  ...classes,
  ...students,
  ...gradebook,
  ...categories,
  ...attendance,
  ...schedule,
  ...reference,
};

// Demo sandbox: writes land in an in-memory session overlay instead of the
// shared backend; reads stay live with the overlay applied (see demoDb.js).
// A refresh restores pristine data. The first write shows a one-time notice.
let demoNoticeShown = false;
export const db = DEMO_MODE
  ? wrapDbForDemo(realDb, {
      onWrite: () => {
        if (demoNoticeShown) return;
        demoNoticeShown = true;
        showToast(t("admin.demo.sandboxNotice"));
      },
    })
  : realDb;
