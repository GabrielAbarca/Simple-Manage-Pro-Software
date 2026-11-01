import { DEMO_MODE } from "../demoMode.js";
import { supabaseGateway, createAdminData } from "../adminData.js";
import { createDemoGateway } from "../adminDemoDb.js";
import { t } from "../i18n.js";
import { showToast } from "../feedback.js";

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
