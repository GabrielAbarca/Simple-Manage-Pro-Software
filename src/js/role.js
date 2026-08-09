// ─────────────────────────────────────────────────────────────────
//  role.js — auth-role resolution and portal routing.
//
//  The app has one portal per profiles.role value:
//    admin   → /admin.html    (admin console — school setup & operation)
//    teacher → /teacher.html  (teacher console — classes & gradebook)
//    student → /              (student dashboard)
//  Entry points resolve the signed-in user's role with fetchRole()
//  and send strangers to their own portal via portalPath(). Roles
//  live in profiles.role (one row per auth user); a missing profile
//  row resolves to null and routes like a student (students are
//  matched by students.auth_user_id, not by profiles).
// ─────────────────────────────────────────────────────────────────

import { supabase } from "./supabaseClient.js";

/** @typedef {"admin" | "teacher" | "student"} Role */

/**
 * Resolve the signed-in user's role from their profiles row.
 * @returns {Promise<Role | null>} null when signed out, the profile row is
 *   missing, or the stored role is unknown — callers route that as "student".
 */
export async function fetchRole() {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", session.user.id)
    .maybeSingle();
  if (error) {
    console.error("fetchRole:", error.message);
    return null;
  }

  const role = data?.role;
  return role === "admin" || role === "teacher" || role === "student"
    ? role
    : null;
}

/**
 * The students row linked to an auth user, if there is one.
 *
 * Being a student is a separate fact from `profiles.role`: the student portal
 * resolves its subject by `students.auth_user_id`, not by role, so an account
 * can hold a role *and* a student record (the shared demo account does — it is
 * an admin that also sits in a section, which is what lets one login tour all
 * three portals). Callers use this to decide whether a link to the student
 * portal would actually land, instead of offering one that bounces.
 *
 * Mirrors fetchRole(): a failed query logs and resolves to null rather than
 * throwing, so a cross-portal link simply stays hidden.
 *
 * @param {string} userId auth user id
 * @returns {Promise<number | null>} the students.id, or null when there is none
 */
export async function fetchStudentId(userId) {
  if (!userId) return null;
  // maybeSingle, not single: an admin or teacher legitimately has no students
  // row, and single() turns that expected case into a PGRST116.
  const { data, error } = await supabase
    .from("students")
    .select("id")
    .eq("auth_user_id", userId)
    .maybeSingle();
  if (error) {
    console.error("fetchStudentId:", error.message);
    return null;
  }
  return data?.id ?? null;
}

/**
 * Portal entry point for a role. Explicit .html paths follow the app's
 * cross-page redirect convention (Vercel's cleanUrls 308s them away).
 * @param {import("./role.js").Role | null | undefined} role
 * @returns {string}
 */
export function portalPath(role) {
  if (role === "admin") return "/admin.html";
  if (role === "teacher") return "/teacher.html";
  return "/";
}

/**
 * Marks a throw that only exists to stop a module's top-level code after a
 * redirect has already been issued. Entry points are top-level-await modules,
 * so the throw surfaces as an unhandled rejection; errorHandler matches on
 * `name` (never on the message) and stays quiet, which is what keeps a routine
 * role redirect from flashing the global "Something went wrong" banner.
 */
export class RedirectHalt extends Error {
  /** @param {string} [reason] logged context — never shown to the user */
  constructor(reason = "Redirecting") {
    super(reason);
    this.name = "RedirectHalt";
  }
}

/**
 * Send the browser to `path` and halt the calling module.
 * @param {string} path
 * @param {string} [reason]
 * @returns {never}
 */
export function haltForRedirect(path, reason) {
  window.location.replace(path);
  throw new RedirectHalt(reason ?? `Redirecting to ${path}`);
}
