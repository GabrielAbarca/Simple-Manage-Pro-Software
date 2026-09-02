// ─────────────────────────────────────────────────────────────────
//  teacherSettings.js — read-only Settings view for the teacher context.
//  Named to avoid colliding with the shared settings.js renderer, same as
//  views/settingsView.js does for the student portal.
// ─────────────────────────────────────────────────────────────────
import { t } from "../i18n.js";
import { db } from "../teacherData/index.js";
import { state } from "../teacherState.js";
import { renderSettings } from "../settings.js";
import { formatDate } from "../teacherFormat.js";

// Read-only Settings for the teacher context. Resolves the demo teacher record
// and builds the normalized adapter consumed by the shared renderer.
export async function loadSettings() {
  const root = document.getElementById("settings-root");
  if (!root) return;

  let teacher;
  try {
    teacher = await db.fetchTeacherFull(state.teacherId);
  } catch (err) {
    console.error("loadSettings:", err);
    state.loaded.settings = false; // allow a retry on next visit
    root.innerHTML = `<div class="loading-cell">${t("common.couldNotLoadProfile")}</div>`;
    return;
  }

  if (!teacher) {
    // No teachers row for this account — the shared renderer needs one, so
    // explain rather than dereferencing a null record.
    root.innerHTML = `<div class="loading-cell">${t("admin.today.noTeacherRecordBody")}</div>`;
    return;
  }

  const tr = teacher;
  const statusLabel = (v) => (v ? t(`enums.studentStatus.${v}`) : null);

  const adapter = {
    context: "teacher",
    identity: {
      displayName: `${tr.first_name} ${tr.last_name}`,
      subtitle: `${t("settings.roleTeacher")}${tr.specialization ? " · " + tr.specialization : ""}`,
      avatarIcon: "co_present",
      roleBadge: {
        text: t("settings.roleTeacher"),
        className: "badge-primary",
      },
    },
    personal: [
      {
        label: t("settings.fields.firstName"),
        value: tr.first_name,
        icon: "badge",
      },
      {
        label: t("settings.fields.lastName"),
        value: tr.last_name,
        icon: "badge",
      },
      {
        label: t("settings.fields.nationalId"),
        value: tr.national_id,
        icon: "fingerprint",
      },
      {
        label: t("settings.fields.specialization"),
        value: tr.specialization,
        icon: "menu_book",
      },
      { label: t("settings.fields.email"), value: tr.email, icon: "mail" },
      { label: t("settings.fields.phone"), value: tr.phone, icon: "call" },
      { label: t("settings.fields.address"), value: tr.address, icon: "home" },
      {
        label: t("settings.fields.hireDate"),
        value: tr.hire_date ? formatDate(tr.hire_date) : null,
        icon: "event",
      },
      {
        label: t("settings.fields.status"),
        value: statusLabel(tr.status),
        icon: "info",
      },
    ],
    username: tr.email,
    email: tr.email,
  };

  renderSettings(root, adapter);
}
