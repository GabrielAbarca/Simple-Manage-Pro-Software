// ─────────────────────────────────────────────────────────────────
//  auth.js — auth guard, role gate and the signed-in admin's own
//  profile row. Split out of admin.js. Mirrors teacherAuth.js.
// ─────────────────────────────────────────────────────────────────
import { supabase } from "../supabaseClient.js";
import { getSession } from "../auth.js";
import { fetchRole, portalPath, haltForRedirect } from "../role.js";
import { state } from "./state.js";

/**
 * Resolve the signed-in session and role for the admin console, redirecting
 * away (via `haltForRedirect`) when the account doesn't belong here. Only
 * `admin` may enter; everyone else is sent to the portal their role resolves
 * to.
 * @returns {Promise<{ session: any, role: string }>}
 */
export async function resolveAdminSession() {
  const session = await getSession();
  if (!session) haltForRedirect("/login.html", "Unauthenticated");

  const role = await fetchRole();
  if (role !== "admin") haltForRedirect(portalPath(role), "Unauthorized");

  return { session, role };
}

/** The signed-in account's `profiles` row (name + role). */
export async function fetchProfile() {
  const { data: row, error } = await supabase
    .from("profiles")
    .select("name, role")
    .eq("id", state.session.user.id)
    .single();
  if (error) throw error;
  return row;
}
