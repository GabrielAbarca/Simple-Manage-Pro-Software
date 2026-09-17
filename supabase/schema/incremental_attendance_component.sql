-- ═══════════════════════════════════════════════════════════════
--  incremental_attendance_component.sql
--
--  REAC 2026 makes attendance 5% of every subject's grade, so one grade
--  category per gradebook has to be scored from the attendance record
--  instead of from assignment points.
--
--  Nothing in the schema could say which category that is: both
--  `grade_categories` and `grade_component_template_items` were name +
--  weight only, and names drift (the MEP template ships "Cotidiano" while
--  the instantiated category reads "Trabajo cotidiano"), so matching on
--  the literal string is not safe. Hence `kind`.
--
--  Defaults to 'assignments', which is exactly today's behaviour — every
--  existing row keeps scoring from assignment points and no grade moves
--  until a school marks a category as the attendance one.
--
--  Already inlined in school_schema.sql for fresh per-school projects.
--  Apply this snippet by hand to a project that predates it — see
--  docs/ONBOARDING_RUNBOOK.md. Idempotent: safe to re-run.
--
--  Re-run demo_lockdown.sql on the demo project afterwards; the view
--  changes here, so rls_audit.sql is worth a pass too.
-- ═══════════════════════════════════════════════════════════════

alter table public.grade_categories
  add column if not exists kind text not null default 'assignments';
alter table public.grade_component_template_items
  add column if not exists kind text not null default 'assignments';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'grade_categories_kind_check'
  ) then
    alter table public.grade_categories
      add constraint grade_categories_kind_check
      check (kind in ('assignments', 'attendance'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'gcti_kind_check'
  ) then
    alter table public.grade_component_template_items
      add constraint gcti_kind_check
      check (kind in ('assignments', 'attendance'));
  end if;
end $$;

-- At most one attendance component per gradebook: two would each claim the
-- same attendance record and double-count it in the weighted score.
create unique index if not exists grade_categories_one_attendance_per_cst
  on public.grade_categories (class_subject_teacher_id)
  where kind = 'attendance';
