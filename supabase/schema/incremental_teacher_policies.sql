-- ═══════════════════════════════════════════════════════════════
--  incremental_teacher_policies.sql
--
--  Teacher-scoped row-level security + the gradebook view the teacher
--  console reads.
--
--  WHY THIS EXISTS
--  school_schema.sql ships three kinds of policy: admins can do anything,
--  any authenticated user can read the reference/structure tables, and a
--  student can read their own rows. There is nothing for the `teacher`
--  role — so on a project built from that file alone a teacher cannot read
--  a single student, assignment, or grade, and the teacher console
--  (src/js/teacher.js) is non-functional outside demo mode. This snippet
--  closes that gap.
--
--  THE RULE IT ENCODES
--  A teacher may read and write the academic records of the classes they
--  actually teach — the classes reachable through class_subject_teachers,
--  plus any class where they are the homeroom teacher — and nothing else.
--  Deliberately NOT granted: any write to students, classes, schedules,
--  teachers, or the reference tables. Those are admin surfaces, and
--  supabase/schema/rls_audit.sql asserts a teacher is still refused there.
--
--  Policies are permissive, so they are OR-ed with the admin policies
--  already in place; an admin keeps full access and loses nothing.
--
--  ORDER OF APPLICATION
--    1. school_schema.sql (or an already-provisioned project)
--    2. this file
--    3. supabase/schema/demo_lockdown.sql   ← demo project only
--    4. supabase/schema/rls_audit.sql       ← verify
--
--  Idempotent: safe to re-run. See docs/ONBOARDING_RUNBOOK.md.
-- ═══════════════════════════════════════════════════════════════

-- ── Helpers ────────────────────────────────────────────────────
-- SECURITY DEFINER because a policy on `teachers` would otherwise have to
-- read `teachers` to decide whether you may read `teachers`. Fixed
-- search_path per the same hardening as is_admin() / handle_new_user().
-- EXECUTE stays granted to `authenticated` (policies evaluate as the
-- calling role); `anon` and `public` have no business calling these.

create or replace function public.teacher_id()
returns integer
language sql
stable
security definer
set search_path to 'public'
as $$
  select id from public.teachers where auth_user_id = auth.uid();
$$;

revoke execute on function public.teacher_id() from anon, public;

-- Every class the caller teaches: subject assignments plus homeroom.
create or replace function public.teacher_class_ids()
returns setof integer
language sql
stable
security definer
set search_path to 'public'
as $$
  select cst.class_id
    from public.class_subject_teachers cst
   where cst.teacher_id = public.teacher_id()
  union
  select c.id
    from public.classes c
   where c.homeroom_teacher_id = public.teacher_id();
$$;

revoke execute on function public.teacher_class_ids() from anon, public;

-- Every class_subject_teachers row the caller owns. The gradebook tables
-- hang off this id, so most policies below are one lookup against it.
create or replace function public.teacher_cst_ids()
returns setof integer
language sql
stable
security definer
set search_path to 'public'
as $$
  select id from public.class_subject_teachers where teacher_id = public.teacher_id();
$$;

revoke execute on function public.teacher_cst_ids() from anon, public;

-- ── Students ───────────────────────────────────────────────────
-- Read-only: rosters are an admin surface. A teacher sees a student only
-- while that student sits in one of their classes.
drop policy if exists "Teachers read students in their classes" on public.students;
create policy "Teachers read students in their classes" on public.students
  for select to authenticated
  using (class_id in (select public.teacher_class_ids()));

-- ── Attendance ─────────────────────────────────────────────────
-- Full write access, scoped by class. `with check` mirrors `using` so a
-- teacher cannot move a record into a class they don't teach.
drop policy if exists "Teachers manage attendance for their classes" on public.attendance;
create policy "Teachers manage attendance for their classes" on public.attendance
  for all to authenticated
  using (class_id in (select public.teacher_class_ids()))
  with check (class_id in (select public.teacher_class_ids()));

-- ── Gradebook ──────────────────────────────────────────────────
drop policy if exists "Teachers manage their grade categories" on public.grade_categories;
create policy "Teachers manage their grade categories" on public.grade_categories
  for all to authenticated
  using (class_subject_teacher_id in (select public.teacher_cst_ids()))
  with check (class_subject_teacher_id in (select public.teacher_cst_ids()));

