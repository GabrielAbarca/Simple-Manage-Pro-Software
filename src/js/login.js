import "./errorHandler.js";
import "./speedInsights.js";
import {
  signIn,
  signUp,
  signOut,
  getSession,
  sendPasswordReset,
  verifyRecoveryToken,
  updatePassword,
} from "./auth.js";
import { supabase } from "./supabaseClient.js";
import { fetchRole, portalPath } from "./role.js";
import { initTheme, bindThemeToggle } from "./theme.js";
import { initI18n, applyTranslations, t } from "./i18n.js";
import { DEMO_MODE, DEMO_CREDENTIALS } from "./demoMode.js";
import { parseRecoveryUrl, recoveryRedirectUrl } from "./recovery.js";
import { EMAIL_RE, MIN_PASSWORD_LENGTH } from "./validate.js";

// Read the URL before anything can await: the Supabase client's
// detectSessionInUrl strips a recovery fragment as part of its async
// initialization, and once it has, this page can no longer tell a recovery
// landing from an ordinary signed-in visit — it would just redirect to the
// portal, leaving no way to set a password.
const recoveryUrl = parseRecoveryUrl(window.location);

// Belt-and-braces for the same race: if the client won and consumed the
// fragment first, it still announces the recovery. Registered synchronously,
// before the first await below.
let recoveryAnnounced = false;
supabase.auth.onAuthStateChange((event) => {
  if (event === "PASSWORD_RECOVERY") recoveryAnnounced = true;
});

// Login has no settings panel → detection-only (navigator.language). No stored
// key; the static markup carries data-i18n and is translated on load below.
initI18n("login");
applyTranslations();

// Send a signed-in user to the portal their role resolves to — demo included.
// The demo account carries profiles.role = 'admin' (and a students row, so it
// can tour every portal), which lands the tour on the admin console: the view
// a director is actually evaluating, rather than one student's dashboard.
async function redirectToPortal() {
  window.location.replace(portalPath(await fetchRole()));
}

let isSignUpMode = false;

const authForm = document.getElementById("auth-form");
const authTitle = document.getElementById("auth-title");
const authSubtitle = document.getElementById("auth-subtitle");
const authAvatarIcon = document.getElementById("auth-avatar-icon");
const authToast = document.getElementById("auth-toast");

const groupName = document.getElementById("group-name");
const groupConfirm = document.getElementById("group-confirm");

const inputName = document.getElementById("input-name");
const inputEmail = document.getElementById("input-email");
const inputPassword = document.getElementById("input-password");
const inputConfirm = document.getElementById("input-confirm");

const errorName = document.getElementById("error-name");
const errorEmail = document.getElementById("error-email");
const errorPassword = document.getElementById("error-password");
const errorConfirm = document.getElementById("error-confirm");

const btnSubmit = document.getElementById("btn-submit");
const btnText = document.getElementById("btn-text");
const btnSpinner = document.getElementById("btn-spinner");
const btnSwitch = document.getElementById("btn-switch");
const switchText = document.getElementById("switch-text");
const demoNotice = document.getElementById("demo-notice");

const forgotRow = document.getElementById("forgot-row");
const btnForgot = document.getElementById("btn-forgot");

const recoveryForm = document.getElementById("recovery-form");
const inputNewPassword = document.getElementById("input-new-password");
const inputConfirmNew = document.getElementById("input-confirm-new");
const errorNewPassword = document.getElementById("error-new-password");
const errorConfirmNew = document.getElementById("error-confirm-new");
const btnRecoverySubmit = document.getElementById("btn-recovery-submit");
const btnRecoveryText = document.getElementById("btn-recovery-text");
const btnRecoverySpinner = document.getElementById("btn-recovery-spinner");

// The two forms share setLoading()/clearErrors(); each needs its own button,
// label and spinner.
const signInUi = {
  form: authForm,
  button: btnSubmit,
  text: btnText,
  spinner: btnSpinner,
};
const recoveryUi = {
  form: recoveryForm,
  button: btnRecoverySubmit,
  text: btnRecoveryText,
  spinner: btnRecoverySpinner,
};

