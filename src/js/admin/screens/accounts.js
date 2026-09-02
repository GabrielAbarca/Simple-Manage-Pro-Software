// ─────────────────────────────────────────────────────────────────
//  accounts.js — login management. Split out of admin.js.
//
//  The one place every login is visible, across all three roles.
//  Teacher and student logins are still created from their own tables
//  (accountBtn there); this screen enumerates existing accounts, adds
//  admin logins (creatable nowhere else), and enables/disables sign-in.
//  In demo mode listAccounts is a simulated fixture, so writes are
//  reflected locally like every other demo change instead of
//  re-fetched.
// ─────────────────────────────────────────────────────────────────
import { t } from "../../i18n.js";
import * as v from "../../validate.js";
import {
  createAccount,
  resetPassword,
  setAccountActive,
  listAccounts,
  generateTempPassword,
} from "../../accounts.js";
import { state } from "../state.js";
import { escapeHtml } from "../ui/format.js";
import { showToast, openConfirm } from "../ui/feedback.js";
import { openModal } from "../ui/modal.js";
import {
  renderMessageRow,
  renderEmptyRow,
  renderErrorRow,
  iconBtn,
  markSaved,
  applySavedFlash,
  tableRow,
} from "../ui/tables.js";

const ACCOUNTS_COLS = 5;

export async function loadAccounts() {
  renderMessageRow("accounts-body", ACCOUNTS_COLS, t("common.loading"));
  try {
    const res = await listAccounts();
    state.accounts = res?.accounts ?? [];
    renderAccounts(state.accounts);
  } catch (err) {
    console.error("loadAccounts:", err);
    renderErrorRow("accounts-body", ACCOUNTS_COLS, loadAccounts);
  }
}

/**
 * After an account write: re-fetch in real mode; in demo mode (where the list
 * is a fixture, not a live overlay) apply the change to state.accounts and
 * re-render so the screen reflects it.
 * @param {any} res the write result
 * @param {string|null} flashId row to outline, if any
 * @param {() => void} mutate adjusts state.accounts in place (demo only)
 */
function afterAccountWrite(res, flashId, mutate) {
  if (flashId != null) markSaved("accounts-body", flashId);
  if (res?.simulated) {
    mutate();
    renderAccounts(state.accounts);
  } else {
    loadAccounts();
  }
}

function resetAction(acc) {
  return iconBtn("lock_reset", t("console.accounts.reset"), () =>
    openConfirm(
      t("console.accounts.confirmReset", { email: acc.email ?? "" }),
      async () => {
        const res = await resetPassword(acc.email);
        showToast(
          res?.simulated
            ? t("console.accounts.resetDemo")
            : t("console.accounts.resetSent"),
        );
      },
      { danger: false, confirmLabel: t("console.accounts.reset") },
    ),
  );
}

// The two directions differ only in wording and a boolean, but the keys stay
// spelled out rather than interpolated so every translation key in this file
// is still greppable.
const ACTIVATE = {
  icon: "check_circle",
  label: "console.accounts.activate",
  confirm: "console.accounts.confirmActivate",
  done: "console.accounts.activated",
  doneDemo: "console.accounts.activatedDemo",
};
const DEACTIVATE = {
  icon: "block",
  label: "console.accounts.deactivate",
  confirm: "console.accounts.confirmDeactivate",
  done: "console.accounts.deactivated",
  doneDemo: "console.accounts.deactivatedDemo",
};

/** Flip one account's sign-in on or off, confirming first either way. */
function toggleAction(acc) {
  const activating = Boolean(acc.banned);
  const copy = activating ? ACTIVATE : DEACTIVATE;

  const run = async () => {
    const res = await setAccountActive(acc.id, activating);
    showToast(t(res?.simulated ? copy.doneDemo : copy.done));
    afterAccountWrite(res, acc.id, () => {
      const a = state.accounts.find((x) => x.id === acc.id);
      if (a) a.banned = !activating;
    });
  };

  return iconBtn(
    copy.icon,
    t(copy.label),
    () =>
      openConfirm(t(copy.confirm, { email: acc.email ?? "" }), run, {
        danger: !activating,
        confirmLabel: t(copy.label),
      }),
    !activating,
  );
}

function renderAccounts(list) {
  const tbody = document.getElementById("accounts-body");
  if (!tbody) return;
  tbody.innerHTML = "";
  if (!list.length) {
    renderEmptyRow("accounts-body", ACCOUNTS_COLS, t("console.accounts.empty"));
    return;
  }
  list.forEach((acc) => {
    const roleBadge = `<span class="badge badge-neutral">${escapeHtml(t(`console.accounts.roles.${acc.role}`))}</span>`;
    const statusBadge = acc.banned
      ? `<span class="badge badge-neutral">${escapeHtml(t("console.accounts.statusInactive"))}</span>`
      : `<span class="badge badge-success">${escapeHtml(t("console.accounts.statusActive"))}</span>`;

    tbody.appendChild(
      tableRow(
        [
          escapeHtml(acc.name || "—"),
          escapeHtml(acc.email || "—"),
          roleBadge,
          statusBadge,
        ],
        [resetAction(acc), toggleAction(acc)],
        acc.id,
      ),
    );
  });
  applySavedFlash("accounts-body");
}

/** Create a standalone admin login — not linked to a teacher/student record. */
export function openCreateAdmin() {
  openModal({
    title: t("console.accounts.createAdminTitle"),
    submitLabel: t("console.accounts.createAdmin"),
    fields: [
      {
        name: "name",
        maxLength: 150,
        label: t("console.accounts.name"),
        required: true,
      },
      {
        name: "email",
        maxLength: 150,
        label: t("console.accounts.email"),
        type: "email",
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
      const email = values.email.trim();
      const name = values.name.trim();
      const res = await createAccount({
        email,
        password: values.password,
        role: "admin",
        name,
      });
      showToast(
        res?.simulated
          ? t("console.accounts.createdDemo")
          : t("console.accounts.created"),
      );
      const demoId = `demo-admin-${email}`;
      afterAccountWrite(res, demoId, () => {
        state.accounts.push({
          id: demoId,
          email,
          name,
          role: "admin",
          banned: false,
        });
      });
    },
  });
}

document
  .getElementById("btn-add-admin")
  ?.addEventListener("click", () => openCreateAdmin());