drop policy if exists "Teachers manage their assignments" on public.assignments;
create policy "Teachers manage their assignments" on public.assignments
  for all to authenticated
  using (class_subject_teacher_id in (select public.teacher_cst_ids()))
  with check (class_subject_teacher_id in (select public.teacher_cst_ids()));

-- Grades reach their owner through the assignment.
drop policy if exists "Teachers manage grades on their assignments" on public.assignment_grades;
create policy "Teachers manage grades on their assignments" on public.assignment_grades
  for all to authenticated
  using (assignment_id in (
    select a.id from public.assignments a
     where a.class_subject_teacher_id in (select public.teacher_cst_ids())))
  with check (assignment_id in (
    select a.id from public.assignments a
     where a.class_subject_teacher_id in (select public.teacher_cst_ids())));

drop policy if exists "Teachers manage period grades for their subjects" on public.student_grades;
create policy "Teachers manage period grades for their subjects" on public.student_grades
  for all to authenticated
  using (class_subject_teacher_id in (select public.teacher_cst_ids()))
  with check (class_subject_teacher_id in (select public.teacher_cst_ids()));

-- ── Discipline ─────────────────────────────────────────────────
-- Read anything about their own students; write only in their own name, so
-- one teacher cannot file or rewrite a report attributed to another.
drop policy if exists "Teachers read discipline for their students" on public.discipline_records;
create policy "Teachers read discipline for their students" on public.discipline_records
  for select to authenticated
  using (student_id in (
    select s.id from public.students s
     where s.class_id in (select public.teacher_class_ids())));

drop policy if exists "Teachers file their own discipline reports" on public.discipline_records;
create policy "Teachers file their own discipline reports" on public.discipline_records
  for insert to authenticated
  with check (
    reported_by_teacher = public.teacher_id()
    and student_id in (
      select s.id from public.students s
       where s.class_id in (select public.teacher_class_ids())));

drop policy if exists "Teachers update their own discipline reports" on public.discipline_records;
create policy "Teachers update their own discipline reports" on public.discipline_records
  for update to authenticated
  using (reported_by_teacher = public.teacher_id())
  with check (reported_by_teacher = public.teacher_id());

-- ═══════════════════════════════════════════════════════════════
--  student_period_grades — the gradebook's computed overall score
-- ═══════════════════════════════════════════════════════════════
--
--  This is the definition the demo project has been running, read back with
--  pg_get_viewdef and tracked here rather than reinvented, so a school
--  project grades exactly the way the demo everyone was shown does.
--
--  Contract the client depends on — these column names are load-bearing:
--    student_id, class_subject_teacher_id, grading_period_id,
--    period_score, graded_count, total_assignments
--
--  Scoring:
--    · within a category, points earned ÷ points possible × 100
--      (NOT the average of each assignment's percentage — with mixed
--      max_scores those differ, and a 100-point exam should outweigh a
--      10-point quiz)
--    · categories combine weighted by grade_categories.weight, renormalised
--      over only the categories that have graded work
--    · when no categorised work exists, the same points ratio across every
--      graded assignment
--    · uncategorised work never enters the weighted branch; it only shows up
--      in that fallback
--    · a student with nothing graded produces no row (the LEFT JOIN leaves
--      student_id null, which is why the client filters `student_id is not
--      null` — see teacher.js fetchPeriodGrades)
--
--  ONE DELIBERATE CHANGE from the live demo view: `security_invoker = true`.
--  A view runs as its owner by default, so the demo's copy bypasses RLS —
--  verified on 2026-08-02, where a student account that can see exactly one
--  row in `students` could read 7 students' grades through the view. With
--  security_invoker the view is filtered by the caller's own policies.
--  Requires Postgres 15+. Do not drop this option to match an older project.
--
--  src/js/demoDb.js computePeriodScore mirrors this view for students
--  edited during a demo session, including the attendance component via
--  src/js/attendanceScore.js. The two are expected to agree exactly and
--  test/demoDb.test.js pins the arithmetic; a change to either belongs in
--  the same commit as the other.
--
--  (This note previously recorded a divergence — that the mirror averaged
--  per-assignment percentages rather than taking the points ratio. That
--  was fixed in the mirror some time ago; the note had gone stale.)

