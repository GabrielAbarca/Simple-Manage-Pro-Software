// ─────────────────────────────────────────────────────────────────
//  SETTINGS — one shared, read-only renderer for both contexts.
//
//  index.html (student) and admin.html (teacher) share the SAME
//  structure but feed DIFFERENT data. Rather than duplicate markup,
//  each context resolves its own record, normalizes it into the
//  adapter shape below, and calls renderSettings(rootEl, adapter).
//
//  DEMO SCOPE: display only. Everything in Account & Profile is
//  natively `disabled` (greyed inputs + inert buttons); Preferences is
//  a styled shell (Language stub is a no-op, flagged "Coming soon").
//
//  The one exception is "Change password" in the Login security card,
//  which is live outside demo mode — a signed-in user otherwise has no
//  way to change their own password and has to go through the
//  forgot-password email loop. It routes through auth.updatePassword,
//  which is itself demo-gated, and the button stays disabled in demo so
//  the shared account's public password cannot be moved.
//
//  Adapter shape:
//    {
//      context: "student" | "teacher",
//      identity: {
//        displayName, subtitle, avatarIcon,
//        roleBadge: { text, className }
//      },
//      personal: [ { label, value, icon }, ... ],
//      username,   // account login identity (email)
//      email       // shown in Login security
//    }
// ─────────────────────────────────────────────────────────────────

import { t, getLang, setLang } from "./i18n.js";
import { DEMO_MODE } from "./demoMode.js";
import { updatePassword } from "./auth.js";
import { MIN_PASSWORD_LENGTH } from "./validate.js";

// App version surfaced in "More info". Bump alongside package.json.
const APP_VERSION = "1.0.0";

// Local HTML-escape — values originate from the DB. Mirrors admin.js's escapeHtml.
function esc(value) {
  if (value === null || value === undefined) return "—";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Settings sub-sections — the left rail. `render` builds each panel body.
// `labelKey` resolves through t() at render time (after initI18n).
const SECTIONS = [
  {
    id: "account",
    labelKey: "settings.rail.account",
    icon: "account_circle",
    render: renderAccount,
  },
  {
    id: "preferences",
    labelKey: "settings.rail.preferences",
    icon: "tune",
    render: renderPreferences,
  },
  {
    id: "help",
    labelKey: "settings.rail.help",
    icon: "help",
    render: renderHelp,
  },
  {
    id: "moreinfo",
    labelKey: "settings.rail.moreinfo",
    icon: "info",
    render: renderMoreInfo,
  },
];

/**
 * Render the full Settings UI (left rail + panels) into `rootEl`.
 * Idempotent: a re-render replaces previous content and rebinds events.
 */
export function renderSettings(rootEl, adapter) {
  if (!rootEl) return;

  const rail = SECTIONS.map(
    (s, i) => `
    <button
      type="button"
      class="settings-rail-item${i === 0 ? " active" : ""}"
      data-section="${s.id}"
      role="tab"
      aria-selected="${i === 0 ? "true" : "false"}"
    >
      <span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-${s.icon}"></use></svg></span>
      <span>${t(s.labelKey)}</span>
    </button>`,
  ).join("");

  const panels = SECTIONS.map(
    (s, i) => `
    <section class="settings-panel${i === 0 ? " active" : ""}" id="settings-panel-${s.id}" role="tabpanel">
      ${s.render(adapter)}
    </section>`,
  ).join("");

  rootEl.innerHTML = `
    <div class="settings">
      <nav class="settings-rail" role="tablist" aria-label="${t("settings.rail.label")}">
        ${rail}
      </nav>
      <div class="settings-panels">
        ${panels}
      </div>
    </div>`;

  // Local-only tab switching — no app router, no persistence.
  const items = rootEl.querySelectorAll(".settings-rail-item");
  const sectionPanels = rootEl.querySelectorAll(".settings-panel");
  items.forEach((item) => {
    item.addEventListener("click", () => {
      const id = item.dataset.section;
      items.forEach((b) => {
        const on = b === item;
        b.classList.toggle("active", on);
        b.setAttribute("aria-selected", on ? "true" : "false");
      });
      sectionPanels.forEach((p) =>
        p.classList.toggle("active", p.id === `settings-panel-${id}`),
      );
    });
  });

  // Language switch — persists this view's choice (namespaced per-view) and
  // reloads so the entire view re-renders in the new locale. setLang is a no-op
  // when the clicked language is already active.
  const segments = rootEl.querySelectorAll(".settings-segment");
  segments.forEach((seg) => {
    seg.addEventListener("click", () => setLang(seg.dataset.lang));
  });

  bindChangePassword(rootEl);
}

/**
 * Change-password form. Inert in demo mode (the button ships disabled), so
 * this only has to handle the live case.
 * @param {HTMLElement} rootEl
 */
function bindChangePassword(rootEl) {
  const toggle = rootEl.querySelector("#settings-change-password");
  const form = /** @type {HTMLFormElement | null} */ (
    rootEl.querySelector("#settings-password-form")
  );
  if (!toggle || !form) return;

  const next = /** @type {HTMLInputElement} */ (
    form.querySelector("#settings-new-password")
  );
  const confirm = /** @type {HTMLInputElement} */ (
    form.querySelector("#settings-confirm-password")
  );
  const status = form.querySelector("#settings-password-status");
  const cancel = form.querySelector("#settings-cancel-password");

  const say = (key, tone) => {
    status.textContent = key ? t(key) : "";
    status.classList.toggle("settings-hint-error", tone === "error");
    status.classList.toggle("settings-hint-success", tone === "success");
  };

  const close = () => {
    form.hidden = true;
    form.reset();
    say(null, null);
  };

  toggle.addEventListener("click", () => {
    form.hidden = !form.hidden;
    if (!form.hidden) next.focus();
  });
  cancel?.addEventListener("click", close);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (next.value.length < MIN_PASSWORD_LENGTH) {
      say("settings.account.changePasswordTooShort", "error");
      return;
    }
    if (next.value !== confirm.value) {
      say("settings.account.changePasswordMismatch", "error");
      return;
    }

    const submit = /** @type {HTMLButtonElement} */ (
      form.querySelector('button[type="submit"]')
    );
    submit.disabled = true;
    say("settings.account.changePasswordSaving", null);

    try {
      await updatePassword(next.value);
      form.reset();
      form.hidden = true;
      // The status line lives outside the form, so it survives hiding it.
      say("settings.account.changePasswordSuccess", "success");
    } catch (err) {
      // Supabase refuses a password change on a session that is too old, which
      // is a fixable situation rather than a failure — point at the way out.
      const reauth = /reauth|session|expired/i.test(err?.message ?? "");
      say(
        reauth
          ? "settings.account.changePasswordReauth"
          : "settings.account.changePasswordFailed",
        "error",
      );
      console.error("[SMP] change password failed:", err);
    } finally {
      submit.disabled = false;
    }
  });
}

