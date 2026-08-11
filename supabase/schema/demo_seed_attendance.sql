-- ═══════════════════════════════════════════════════════════════
--  Demo attendance — the current month
--  ⚠ DEMO PROJECT ONLY — never run this on a school project.
-- ═══════════════════════════════════════════════════════════════
--
-- The admin console's overview reports an attendance rate for the current
-- month. The demo carried 21 attendance rows pinned to two fixed dates in
-- August 2026, so outside those two days the tile had nothing to average and
-- showed "Sin datos" — a school-management demo whose attendance feature
-- appeared to do nothing.
--
-- This fills the current month with a plausible register so the feature can
-- actually be seen working.
--
-- WHY IT IS SAFE TO RE-RUN, AND WHY IT NEVER GOES STALE
--   The window is derived from current_date, not hardcoded: every run tops up
--   the month it is run in. `on conflict do nothing` against the two uniques
--   on attendance — (student_id, date) and (student_id, class_id, date) —
--   makes a repeat run a no-op rather than a duplicate-key failure, and means
--   this never overwrites a row the demo already had (including the 21
--   originals, which it leaves exactly as they are).
--
-- WHY THE SPREAD IS DETERMINISTIC
--   Statuses come from a hash of (student_id, date), not random(). Two
--   visitors loading the demo an hour apart see the same percentage, and a
--   re-run does not reshuffle history under a visitor mid-session.
--
-- WHAT IT WILL NOT DO
--   · weekends — Costa Rican colegios do not take attendance on Sat/Sun
--   · dates outside the active curso lectivo — demo_seed_costa_rica.sql
--     asserts nothing falls outside the year, so the window is clamped to it
--   · future dates — the register stops at today
--   · inactive students, or students with no seccion assigned
--
-- HOW TO RUN
--   Supabase Dashboard → SQL Editor → paste → Run, on the DEMO project.
--   One DO block, so it is atomic. It refuses to run on a project without the
--   demo_deny_* lockdown and demo_teacher_id(), so the DEMO-ONLY warning above
--   is enforced rather than advisory.
--
--   Re-running demo_lockdown.sql afterwards is NOT needed: this adds no tables.
-- ═══════════════════════════════════════════════════════════════

do $$
declare
  y_start   date;
  y_end     date;
  win_from  date;
  win_to    date;
  inserted  integer;
  n         integer;
  rate      numeric;
begin
  -- ── 0. Refuse to run anywhere but the demo ──────────────────
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and policyname = 'demo_deny_insert'
  ) then
    raise exception
      'REFUSING TO RUN: no demo_deny_* policies on this project. '
      'This does not look like the demo — check the project ref.';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname = 'demo_teacher_id'
  ) then
    raise exception
      'REFUSING TO RUN: demo_teacher_id() is missing. That RPC exists only on '
      'the demo project — check the project ref.';
  end if;

  -- ── 1. The window ───────────────────────────────────────────
  -- Clamped to the active curso lectivo at both ends: demo_seed_costa_rica.sql
  -- asserts no attendance falls outside the year, and a run in January would
  -- otherwise place rows before it starts.
  select start_date, end_date into y_start, y_end
    from public.school_years where is_active order by id limit 1;
  if y_start is null then
    raise exception 'no active school year on this project — nothing to seed against';
  end if;

  win_from := greatest(date_trunc('month', current_date)::date, y_start);
  win_to   := least(current_date, y_end);

  if win_from > win_to then
    raise notice
      'Nothing to seed: today (%) is outside the curso lectivo (% → %). '
      'This is not an error — the demo simply has no school days this month.',
      current_date, y_start, y_end;
    return;
  end if;

  -- ── 2. The register ─────────────────────────────────────────
  -- One row per active student per weekday in the window. The status comes
  -- from a stable hash of (student_id, date) bucketed 0-99, weighted to look
  -- like a real month: ~91% present, ~4% late, ~3% absent, ~2% excused.
  --
  -- recorded_by is left null deliberately — it is nullable, and pinning it to
  -- a teacher would claim a specific person took every register in the school.
  with school_days as (
    select d::date as day
      from generate_series(win_from, win_to, interval '1 day') as d
     where extract(isodow from d) between 1 and 5   -- Mon-Fri
  ),
  roster as (
    select id as student_id, class_id
      from public.students
     where status = 'active' and class_id is not null
  ),
  register as (
    select
      r.student_id,
      r.class_id,
      s.day,
      -- hashtext can be negative; abs() then mod for a stable 0-99 bucket.
      (abs(hashtext(r.student_id::text || s.day::text)) % 100) as bucket
      from roster r cross join school_days s
  )
  insert into public.attendance (student_id, class_id, date, status)
  select
    student_id,
    class_id,
    day,
    case
      when bucket < 91 then 'present'
      when bucket < 95 then 'late'
      when bucket < 98 then 'absent'
      else 'excused'
    end
    from register
  on conflict do nothing;

  get diagnostics inserted = row_count;

  -- ═══════════════════════════════════════════════════════════
  --  Verification — fails loudly rather than half-applying
  -- ═══════════════════════════════════════════════════════════

  -- The month has something to average.
  select count(*) into n from public.attendance
   where date between win_from and win_to;
  if n = 0 then
    raise exception
      'VERIFY FAILED: no attendance rows in % → % after seeding. Are there '
      'active students with a seccion assigned?', win_from, win_to;
  end if;

  -- The clamp held, so nothing this seed wrote can fall outside the year.
  -- Deliberately an assertion about the window rather than a scan of the whole
  -- table: pre-existing rows outside the year are demo_seed_costa_rica.sql's
  -- to fix, and failing here on drift this seed did not create would block a
  -- routine top-up for an unrelated reason.
  if win_from < y_start or win_to > y_end then
    raise exception
      'VERIFY FAILED: window % → % escaped the curso lectivo % → %',
      win_from, win_to, y_start, y_end;
  end if;

  -- No weekend registers, and nothing dated in the future.
  select count(*) into n from public.attendance
   where date between win_from and win_to
     and (extract(isodow from date) > 5 or date > current_date);
  if n > 0 then
    raise exception
      'VERIFY FAILED: % row(s) in the window fall on a weekend or in the future', n;
  end if;

  -- Every status is one the schema's CHECK allows.
  select count(*) into n from public.attendance
   where status not in ('present', 'absent', 'late', 'excused');
  if n > 0 then
    raise exception 'VERIFY FAILED: % row(s) carry an unknown status', n;
  end if;

  -- The 21 rows the demo already had are untouched.
  select count(*) into n from public.attendance
   where date in ('2026-08-06', '2026-08-07');
  if n <> 21 then
    raise exception
      'VERIFY FAILED: the 21 original attendance rows are no longer intact '
      '(found % on 2026-08-06/07)', n;
  end if;

  -- The read-only lockdown is still on (this seed must not have loosened it).
  select count(*) into n from pg_policies
   where schemaname = 'public'
     and policyname in ('demo_deny_insert', 'demo_deny_update', 'demo_deny_delete');
  if n <> (select count(*) * 3 from pg_tables where schemaname = 'public') then
    raise exception 'VERIFY FAILED: demo lockdown is no longer complete (% policies)', n;
  end if;

  select round(100.0 * count(*) filter (where status in ('present', 'late'))
               / nullif(count(*), 0), 1)
    into rate
    from public.attendance where date between win_from and win_to;

  raise notice
    'Demo attendance VERIFIED: % row(s) inserted for % → %, % total in the '
    'month, present+late rate % percent.', inserted, win_from, win_to,
    (select count(*) from public.attendance where date between win_from and win_to),
    rate;
end $$;