create or replace view public.student_period_grades
with (security_invoker = true) as
with base as (
  select
    ag.student_id,
    a.class_subject_teacher_id,
    a.grading_period_id,
    sum(ag.score)   as sum_score,
    sum(a.max_score) as sum_max,
    count(ag.score) as graded_count,
    count(a.id)     as total_assignments
  from public.assignments a
  left join public.assignment_grades ag
         on ag.assignment_id = a.id and ag.score is not null
  group by ag.student_id, a.class_subject_teacher_id, a.grading_period_id
),
-- Only categorised work takes part in the weighted score; the join is inner
-- on purpose. Uncategorised assignments fall through to the points fallback
-- in the final select.
cat as (
  select
    ag.student_id,
    a.class_subject_teacher_id,
    a.grading_period_id,
    gc.weight as cat_weight,
    sum(ag.score) / nullif(sum(a.max_score), 0::numeric) * 100::numeric as cat_pct
  from public.assignments a
  join public.grade_categories gc on gc.id = a.category_id
  join public.assignment_grades ag
       on ag.assignment_id = a.id and ag.score is not null
  group by ag.student_id, a.class_subject_teacher_id, a.grading_period_id,
           a.category_id, gc.weight
),
-- The attendance component (REAC 2026's 5%). A category marked
-- kind = 'attendance' has no assignments, so without this it would drop out
-- of `cat` and its weight would be silently redistributed across the others.
--
-- Three tardías count as one ausencia, MEP's long-standing rule, and an
-- excused absence is left out of both sides rather than counted as attended.
-- The `having` keeps a group whose days are ALL excused from reaching the
-- weighted sum with a null percentage, which would dilute the other
-- categories. Mirrored in src/js/attendanceScore.js — keep the two in step.
att_cat as (
  select
    att.student_id,
    att.class_subject_teacher_id,
    gp.id as grading_period_id,
    gc.weight as cat_weight,
    greatest(
      count(*) filter (where att.status <> 'excused')
        - count(*) filter (where att.status = 'absent')
        - floor(count(*) filter (where att.status = 'late') / 3.0),
      0
    ) / nullif(count(*) filter (where att.status <> 'excused'), 0)
      * 100::numeric as cat_pct
  from public.attendance att
  join public.grading_periods gp
    on att.date between gp.start_date and gp.end_date
  join public.grade_categories gc
    on gc.class_subject_teacher_id = att.class_subject_teacher_id
   and gc.kind = 'attendance'
  -- class_subject_teacher_id is nullable: rows predating the per-subject
  -- migration carry null and cannot be attributed to a subject's grade.
  where att.class_subject_teacher_id is not null
  group by att.student_id, att.class_subject_teacher_id, gp.id, gc.weight
  having count(*) filter (where att.status <> 'excused') > 0
),
-- Renormalised over the categories that actually have graded work, so a
-- period with only one category marked still reads out of 100. Attendance
-- joins that renormalisation on the same footing as any other category.
weighted as (
  select
    student_id,
    class_subject_teacher_id,
    grading_period_id,
    sum(cat_pct * cat_weight) / nullif(sum(cat_weight), 0::numeric) as w_score
  from (
    select student_id, class_subject_teacher_id, grading_period_id,
           cat_weight, cat_pct
      from cat
    union all
    select student_id, class_subject_teacher_id, grading_period_id,
           cat_weight, cat_pct
      from att_cat
  ) every_cat
  group by student_id, class_subject_teacher_id, grading_period_id
)
select
  b.student_id,
  b.class_subject_teacher_id,
  b.grading_period_id,
  round(
    coalesce(
      w.w_score,
      b.sum_score / nullif(b.sum_max, 0::numeric) * 100::numeric
    ), 2) as period_score,
  b.graded_count,
  b.total_assignments
from base b
left join weighted w
       on w.student_id = b.student_id
      and w.class_subject_teacher_id = b.class_subject_teacher_id
      and w.grading_period_id = b.grading_period_id;

-- ── demo_teacher_id() ──────────────────────────────────────────
-- NOT created here on purpose. It is a demo-only RPC that hands the shared
-- demo account a teacher identity (src/js/teacher.js calls it only when
-- DEMO_MODE is on; e2e/fixtures.js stubs it). On a real school project a
-- teacher is resolved from teachers.auth_user_id, and shipping a function
-- that hands out someone else's teacher id would be a hole, not a feature.
