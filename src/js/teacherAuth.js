// ─────────────────────────────────────────────────────────────────
//  teacherAuth.js — auth guard, teacher identity resolution, and the
//  admin-restricted-control gate. Split out of teacher.js.
// ─────────────────────────────────────────────────────────────────
import { getSession } from "./auth.js";
import { fetchRole, portalPath, haltForRedirect } from "./role.js";
import { t } from "./i18n.js";

/**
 * Resolve the signed-in session and role for the teacher console, redirecting
 * away (via `haltForRedirect`) when the account doesn't belong here.
 * Teachers own this console; admins may enter too (school oversight, and the
 * shared demo profile carries the admin role). Everyone else is sent to the
 * portal their role resolves to.
 * @returns {Promise<{ session: any, role: string }>}
 */
export async function resolveTeacherSession() {
  const session = await getSession();
  if (!session) haltForRedirect("/login.html", "Unauthenticated");

  const role = await fetchRole();
  if (role !== "teacher" && role !== "admin") {
    haltForRedirect(portalPath(role), "Unauthorized");
  }

  return { session, role };
}

// ── Role gating (visual/demo only) ──────────────────────────────
// There is no per-user auth yet — this console always runs as the demo teacher.
// IS_ADMIN is the SINGLE flag every admin-restricted control routes through, and
// the only line a future real auth check would replace. Do not hardcode the
// disabled state into individual buttons; gate them through this flag instead.
export const IS_ADMIN = false;

// Core, reusable treatment for any admin-restricted control. When IS_ADMIN is
// false, render the element enabled-but-inert: dimmed, not-allowed, aria-disabled,
// a hover tooltip, and a no-op click so the underlying action never runs. NOTE:
// the native `disabled` attribute is intentionally avoided — it suppresses mouse
// events, which would kill the hover tooltip.
export function applyAdminLock(el) {
  el.classList.add("admin-only");
  el.setAttribute("aria-disabled", "true");
  el.title = t("common.adminOnly");
  el.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
}

// Wire a click action behind the flag in one call. Admin: run the real handler.
// Non-admin: lock the control (inert) and never attach the real handler.
export function bindAdminAction(el, handler) {
  if (IS_ADMIN) el.addEventListener("click", handler);
  else applyAdminLock(el);
  return el;
}