const togglePassword = document.getElementById("toggle-password");
const toggleIcon = document.getElementById("toggle-password-icon");

const themeToggler = document.getElementById("login-theme-toggler");

// Swap the inline SVG sprite icon inside a `.material-symbols-outlined` span
// (icons are now <svg><use href="#icon-NAME"> rather than a font ligature).
function setIcon(spanEl, name) {
  const use = spanEl.querySelector("use");
  if (use) use.setAttribute("href", `#icon-${name}`);
}

initTheme();
bindThemeToggle(themeToggler);

// Demo sandbox: this deploy is a single shared profile. Prefill and lock the
// credentials so visitors sign in with one click. Gated on DEMO_MODE → a real
// build is untouched. (The sign-up switch is hidden for every build, in the
// markup — see login.html.)
if (DEMO_MODE) {
  inputEmail.value = DEMO_CREDENTIALS.email;
  inputPassword.value = DEMO_CREDENTIALS.password;

  [inputEmail, inputPassword].forEach((input) => {
    input.readOnly = true;
    input.closest(".input-wrapper").classList.add("demo-locked");
  });

  // Keep the password masked and drop the reveal toggle.
  togglePassword.style.display = "none";

  // The shared demo password is public by design and must not be resettable
  // by visitors.
  forgotRow.style.display = "none";

  authSubtitle.textContent = t("login.demoSubtitle");

  if (demoNotice) demoNotice.style.display = "block";
}

// ── Password recovery ─────────────────────────────────────────────
// Runs before the "already signed in → portal" redirect: a recovery link
// carries a real session, so that redirect would otherwise swallow the flow.

function showRecoveryScreen() {
  authForm.style.display = "none";
  recoveryForm.style.display = "block";
  forgotRow.style.display = "none";
  if (demoNotice) demoNotice.style.display = "none";
  authTitle.textContent = t("login.recovery.title");
  authSubtitle.textContent = t("login.recovery.subtitle");
  setIcon(authAvatarIcon, "lock_reset");
}

function showSignInScreen() {
  recoveryForm.style.display = "none";
  authForm.style.display = "";
  authTitle.textContent = t("login.welcomeTitle");
  authSubtitle.textContent = t("login.welcomeSubtitle");
  setIcon(authAvatarIcon, "lock");
  if (!DEMO_MODE) {
    forgotRow.style.display = "";
  }
}

// Drop the tokens from the address bar so a refresh can't replay a link that
// has already been spent, and so they stay out of the browser history.
function stripRecoveryParams() {
  history.replaceState(null, "", window.location.pathname);
}

/**
 * Open the recovery form once `confirm` has produced a usable session.
 *
 * Both link shapes need this: the token-hash form has to be exchanged here,
 * and the fragment form is exchanged by the client's own asynchronous
 * initialization. Submitting before either finishes would fail with a bare
 * "Auth session missing", so the form stays disabled until the session is in
 * hand and an unusable link is reported as exactly that.
 *
 * @param {() => Promise<unknown>} confirm resolves falsy when there's no session
 */
async function openRecoveryForm(confirm) {
  showRecoveryScreen();
  authSubtitle.textContent = t("login.recovery.verifying");
  setLoading(true, recoveryUi);
  try {
    if (!(await confirm())) throw new Error("no recovery session");
    authSubtitle.textContent = t("login.recovery.subtitle");
  } catch {
    showSignInScreen();
    showToast(t("login.error.linkExpired"), "error");
  } finally {
    setLoading(false, recoveryUi);
    // Only now: the fragment is what the client reads to build the session,
    // and it reads it asynchronously. Clearing the URL any earlier destroys
    // the tokens before they have been exchanged.
    stripRecoveryParams();
  }
}

