import { t, formatDate } from "../i18n.js";
import { fetchStudentProfile } from "../supabaseQueries.js";
import { renderSettings } from "../settings.js";
import { state } from "../studentState.js";
import { statusLabel } from "./viewHelpers.js";

// Read-only Settings for the student context. Reuses the dashboard's
// state.profile when available; otherwise fetches it on demand. Builds the
// normalized adapter consumed by the shared renderer in settings.js.
export async function initSettings() {
  if (!state.profile) {
    state.profile = await fetchStudentProfile(state.studentId);
  }

  const root = document.getElementById("settings-root");
  if (!root) return;

  if (!state.profile) {
    root.innerHTML = `<div class="loading-cell">${t("common.couldNotLoadProfile")}</div>`;
    return;
  }

  const s = state.profile;
  const cls = s.classes;
  const classLine = cls
    ? t("student.classLine", {
        grade: cls.grade_levels?.name ?? "—",
        section: cls.display_name ?? "—",
      })
    : null;

  const dateOr = (d) => (d ? formatDate(d) : null);
  const gradeName = cls?.grade_levels?.name;

  const adapter = {
    context: "student",
    identity: {
      displayName: `${s.first_name} ${s.last_name}`,
      subtitle: `${t("settings.roleStudent")}${gradeName ? " · " + gradeName : ""}`,
      avatarIcon: "person",
      roleBadge: {
        text: t("settings.roleStudent"),
        className: "badge-primary",
      },
    },
    personal: [
      {
        label: t("settings.fields.firstName"),
        value: s.first_name,
        icon: "badge",
      },
      {
        label: t("settings.fields.lastName"),
        value: s.last_name,
        icon: "badge",
      },
      {
        label: t("settings.fields.enrollmentNumber"),
        value: s.enrollment_number,
        icon: "tag",
      },
      {
        label: t("settings.fields.nationalId"),
        value: s.national_id,
        icon: "fingerprint",
      },
      {
        label: t("settings.fields.dateOfBirth"),
        value: dateOr(s.date_of_birth),
        icon: "cake",
      },
      {
        label: t("settings.fields.gender"),
        value: genderLabel(s.gender),
        icon: "wc",
      },
      { label: t("settings.fields.class"), value: classLine, icon: "school" },
      { label: t("settings.fields.email"), value: s.email, icon: "mail" },
      { label: t("settings.fields.phone"), value: s.phone, icon: "call" },
      { label: t("settings.fields.address"), value: s.address, icon: "home" },
      {
        label: t("settings.fields.status"),
        value: s.status ? statusLabel(s.status) : null,
        icon: "info",
      },
      {
        label: t("settings.fields.enrolled"),
        value: dateOr(s.enrollment_date),
        icon: "event",
      },
    ],
    username: s.email,
    email: s.email,
  };

  renderSettings(root, adapter);
}

// Gender label from the DB code (M/F/O); unknown codes pass through verbatim.
function genderLabel(g) {
  if (!g) return null;
  const key = String(g).trim().toUpperCase();
  if (key === "M" || key === "F" || key === "O") {
    return t(`enums.gender.${key}`);
  }
  return g;
}
