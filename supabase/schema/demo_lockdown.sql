-- ═══════════════════════════════════════════════════════════════
--  Demo read-only lockdown
--  ⚠ DEMO PROJECT ONLY — never run this on a school project.
-- ═══════════════════════════════════════════════════════════════
--
-- The public demo is a shared sandbox: anyone on the internet signs in with
-- the same account. The browser already refuses to write in demo mode
-- (src/js/demoDb.js and src/js/adminDemoDb.js record deltas in memory and
-- never call Supabase), but that is a client-side promise. This file is the
-- server-side backstop that makes it true even if the client is bypassed,
-- patched, or driven directly against the REST API with the anon key.
--
-- It adds a RESTRICTIVE policy per table per write command. Restrictive
-- policies are AND-ed with the permissive ones, so `using (false)` /
-- `with check (false)` vetoes every insert/update/delete for `anon` and
-- `authenticated` regardless of what the permissive admin policy allows.
-- Reads are untouched — the demo still renders live data from this project.
--
-- WHY IT IS A LOOP OVER pg_tables, not a fixed list: the hazard this file
-- exists to fix is a NEW table shipping unlocked because nobody remembered
-- the manual step. Looping over the live catalog means re-running after any
-- schema change locks whatever now exists. The table list as of this writing
-- is kept in the comment below for auditability.
--
--   profiles, app_config, school_settings, school_years, grade_levels, rooms,
--   subjects, teachers, staff, guardians, classes, students, student_guardians,
--   grade_level_subjects, class_subject_teachers, grading_periods, schedules,
--   schedule_configs, bell_schedules, bell_schedule_blocks, attendance,
--   grade_categories, assignments, assignment_grades, student_grades,
--   discipline_records, student_conduct_grades, events
--
-- HOW TO RUN
--   Supabase Dashboard → SQL Editor → paste → Run, on the DEMO project.
--   Idempotent and self-verifying: safe to re-run, raises if anything is
--   missing at the end. Re-run after EVERY schema change on the demo project.
--
-- HOW TO UNDO (if a table ever needs to be writable again on the demo)
--   drop policy demo_deny_insert on public.<table>;   -- and _update / _delete
--
-- Applying this to a school project would leave its admins unable to write
-- anything at all. There is no partial version of that mistake — check the
-- project ref in the URL bar before you press Run.

do $$
declare
  tbl text;
  locked int := 0;
begin
  for tbl in
    select tablename from pg_tables where schemaname = 'public' order by tablename
  loop
    -- RLS must be on for a restrictive policy to be consulted at all.
    execute format('alter table public.%I enable row level security;', tbl);

    -- Drop only what is actually there, so a re-run stays quiet instead of
    -- burying the verification summary under a NOTICE per policy per table.
    if exists (select 1 from pg_policies
                where schemaname = 'public' and tablename = tbl
                  and policyname = 'demo_deny_insert') then
      execute format('drop policy demo_deny_insert on public.%I;', tbl);
    end if;
    if exists (select 1 from pg_policies
                where schemaname = 'public' and tablename = tbl
                  and policyname = 'demo_deny_update') then
      execute format('drop policy demo_deny_update on public.%I;', tbl);
    end if;
    if exists (select 1 from pg_policies
                where schemaname = 'public' and tablename = tbl
                  and policyname = 'demo_deny_delete') then
      execute format('drop policy demo_deny_delete on public.%I;', tbl);
    end if;

    -- INSERT takes only WITH CHECK; DELETE only USING; UPDATE both.
    execute format(
      'create policy demo_deny_insert on public.%I as restrictive '
      || 'for insert to anon, authenticated with check (false);', tbl);
    execute format(
      'create policy demo_deny_update on public.%I as restrictive '
      || 'for update to anon, authenticated using (false) with check (false);', tbl);
    execute format(
      'create policy demo_deny_delete on public.%I as restrictive '
      || 'for delete to anon, authenticated using (false);', tbl);

    locked := locked + 1;
  end loop;

  raise notice 'demo lockdown: locked % tables (% policies)', locked, locked * 3;
end $$;

-- ── Self-verification ──────────────────────────────────────────
-- Fails loudly rather than reporting a half-applied lock.
do $$
declare
  tables_count int;
  policy_count int;
  gaps text;
begin
  select count(*) into tables_count from pg_tables where schemaname = 'public';

  select count(*) into policy_count
    from pg_policies
   where schemaname = 'public'
     and policyname in ('demo_deny_insert', 'demo_deny_update', 'demo_deny_delete');

  if policy_count <> tables_count * 3 then
    select string_agg(t.tablename, ', ' order by t.tablename) into gaps
      from pg_tables t
     where t.schemaname = 'public'
       and (select count(*) from pg_policies p
             where p.schemaname = 'public'
               and p.tablename = t.tablename
               and p.policyname like 'demo\_deny\_%') <> 3;

    raise exception 'demo lockdown INCOMPLETE: % of % policies present. Unlocked or partial: %',
      policy_count, tables_count * 3, coalesce(gaps, '(none — count mismatch elsewhere)');
  end if;

  raise notice 'demo lockdown VERIFIED: % tables fully locked (% policies).',
    tables_count, policy_count;
end $$;
