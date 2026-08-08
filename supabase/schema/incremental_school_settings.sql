-- ═══════════════════════════════════════════════════════════════
--  incremental_school_settings.sql
--
--  One row per school project holding its identity and the few labels
--  that differ between schools: what the national-ID field is called
--  ("Cédula" by default, "DIMEX" where foreign students are the norm,
--  or a school-issued "Carné").
--
--  Deliberately NOT a general custom-fields system. It is a single row
--  (`check (id = 1)`), which keeps it compatible with the admin console's
--  generic id-keyed table Gateway (src/js/adminData.js) and its demo
--  overlay, and makes "read the settings" a plain select.
--
--  Already inlined in school_schema.sql for fresh per-school projects.
--  Apply this snippet by hand to a project that predates it — see
--  docs/ONBOARDING_RUNBOOK.md. Idempotent: safe to re-run.
-- ═══════════════════════════════════════════════════════════════

create table if not exists public.school_settings (
  id integer primary key default 1 check (id = 1),
  name text,
  logo_url text,
  id_label text,
  created_at timestamp with time zone default now()
);

-- Seed the single row so the console only ever needs to UPDATE it.
insert into public.school_settings (id) values (1) on conflict (id) do nothing;

alter table public.school_settings enable row level security;

-- Same shape as every other table: admins write, signed-in users read (the
-- student and teacher portals need the school name and ID label too).
drop policy if exists "Admins have full access to school_settings"
  on public.school_settings;
create policy "Admins have full access to school_settings"
  on public.school_settings
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Authenticated can read school_settings"
  on public.school_settings;
create policy "Authenticated can read school_settings"
  on public.school_settings
  for select using (auth.role() = 'authenticated');

-- NOTE: the shared demo project additionally carries the read-only lock every
-- other table there has (restrictive demo_deny_insert/update/delete for
-- anon + authenticated). Real school projects must NOT have those — admins
-- need to write. Applied to the demo project out of band, like the rest of
-- its schema.
