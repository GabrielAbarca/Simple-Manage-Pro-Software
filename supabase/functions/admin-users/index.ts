// ─────────────────────────────────────────────────────────────────
//  admin-users — Supabase Edge Function (service role)
//
//  Account management for the SMP admin console: create login accounts
//  for teachers/students, reset passwords and (de)activate them. The
//  browser can't do this with the anon key (Supabase's Auth admin API
//  needs the service-role key), so it lives here.
//
//  The service-role key is read from the function's runtime env
//  (SUPABASE_SERVICE_ROLE_KEY, injected by Supabase) — it never reaches
//  the client. Every request is authorized: the caller's JWT must map
//  to a profiles row with role = 'admin'.
//
//  Deploy with the platform's verify_jwt OFF: the function performs its
//  own verification (above) and the CORS preflight has to pass without
//  an Authorization header.
//
//  Deploy to each real (non-demo) school project — NEVER the shared demo
//  project. In demo mode the console simulates account creation and does
//  not call this function.
//
//  Actions (POST JSON { action, ... }):
//    create     { email, password, role, name?, linkType?, linkId? }
//    reset      { email, redirectTo? }          → returns a recovery link
//    setActive  { userId, active }              → ban / unban the login
//    list       { }                             → every login + role + status
//
//  `redirectTo` is where the emailed link sends the user back to; the
//  console passes its own origin so a reset works from localhost and from
//  production without redeploying. It is not validated here on purpose —
//  Supabase only honours URLs allow-listed in the project's Auth URL
//  configuration (Site URL + additional redirect URLs), which is the
//  boundary that keeps this from being an open redirect. Omitting it makes
//  Supabase fall back to Site URL.
// ─────────────────────────────────────────────────────────────────

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  // ── Authorize: the caller must be an admin ──────────────────────
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return json({ error: "Missing bearer token" }, 401);
  }
  const caller = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
    error: userErr,
  } = await caller.auth.getUser();
  if (userErr || !user) return json({ error: "Invalid session" }, 401);

  const admin = createClient(url, serviceKey);
  const { data: profile } = await admin
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.role !== "admin") {
    return json({ error: "Admin role required" }, 403);
  }

  // ── Dispatch ────────────────────────────────────────────────────
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const action = String(body.action ?? "");

  try {
    if (action === "create") {
      const email = String(body.email ?? "").trim();
      const password = String(body.password ?? "");
      const role = String(body.role ?? "student");
      const name = body.name ? String(body.name) : undefined;
      const linkType = body.linkType ? String(body.linkType) : null;
      const linkId = body.linkId != null ? Number(body.linkId) : null;

      if (!email || !password) {
        return json({ error: "email and password are required" }, 400);
      }
      if (!["admin", "teacher", "student"].includes(role)) {
        return json({ error: "invalid role" }, 400);
      }

      const { data: created, error: createErr } =
        await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: name ? { name } : {},
        });
      if (createErr || !created.user) {
        return json({ error: createErr?.message ?? "create failed" }, 400);
      }
      const newId = created.user.id;

      // handle_new_user() already inserted a profiles row (default role
      // 'student'); set the intended role.
      await admin.from("profiles").update({ role }).eq("id", newId);

      if (linkType === "teacher" && linkId) {
        await admin
          .from("teachers")
          .update({ auth_user_id: newId })
          .eq("id", linkId);
      } else if (linkType === "student" && linkId) {
        await admin
          .from("students")
          .update({ auth_user_id: newId })
          .eq("id", linkId);
      }

      return json({ userId: newId, email });
    }

    if (action === "reset") {
      const email = String(body.email ?? "").trim();
      if (!email) return json({ error: "email is required" }, 400);
      const redirectTo = body.redirectTo ? String(body.redirectTo) : undefined;
      const { data, error } = await admin.auth.admin.generateLink({
        type: "recovery",
        email,
        options: redirectTo ? { redirectTo } : {},
      });
      if (error) return json({ error: error.message }, 400);
      return json({ actionLink: data.properties?.action_link ?? null });
    }

    if (action === "setActive") {
      const userId = String(body.userId ?? "");
      const active = Boolean(body.active);
      if (!userId) return json({ error: "userId is required" }, 400);
      const { error } = await admin.auth.admin.updateUserById(userId, {
        // A far-future ban disables sign-in; "none" restores it.
        ban_duration: active ? "none" : "876600h",
      });
      if (error) return json({ error: error.message }, 400);
      return json({ userId, active });
    }

    if (action === "list") {
      // Auth users only exist behind the service-role key, so the console
      // can't enumerate logins on its own — page through them here.
      // listUsers() caps perPage at 1000; loop until a short page.
      const users: Array<Record<string, unknown>> = [];
      let page = 1;
      const perPage = 1000;
      for (;;) {
        const { data, error } = await admin.auth.admin.listUsers({
          page,
          perPage,
        });
        if (error) return json({ error: error.message }, 400);
        users.push(...data.users);
        if (data.users.length < perPage) break;
        page += 1;
      }

      // Roles and display names live in profiles (one row per auth user,
      // created by the handle_new_user trigger). Join in memory.
      const { data: profiles } = await admin
        .from("profiles")
        .select("id, name, role");
      const byId = new Map(
        (profiles ?? []).map((p: Record<string, unknown>) => [p.id, p]),
      );

      const now = Date.now();
      const accounts = users.map((u) => {
        const prof = byId.get(u.id) as Record<string, unknown> | undefined;
        const meta = (u.user_metadata ?? {}) as Record<string, unknown>;
        const bannedUntil = u.banned_until
          ? Date.parse(String(u.banned_until))
          : NaN;
        return {
          id: u.id,
          email: u.email ?? "",
          name: prof?.name ?? meta.name ?? "",
          role: prof?.role ?? "student",
          banned: Number.isFinite(bannedUntil) && bannedUntil > now,
        };
      });

      return json({ accounts });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    return json({ error: (err as Error).message ?? "Unexpected error" }, 500);
  }
});
