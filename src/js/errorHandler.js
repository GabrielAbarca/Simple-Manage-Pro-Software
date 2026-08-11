// Global safety net — surface a neutral, dismissible banner when an uncaught
// error or unhandled promise rejection escapes, so a failure never leaves the
// user staring at a silently broken screen. The real error is always logged to
// the console; the user sees a generic message (no internals leaked).
//
// Imported first in every entry point so the listeners are registered before
// any other module's top-level code can throw. Dependency-free and self-styled
// so it works on every page regardless of which stylesheet loaded.

// Intentional control-flow throws that halt a module right after a redirect
// (the auth guards) are not failures — don't alarm the user for those. Guards
// signal that by throwing role.js's RedirectHalt, matched by name below; these
// message patterns stay as a safety net for any throw that predates it.
const BENIGN = [/^Unauthenticated$/, /No student profile/i];

let bannerShown = false;

function isBenign(reason) {
  // Matched structurally, not by string, so rewording a guard can never
  // silently reintroduce the banner. Checked by name rather than instanceof to
  // keep this module dependency-free — it must load on every page.
  if (reason && reason.name === "RedirectHalt") return true;
  const msg =
    reason && reason.message ? String(reason.message) : String(reason ?? "");
  return BENIGN.some((re) => re.test(msg));
}

function bannerText() {
  const es = (document.documentElement.lang || "")
    .toLowerCase()
    .startsWith("es");
  return es
    ? "Algo salió mal. Por favor, actualice la página."
    : "Something went wrong. Please refresh the page.";
}

function showErrorBanner() {
  if (bannerShown) return; // one at a time — don't let a loop spam banners
  bannerShown = true;

  const bar = document.createElement("div");
  bar.setAttribute("role", "alert");
  Object.assign(bar.style, {
    position: "fixed",
    insetInline: "0",
    top: "0",
    zIndex: "2147483647",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "1rem",
    padding: "0.75rem 1rem",
    background: "#b3261e",
    color: "#fff",
    font: "500 0.9rem/1.3 system-ui, sans-serif",
    boxShadow: "0 2px 8px rgba(0,0,0,.25)",
  });
  bar.append(bannerText());

  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.setAttribute("aria-label", "Dismiss");
  dismiss.textContent = "✕";
  Object.assign(dismiss.style, {
    background: "transparent",
    border: "0",
    color: "inherit",
    cursor: "pointer",
    fontSize: "1rem",
    lineHeight: "1",
  });
  dismiss.addEventListener("click", () => {
    bar.remove();
    bannerShown = false;
  });
  bar.appendChild(dismiss);

  (document.body ?? document.documentElement).appendChild(bar);
}

// ── Offline notice ─────────────────────────────────────────────
// Losing the network makes every query fail at once, which without this reads
// as the app breaking for no reason. Naming the cause turns a mystery into
// something the user can fix. Amber rather than red: nothing is broken, and
// it repairs itself.

let offlineBar = null;

// Deliberately duplicates `common.offline` rather than importing i18n: this
// module is the first import on every page and stays dependency-free, so it
// still works when the dictionary is what failed to load. Keep the two in
// step — same sentence, same usted register.
function offlineText() {
  const es = (document.documentElement.lang || "")
    .toLowerCase()
    .startsWith("es");
  return es
    ? "Parece que no tiene conexión. Puede que la información no esté actualizada."
    : "You appear to be offline. Some information may be out of date.";
}

function showOfflineBanner() {
  if (offlineBar) return;

  const bar = document.createElement("div");
  // "status", not "alert": being offline is a condition, not an emergency, and
  // a polite live region won't interrupt what a screen reader is saying.
  bar.setAttribute("role", "status");
  Object.assign(bar.style, {
    position: "fixed",
    insetInline: "0",
    bottom: "0",
    zIndex: "2147483646", // one below the error banner, which outranks it
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "1rem",
    padding: "0.75rem 1rem",
    background: "#8a5a00",
    color: "#fff",
    font: "500 0.9rem/1.3 system-ui, sans-serif",
    boxShadow: "0 -2px 8px rgba(0,0,0,.25)",
  });
  bar.append(offlineText());

  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.setAttribute("aria-label", "Dismiss");
  dismiss.textContent = "✕";
  Object.assign(dismiss.style, {
    background: "transparent",
    border: "0",
    color: "inherit",
    cursor: "pointer",
    fontSize: "1rem",
    lineHeight: "1",
  });
  // Dismissing drops the reference, so going offline again shows it again.
  dismiss.addEventListener("click", hideOfflineBanner);
  bar.appendChild(dismiss);

  offlineBar = bar;
  (document.body ?? document.documentElement).appendChild(bar);
}

function hideOfflineBanner() {
  offlineBar?.remove();
  offlineBar = null;
}

window.addEventListener("offline", showOfflineBanner);
window.addEventListener("online", hideOfflineBanner);

// Cover the page that loads while already offline, not just the transition.
if (navigator.onLine === false) {
  if (document.body) showOfflineBanner();
  else
    document.addEventListener("DOMContentLoaded", showOfflineBanner, {
      once: true,
    });
}

window.addEventListener("error", (event) => {
  if (isBenign(event.error ?? event.message)) return;
  console.error("[SMP] Uncaught error:", event.error ?? event.message);
  showErrorBanner();
});

window.addEventListener("unhandledrejection", (event) => {
  if (isBenign(event.reason)) return;
  console.error("[SMP] Unhandled promise rejection:", event.reason);
  showErrorBanner();
});
