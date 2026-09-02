// ─────────────────────────────────────────────────────────────────
//  data.js — the admin console's data layer handle.
//
//  Demo sandbox: writes land in an in-memory session overlay instead of
//  the shared backend; reads stay live with the overlay applied. A
//  refresh restores pristine data. The first write shows a one-time
//  notice.
// ─────────────────────────────────────────────────────────────────
import { DEMO_MODE } from "../demoMode.js";
import { supabaseGateway, createAdminData } from "../adminData.js";
import { createDemoGateway } from "../adminDemoDb.js";
import { t } from "../i18n.js";
import { showToast } from "./ui/feedback.js";

let demoNoticeShown = false;

const gateway = DEMO_MODE
  ? createDemoGateway(supabaseGateway, {
      onWrite: () => {
        if (demoNoticeShown) return;
        demoNoticeShown = true;
        showToast(t("admin.demo.sandboxNotice"));
      },
    })
  : supabaseGateway;

export const data = createAdminData(gateway);