if (recoveryUrl.kind === "error") {
  // Nothing to recover with — explain it and leave the request-a-new-link
  // affordance in reach.
  stripRecoveryParams();
  showToast(
    recoveryUrl.code === "otp_expired"
      ? t("login.error.linkExpired")
      : t("login.error.linkInvalid"),
    "error",
  );
} else if (recoveryUrl.kind === "tokenHash") {
  // A custom email template built on {{ .TokenHash }}: the token is spent
  // here, not by whatever pre-fetched the link.
  await openRecoveryForm(() => verifyRecoveryToken(recoveryUrl.tokenHash));
} else if (recoveryUrl.kind === "tokens" || recoveryAnnounced) {
  // The client turns the fragment into a session as part of its own startup;
  // getSession() waits for that to settle.
  await openRecoveryForm(getSession);
} else {
  const currentUser = await getSession();
  if (currentUser) {
    await redirectToPortal();
  }
}

btnSwitch.addEventListener("click", () => {
  isSignUpMode = !isSignUpMode;
  clearErrors();
  clearToast();

  if (isSignUpMode) {
    authTitle.textContent = t("login.createTitle");
    authSubtitle.textContent = t("login.createSubtitle");
    setIcon(authAvatarIcon, "person_add");
    btnText.textContent = t("login.signUp");
    switchText.textContent = t("login.haveAccount");
    btnSwitch.textContent = t("login.signIn");

    showField(groupName);
    showField(groupConfirm);
    inputPassword.setAttribute("autocomplete", "new-password");
  } else {
    authTitle.textContent = t("login.welcomeTitle");
    authSubtitle.textContent = t("login.welcomeSubtitle");
    setIcon(authAvatarIcon, "lock");
    btnText.textContent = t("login.signIn");
    switchText.textContent = t("login.noAccount");
    btnSwitch.textContent = t("login.signUp");

    hideField(groupName);
    hideField(groupConfirm);
    inputPassword.setAttribute("autocomplete", "current-password");
  }
});

togglePassword.addEventListener("click", () => {
  const isHidden = inputPassword.type === "password";
  inputPassword.type = isHidden ? "text" : "password";
  setIcon(toggleIcon, isHidden ? "visibility_off" : "visibility");
});

authForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearErrors();
  clearToast();

  const email = inputEmail.value.trim();
  const password = inputPassword.value;
  const name = inputName.value.trim();
  const confirm = inputConfirm.value;

  let valid = true;

  if (!email || !EMAIL_RE.test(email)) {
    setFieldError(errorEmail, inputEmail, t("login.validation.email"));
    valid = false;
  }

  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    setFieldError(errorPassword, inputPassword, t("login.validation.password"));
    valid = false;
  }

  if (isSignUpMode) {
    if (!name) {
      setFieldError(errorName, inputName, t("login.validation.name"));
      valid = false;
    }
    if (password !== confirm) {
      setFieldError(
        errorConfirm,
        inputConfirm,
        t("login.validation.passwordsMatch"),
      );
      valid = false;
    }
  }

  if (!valid) return;

  setLoading(true);

  try {
    if (isSignUpMode) {
      await signUp(name, email, password);

      await signIn(email, password);
      await redirectToPortal();
    } else {
      await signIn(email, password);
      await redirectToPortal();
    }
  } catch (err) {
    const message =
      err.name === "DemoDisabledError"
        ? t("login.error.demoSignupDisabled")
        : formatAuthError(err.message);
    showToast(message, "error");
  } finally {
    setLoading(false);
  }
});

// Reuses the email field already on screen rather than adding another card
// mode — one click from "I forgot" to a link in the inbox.
btnForgot.addEventListener("click", async () => {
  clearErrors();
  clearToast();

  const email = inputEmail.value.trim();
  if (!email) {
    setFieldError(errorEmail, inputEmail, t("login.error.emailForReset"));
    return;
  }
  if (!EMAIL_RE.test(email)) {
    setFieldError(errorEmail, inputEmail, t("login.validation.email"));
    return;
  }

  setLoading(true);
  try {
    await sendPasswordReset(email, recoveryRedirectUrl(window.location.origin));
    // Deliberately neutral: never reveal whether the address has an account.
    showToast(t("login.resetLinkSent"), "success");
  } catch (err) {
    showToast(
      err.name === "DemoDisabledError"
        ? t("login.error.recoveryDemoDisabled")
        : formatAuthError(err.message),
      "error",
    );
  } finally {
    setLoading(false);
  }
});

recoveryForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearErrors(recoveryForm);
  clearToast();

  const password = inputNewPassword.value;
  const confirm = inputConfirmNew.value;

  let valid = true;
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    setFieldError(
      errorNewPassword,
      inputNewPassword,
      t("login.validation.password"),
    );
    valid = false;
  }
  if (password !== confirm) {
    setFieldError(
      errorConfirmNew,
      inputConfirmNew,
      t("login.validation.passwordsMatch"),
    );
    valid = false;
  }
  if (!valid) return;

  setLoading(true, recoveryUi);
  try {
    await updatePassword(password);
    // Sign out and hand them back the sign-in form: entering the new password
    // once proves it took, and no half-authenticated session is left behind.
    await signOut();
    showSignInScreen();
    inputNewPassword.value = "";
    inputConfirmNew.value = "";
    showToast(t("login.recovery.success"), "success");
  } catch (err) {
    showToast(
      err.name === "DemoDisabledError"
        ? t("login.error.recoveryDemoDisabled")
        : formatAuthError(err.message),
      "error",
    );
  } finally {
    setLoading(false, recoveryUi);
  }
});

function setLoading(loading, ui = signInUi) {
  ui.button.disabled = loading;
  ui.text.style.display = loading ? "none" : "inline";
  ui.spinner.style.display = loading ? "inline-block" : "none";
  ui.form.querySelectorAll("input").forEach((el) => (el.disabled = loading));
  btnSwitch.disabled = loading;
  btnForgot.disabled = loading;
}

function setFieldError(errorEl, inputEl, message) {
  errorEl.textContent = message;
  inputEl.closest(".input-wrapper").classList.add("input-error");
}

function clearErrors(form = authForm) {
  form.querySelectorAll(".field-error").forEach((el) => (el.textContent = ""));
  form.querySelectorAll(".input-wrapper").forEach((el) => {
    el.classList.remove("input-error");
  });
}

function showToast(message, type = "error") {
  authToast.textContent = message;
  authToast.className = `auth-toast toast-${type}`;
}

function clearToast() {
  authToast.textContent = "";
  authToast.className = "auth-toast";
}

function showField(el) {
  el.style.display = "block";
}

function hideField(el) {
  el.style.display = "none";
}

function formatAuthError(message) {
  if (!message) return t("login.error.unexpected");

  const lower = message.toLowerCase();
  if (
    lower.includes("invalid login credentials") ||
    lower.includes("invalid credentials")
  ) {
    return t("login.error.credentials");
  }
  if (lower.includes("email not confirmed")) {
    return t("login.error.notConfirmed");
  }
  if (
    lower.includes("user already registered") ||
    lower.includes("already been registered")
  ) {
    return t("login.error.exists");
  }
  if (
    lower.includes("should be different from the old password") ||
    lower.includes("same as the old password")
  ) {
    return t("login.error.samePassword");
  }
  if (lower.includes("password should be")) {
    return t("login.error.passwordLength");
  }
  if (lower.includes("expired") || lower.includes("invalid token")) {
    return t("login.error.linkExpired");
  }
  if (lower.includes("rate limit")) {
    return t("login.error.rateLimit");
  }
  if (lower.includes("network") || lower.includes("fetch")) {
    return t("login.error.network");
  }
  return message;
}

[authForm, recoveryForm].forEach((form) => {
  form.querySelectorAll("input").forEach((input) => {
    input.addEventListener("input", () => {
      const wrapper = input.closest(".input-wrapper");
      if (wrapper) wrapper.classList.remove("input-error");
    });
  });
});