// ── Account & Profile ────────────────────────────────────────────
function renderAccount(adapter) {
  const id = adapter.identity ?? {};
  const badge = id.roleBadge ?? { text: "", className: "badge-primary" };

  const personalFields = (adapter.personal ?? [])
    .map(
      (f) => `
      <label class="settings-field">
        <span class="settings-field-label">
          ${f.icon ? `<span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-${f.icon}"></use></svg></span>` : ""}
          ${esc(f.label)}
        </span>
        <input type="text" value="${esc(f.value)}" disabled />
      </label>`,
    )
    .join("");

  return `
    <div class="settings-demo-banner" role="note">
      <span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-lock"></use></svg></span>
      <span>${t("settings.account.demoBanner")}</span>
    </div>

    <div class="settings-identity">
      <div class="settings-avatar">
        <span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-${esc(id.avatarIcon ?? "person")}"></use></svg></span>
      </div>
      <div class="settings-identity-meta">
        <h3>${esc(id.displayName)}</h3>
        <p>${esc(id.subtitle)}</p>
      </div>
      <span class="badge ${esc(badge.className)}">${esc(badge.text)}</span>
    </div>

    <div class="settings-card">
      <h4 class="settings-card-title">${t("settings.account.personalInfo")}</h4>
      <div class="settings-grid">
        ${personalFields}
      </div>
    </div>

    <div class="settings-card">
      <h4 class="settings-card-title">${t("settings.account.username")}</h4>
      <div class="settings-row">
        <label class="settings-field settings-field-grow">
          <span class="settings-field-label">
            <span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-alternate_email"></use></svg></span>
            ${t("settings.account.username")}
          </span>
          <input type="text" value="${esc(adapter.username)}" disabled />
        </label>
        <button type="button" class="btn btn-ghost" disabled>${t("settings.account.changeUsername")}</button>
      </div>
      <p class="settings-hint">${t("settings.account.usernameHint")}</p>
    </div>

    <div class="settings-card">
      <h4 class="settings-card-title">${t("settings.account.loginSecurity")}</h4>
      <div class="settings-row">
        <label class="settings-field settings-field-grow">
          <span class="settings-field-label">
            <span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-mail"></use></svg></span>
            ${t("settings.account.email")}
          </span>
          <input type="email" value="${esc(adapter.email)}" disabled />
        </label>
      </div>
      <div class="settings-row">
        <label class="settings-field settings-field-grow">
          <span class="settings-field-label">
            <span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-password"></use></svg></span>
            ${t("settings.account.password")}
          </span>
          <input type="password" value="••••••••••" disabled />
        </label>
        <button type="button" class="btn btn-ghost" id="settings-change-password"${DEMO_MODE ? " disabled" : ""}>${t("settings.account.changePassword")}</button>
      </div>
      <!-- novalidate: the browser's built-in bubbles follow the browser's
           language, not the app's, and they suppress our own checks. The
           minlength attributes stay as hints for password managers. -->
      <form class="settings-password-form" id="settings-password-form" novalidate hidden>
        <div class="settings-row">
          <label class="settings-field settings-field-grow">
            <span class="settings-field-label">${t("settings.account.newPassword")}</span>
            <input type="password" id="settings-new-password" autocomplete="new-password" minlength="${MIN_PASSWORD_LENGTH}" required />
          </label>
          <label class="settings-field settings-field-grow">
            <span class="settings-field-label">${t("settings.account.confirmPassword")}</span>
            <input type="password" id="settings-confirm-password" autocomplete="new-password" minlength="${MIN_PASSWORD_LENGTH}" required />
          </label>
        </div>
        <p class="settings-hint" id="settings-password-status" role="status"></p>
        <div class="settings-row settings-password-actions">
          <button type="submit" class="btn btn-primary">${t("common.save")}</button>
          <button type="button" class="btn btn-ghost" id="settings-cancel-password">${t("common.cancel")}</button>
        </div>
      </form>
      <div class="settings-toggle-row">
        <div class="settings-toggle-text">
          <span class="settings-toggle-title">${t("settings.account.twoFactor")}</span>
          <span class="settings-hint">${t("settings.account.twoFactorHint")}</span>
        </div>
        <span class="settings-switch" aria-disabled="true" title="${t("settings.account.twoFactorDisabled")}"></span>
      </div>
    </div>`;
}

// ── Preferences (shell only) ─────────────────────────────────────
function renderPreferences() {
  // Reflect this view's active language on the segmented control. Language
  // names stay in their own language (English / Español), never translated.
  const lang = getLang();
  return `
    <div class="settings-card">
      <h4 class="settings-card-title">${t("settings.prefs.title")}</h4>

      <div class="settings-toggle-row">
        <div class="settings-toggle-text">
          <span class="settings-toggle-title">${t("settings.prefs.language")}</span>
          <span class="settings-hint">${t("settings.prefs.languageHint")}</span>
        </div>
        <div class="settings-segmented" role="group" aria-label="${t("settings.prefs.language")}">
          <button type="button" class="settings-segment${lang === "en" ? " active" : ""}" data-lang="en">English</button>
          <button type="button" class="settings-segment${lang === "es" ? " active" : ""}" data-lang="es">Español</button>
        </div>
      </div>

      <p class="settings-hint">${t("settings.prefs.moreHint")}</p>
    </div>`;
}

// ── Help (static) ────────────────────────────────────────────────
function renderHelp() {
  const faqs = [
    { q: t("settings.help.faq1q"), a: t("settings.help.faq1a") },
    { q: t("settings.help.faq2q"), a: t("settings.help.faq2a") },
    { q: t("settings.help.faq3q"), a: t("settings.help.faq3a") },
  ];

  const faqHtml = faqs
    .map(
      (f) => `
      <div class="settings-faq-item">
        <p class="settings-faq-q">${f.q}</p>
        <p class="settings-faq-a">${f.a}</p>
      </div>`,
    )
    .join("");

  return `
    <div class="settings-card">
      <h4 class="settings-card-title">${t("settings.help.faqTitle")}</h4>
      <div class="settings-faq">${faqHtml}</div>
    </div>

    <div class="settings-card">
      <h4 class="settings-card-title">${t("settings.help.needHand")}</h4>
      <p class="settings-hint">
        ${t("settings.help.needHandText")}
      </p>
      <div class="settings-contact">
        <span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-support_agent"></use></svg></span>
        <span>${t("settings.help.contactPrefix")}<span class="settings-muted">contact@gzelaya.com</span></span>
      </div>
    </div>`;
}

// ── More info (static) ───────────────────────────────────────────
function renderMoreInfo() {
  return `
    <div class="settings-card">
      <h4 class="settings-card-title">${t("settings.about.title")}</h4>
      <p class="settings-hint">
        ${t("settings.about.text")}
      </p>
      <div class="settings-meta-row">
        <span class="settings-field-label">
          <span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-deployed_code"></use></svg></span>
          ${t("settings.about.version")}
        </span>
        <span class="badge badge-info">v${esc(APP_VERSION)} · Demo</span>
      </div>
    </div>

    <div class="settings-card">
      <h4 class="settings-card-title">${t("settings.about.links")}</h4>
      <ul class="settings-links">
        <li><span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-description"></use></svg></span> ${t("settings.about.documentation")} <span class="settings-coming-soon">${t("common.comingSoon")}</span></li>
        <li><span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-policy"></use></svg></span> <a href="/privacy.html" target="_blank" rel="noopener">${t("settings.about.privacy")}</a></li>
        <li><span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-gavel"></use></svg></span> <a href="/terms.html" target="_blank" rel="noopener">${t("settings.about.terms")}</a></li>
      </ul>
    </div>`;
}
