/**
 * Login entry point. Explicit .html path per the app's cross-page redirect
 * convention (see role.js) — Vercel's cleanUrls 308s it to /login, and Vite's
 * dev server serves it directly.
 */
export const LOGIN_PATH = "/login.html";

/**
 * @typedef {{ kind: "none" }
 *   | { kind: "tokens" }
 *   | { kind: "tokenHash", tokenHash: string }
 *   | { kind: "error", code: string, description: string }} RecoveryUrl
 */

/**
 * Where a recovery email should send the user back to.
 * @param {string} origin e.g. `window.location.origin`
 * @returns {string}
 */
export function recoveryRedirectUrl(origin) {
  return `${origin}${LOGIN_PATH}`;
}

/**
 * Classify the current URL as a recovery landing, if it is one.
 *
 * URLSearchParams is used for both halves so percent- and plus-encoding are
 * decoded the same way Supabase encodes them (`Email+link+is+invalid` reads
 * back as a normal sentence).
 *
 * @param {{ hash?: string, search?: string }} location a Location or a stub
 * @returns {RecoveryUrl}
 */
export function parseRecoveryUrl({ hash = "", search = "" } = {}) {
  const fragment = new URLSearchParams(hash.replace(/^#/, ""));
  const query = new URLSearchParams(search);

  // Errors arrive in the fragment and are not always recovery-specific, so
  // they are matched first and reported whatever the type.
  const errorCode = fragment.get("error_code") ?? fragment.get("error");
  if (errorCode) {
    return {
      kind: "error",
      code: errorCode,
      description: fragment.get("error_description") ?? "",
    };
  }

  if (fragment.get("access_token") && fragment.get("type") === "recovery") {
    return { kind: "tokens" };
  }

  const tokenHash = query.get("token_hash");
  if (tokenHash && query.get("type") === "recovery") {
    return { kind: "tokenHash", tokenHash };
  }

  return { kind: "none" };
}
