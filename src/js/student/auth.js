import { getSession, signOut } from "./auth.js";
import {
  fetchRole,
  fetchStudentId,
  portalPath,
  haltForRedirect,
} from "./role.js";
import { supabase } from "./supabaseClient.js";

/**
 * Resolve the signed-in user's student id for the student portal, redirecting
 * away (via `haltForRedirect`) when the account doesn't belong here:
 * unauthenticated, an admin/teacher landing on the student portal (sent to
 * their own portal instead of being signed out), or — outside dev — a
 * role-less account with no linked student row (a data error, signed out).
 * @returns {Promise<{ user: object, studentId: number }>}
 */
export async function resolveStudentSession() {
  const session = await getSession();
  if (!session) haltForRedirect("/login.html", "Unauthenticated");
  const user = session?.user;

  if (!user) haltForRedirect("/login.html", "Unauthenticated");

  const linkedStudentId = await fetchStudentId(user.id);

  if (linkedStudentId) {
    return { user, studentId: linkedStudentId };
  }

  // Not a student — an admin or teacher landing here belongs in their own
  // portal, not signed out (role routing). Only a role-less account with no
  // student row is a data error and falls through to sign-out.
  const role = await fetchRole();
  if (role === "admin" || role === "teacher") {
    haltForRedirect(portalPath(role), "Redirecting to role portal");
  }

  if (import.meta.env.DEV) {
    console.warn(
      "[SMP] No student found for auth user id",
      user.id,
      "— falling back to STUDENT_ID=1 (dev only).",
    );
    return { user, studentId: 1 };
  }

  console.error("[SMP] No student profile linked to this account.");
  await signOut();
  haltForRedirect("/login.html", "No student profile linked");
}

/**
 * Sign the user out client-side the moment Supabase reports SIGNED_OUT, and
 * force a reload when the page is restored from the bfcache (Back/Forward
 * Cache) so a stale session doesn't linger on screen.
 */
export function bindSessionWatchers() {
  supabase.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") {
      window.location.replace("/login.html");
    }
  });

  window.addEventListener("pageshow", (event) => {
    if (event.persisted) {
      window.location.reload();
    }
  });
}
