// ─────────────────────────────────────────────────────────────────
//  settings.js — the Settings screen: the school profile card (the
//  only admin-writable part) above the shared read-only renderer.
//  Split out of admin.js.
// ─────────────────────────────────────────────────────────────────
import { t } from "../../i18n.js";
import { renderSettings } from "../../settings.js";
import { state } from "../state.js";
import { data } from "../data.js";
import { fetchProfile } from "../auth.js";
import { escapeHtml, nullable } from "../ui/format.js";
import { showToast, errorText } from "../ui/feedback.js";
import { renderErrorBlock } from "../ui/tables.js";
import { loadSchoolSettings, applyIdLabels } from "../domain/schoolProfile.js";

/**
 * School profile card: the school's name and what it calls the national-ID
 * field. Rendered here rather than in settings.js because that renderer is
 * shared with the student/teacher portals and is documented as read-only.
 */
async function renderSchoolProfile() {
  const root = document.getElementById("school-profile-root");
  if (!root) return;
  await loadSchoolSettings();

  const unavailable = state.school === null;
  root.innerHTML = `
    <div class="console-panel">
      <div class="panel-head">
        <div>
          <h2>${escapeHtml(t("console.school.title"))}</h2>
          <p class="panel-sub">${escapeHtml(t("console.school.subtitle"))}</p>
        </div>
      </div>
      <div class="modal-body school-profile-form">
        <div class="field-group">
          <label for="school-name">${escapeHtml(t("console.school.name"))}</label>
          <input id="school-name" type="text"
            value="${escapeHtml(state.school?.name ?? "")}"
            placeholder="${escapeHtml(t("console.school.namePlaceholder"))}" />
        </div>
        <div class="field-group">
          <label for="school-id-label">${escapeHtml(t("console.school.idLabel"))}</label>
          <input id="school-id-label" type="text"
            value="${escapeHtml(state.school?.id_label ?? "")}"
            placeholder="${escapeHtml(t("console.teachers.nationalId"))}" />
          <small class="field-help">${escapeHtml(t("console.school.idLabelHelp"))}</small>
        </div>
        ${unavailable ? `<p class="field-help">${escapeHtml(t("console.school.unavailable"))}</p>` : ""}
        <div>
          <button type="button" class="btn btn-primary btn-sm" id="btn-save-school"
            ${unavailable ? "disabled" : ""}>
            ${escapeHtml(t("common.save"))}
          </button>
        </div>
      </div>
    </div>`;

  document
    .getElementById("btn-save-school")
    ?.addEventListener("click", saveSchoolProfile);
}

async function saveSchoolProfile() {
  const readField = (id) =>
    nullable(
      /** @type {HTMLInputElement} */ (document.getElementById(id)).value,
    );
  const patch = {
    name: readField("school-name"),
    id_label: readField("school-id-label"),
  };
  try {
    if (state.school?.id != null) {
      await data.updateSchoolSettings(state.school.id, patch);
      state.school = { ...state.school, ...patch };
    } else {
      state.school = await data.createSchoolSettings({ id: 1, ...patch });
    }
    showToast(t("console.school.saved"));
    // The ID label feeds table headers and both create forms.
    applyIdLabels();
  } catch (err) {
    showToast(errorText(err), "error");
  }
}

export async function loadSettings() {
  await renderSchoolProfile();
  const root = document.getElementById("settings-root");
  if (!root) return;
  let profile = state.profile;
  if (!profile) {
    try {
      profile = await fetchProfile();
      state.profile = profile;
    } catch (err) {
      console.error("loadSettings:", err);
      state.loaded.settings = false;
      renderErrorBlock(root, loadSettings);
      return;
    }
  }
  const email = state.session.user.email ?? "";
  renderSettings(root, {
    context: "admin",
    identity: {
      displayName: profile.name || t("console.profile.admin"),
      subtitle: t("settings.roleAdmin"),
      avatarIcon: "admin_panel_settings",
      roleBadge: { text: t("settings.roleAdmin"), className: "badge-primary" },
    },
    personal: [
      { label: t("settings.fields.name"), value: profile.name, icon: "badge" },
      { label: t("settings.fields.email"), value: email, icon: "mail" },
    ],
    username: email,
    email,
  });
}
