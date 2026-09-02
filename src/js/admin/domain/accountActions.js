// ─────────────────────────────────────────────────────────────────
//  accountActions.js — the per-record login button shared by the
//  teachers and students tables. Split out of admin.js.
//
//  Real mode goes through the admin-users Edge Function; demo mode
//  simulates and never mints a user. A record with a linked auth user
//  shows "reset password"; otherwise "create login". `reload`
//  re-renders the owning screen afterward.
// ─────────────────────────────────────────────────────────────────
import { t } from "../../i18n.js";
import * as v from "../../validate.js";
import {
  createAccount,
  resetPassword,
  generateTempPassword,
} from "../../accounts.js";
import { data } from "../data.js";
import { showToast, openConfirm } from "../ui/feedback.js";
import { iconBtn } from "../ui/tables.js";
import { openModal } from "../ui/modal.js";

/**
 * @param {any} record the teachers/students row the login belongs to
 * @param {"teacher" | "student"} kind
 * @param {() => any} reload re-renders the owning screen after a write
 */
export function accountBtn(record, kind, reload) {
  if (record.auth_user_id) {
    return iconBtn("lock_reset", t("console.accounts.reset"), () =>
      openConfirm(
        t("console.accounts.confirmReset", { email: record.email ?? "" }),
        async () => {
          const res = await resetPassword(record.email);
          showToast(
            res?.simulated
              ? t("console.accounts.resetDemo")
              : t("console.accounts.resetSent"),
          );
        },
      ),
    );
  }
  return iconBtn("person_add", t("console.accounts.create"), () =>
    openCreateAccount(record, kind, reload),
  );
}

export function openCreateAccount(record, kind, reload) {
  const name = `${record.first_name} ${record.last_name}`.trim();
  openModal({
    title: t("console.accounts.createTitle", { name }),
    submitLabel: t("console.accounts.create"),
    fields: [
      {
        name: "email",
        label: t("console.accounts.email"),
        type: "email",
        value: record.email ?? "",
        required: true,
        rules: [v.email()],
      },
      {
        name: "password",
        label: t("console.accounts.tempPassword"),
        value: generateTempPassword(),
        required: true,
        help: t("console.accounts.tempPasswordHelp"),
        rules: [v.password()],
      },
    ],
    onSubmit: async (values) => {
      const res = await createAccount({
        email: values.email.trim(),
        password: values.password,
        role: kind,
        name,
        linkType: kind,
        linkId: record.id,
      });
      // Demo mode never mints a real user; reflect the link locally so the
      // row flips to "reset password" (discarded on refresh, like all demo
      // writes). Real mode already linked server-side; the reload re-fetches.
      if (res?.simulated) {
        const patch = { auth_user_id: `demo-${kind}-${record.id}` };
        if (kind === "teacher") await data.updateTeacher(record.id, patch);
        else await data.updateStudent(record.id, patch);
      }
      showToast(
        res?.simulated
          ? t("console.accounts.createdDemo")
          : t("console.accounts.created"),
      );
      reload();
    },
  });
}
