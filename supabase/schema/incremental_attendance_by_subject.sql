-- ═══════════════════════════════════════════════════════════════
--  incremental_attendance_by_subject.sql
--
--  Adds a subject dimension to `attendance`. Costa Rica's REAC 2026
--  evaluation regulation makes attendance 5% of every subject's grade,
--  which is impossible to compute against the old shape: one row per
--  student per DAY, with `unique (student_id, class_id, date)` and an
--  even stricter `unique (student_id, date)` on top of it. The second
--  constraint means a student can have at most one attendance record
--  for an entire day across every class they're in.
--
--  That same shape is also a live bug: when two teachers share a
--  section (e.g. Math and Spanish both teaching 3.º-A), whichever one
--  saves attendance second silently overwrites the first teacher's
--  statuses and notes for that day. There is no subject for the app —
--  or the schema — to key on.
--
--  WHAT THIS DOES
--    1. Adds `attendance.class_subject_teacher_id`, nullable, FK to
--       class_subject_teachers(id) — the same FK shape already used by
--       grade_categories, assignments and student_grades.
--    2. Backfills existing rows on a best-effort basis: for each row,
--       find the class_subject_teachers row for the same class/school
--       year whose teacher is that class's homeroom_teacher_id. There
--       is no explicit "this CST is the homeroom one" flag anywhere in
--       the schema, so this is inference, not a real join — rows with
--       no match keep class_subject_teacher_id = null. Nothing is
--       deleted either way; history is preserved.
--    3. Drops both old unique constraints and adds
--       unique (student_id, class_subject_teacher_id, date). Postgres
--       treats NULLs as non-conflicting in a unique constraint, so
--       unmatched legacy rows (null) never collide with each other.
--
--  WHAT THIS DELIBERATELY DOES NOT DO
--    The column stays nullable on purpose. src/js/teacher.js's
--    upsertAttendance does not pass a class_subject_teacher_id yet —
--    that's a separate, later change (threading currentClass.cstId
--    through saveAttendance/upsertAttendance and updating its
--    onConflict target). Until that lands, new rows keep writing with
--    class_subject_teacher_id = null, which this constraint allows.
--    Making the column NOT NULL before that JS change ships would break
--    every attendance save in production.
--
--    demo_lockdown.sql does NOT need to be re-run for this file. It
--    loops over pg_tables and applies its restrictive policies per
--    TABLE, not per column — attendance is already locked, and a new
--    column on an already-locked table inherits that lock for free.
--
--  ORDER OF APPLICATION
--    1. school_schema.sql (or an already-provisioned project)
--    2. this file
--    3. supabase/schema/rls_audit.sql       ← verify
--
--  Idempotent except the final ADD CONSTRAINT, which Postgres has no
--  `IF NOT EXISTS` for — it's wrapped in a guard below so re-running
--  this file is still safe. See docs/ONBOARDING_RUNBOOK.md.
-- ═══════════════════════════════════════════════════════════════

alter table public.attendance
  add column if not exists class_subject_teacher_id integer
    references public.class_subject_teachers(id) on delete set null;

create index if not exists idx_attendance_class_subject_teacher_id
  on public.attendance(class_subject_teacher_id);

-- Best-effort backfill: match each row to the class_subject_teachers row
-- for the same class/school-year taught by that class's homeroom teacher.
-- Deterministic tie-break (lowest id) for the rare case a homeroom teacher
-- teaches more than one subject in their own section. `limit 1` is inside
-- a correlated subquery rather than an UPDATE ... FROM join, specifically
-- so a homeroom teacher with multiple subjects in the section can't turn
-- this into a nondeterministic multi-row match.
update public.attendance a
set class_subject_teacher_id = (
  select cst.id
  from public.class_subject_teachers cst
  join public.classes c on c.id = a.class_id
  where cst.class_id = a.class_id
    and cst.school_year_id = c.school_year_id
    and cst.teacher_id = c.homeroom_teacher_id
  order by cst.id
  limit 1
)
where a.class_subject_teacher_id is null;

alter table public.attendance
  drop constraint if exists attendance_student_id_class_id_date_key,
  drop constraint if exists attendance_student_id_date_key;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.attendance'::regclass
      and conname = 'attendance_student_id_cst_date_key'
  ) then
    alter table public.attendance
      add constraint attendance_student_id_cst_date_key
      unique (student_id, class_subject_teacher_id, date);
  end if;
end $$;
