-- ═══════════════════════════════════════════════════════════════
--  rls_audit.sql — prove row-level security actually holds
-- ═══════════════════════════════════════════════════════════════
--
--  WHAT THIS IS FOR
--  RLS is the only thing standing between one school's records and
--  another user's browser. It is configuration, not code, so it is not
--  covered by the test suite and it drifts silently — a policy dropped
--  during a migration looks exactly like a policy that was never needed.
--  This script proves the important claims are still true, on demand,
--  against a real project:
--
--    · an anonymous visitor reads nothing
--    · a student reads their own records and no other student's
--    · a student cannot write anything, including their own grades
--    · a teacher reads and grades only the classes they teach
--    · a teacher is refused every admin surface
--    · an admin can still do their job
--    · where the demo lockdown is installed, nobody writes at all
--
--  HOW TO RUN
--    Supabase Dashboard → SQL Editor → paste the whole file → Run.
--    Or: psql "$DB_URL" -f supabase/schema/rls_audit.sql
--
--  It runs inside a transaction that ALWAYS rolls back. It creates test
--  users and a small fictional school, asserts against them, and leaves
--  nothing behind. Safe on a project with real data — but prefer a
--  staging or freshly restored project, because a failed assertion
--  aborts the transaction and you want the report, not a rescue.
--
--  READING THE OUTPUT
--    Every check prints `PASS [name]`. The first failure raises and
--    aborts — that message names the check that broke. Success ends
--    with `RLS AUDIT: ALL CHECKS PASSED`. No summary line means it did
--    not finish, so treat a silent run as a failure.
--
--  IF auth.users IS NOT WRITABLE on your project, the fixture block will
--  fail on the first insert. Fallback: create five users by hand in
--  Dashboard → Authentication, then replace the five UUID literals in
--  the `_audit_ids` block below with the real ones and delete the
--  `insert into auth.users` statement.
--
--  Expects supabase/schema/incremental_teacher_policies.sql to be
--  applied. Without it every teacher check fails by design — that is the
--  bug it exists to catch, not a flaw in this script.
-- ═══════════════════════════════════════════════════════════════

begin;

-- ── Personas ───────────────────────────────────────────────────
-- Fixed, obviously-synthetic UUIDs so the impersonation blocks below can
-- use literals and stay readable.
create temporary table _audit_ids (who text primary key, uid uuid) on commit drop;
insert into _audit_ids values
  ('admin',    '00000000-0000-4000-a000-00000000ad11'),
  ('teacher',  '00000000-0000-4000-a000-000000007ea1'),
  ('teacher2', '00000000-0000-4000-a000-000000007ea2'),
  ('studentA', '00000000-0000-4000-a000-00000000c0a1'),
  ('studentB', '00000000-0000-4000-a000-00000000c0b2');

-- ── Assertion helpers ──────────────────────────────────────────
-- Created as the privileged session role; called later while impersonating.
-- SECURITY INVOKER (the default) is essential — they must see exactly what
-- the impersonated role sees.

create or replace function pg_temp._expect_rows(label text, q text, want bigint)
returns void language plpgsql as $fn$
declare got bigint;
begin
  execute 'select count(*) from (' || q || ') _sub' into got;
  if got <> want then
    raise exception 'FAIL [%]: expected % row(s), got % — query: %', label, want, got, q;
  end if;
  raise notice 'PASS [%]  (% row(s))', label, got;
end $fn$;

-- A write is "denied" either loudly (42501, insufficient_privilege — how a
-- blocked INSERT or a WITH CHECK violation surfaces) or quietly (zero rows
-- touched, because a USING clause hid the target from an UPDATE/DELETE).
-- Both mean the caller could not change the data, so both pass.
create or replace function pg_temp._expect_denied(label text, stmt text)
returns void language plpgsql as $fn$
declare n bigint;
begin
  begin
    execute stmt;
    get diagnostics n = row_count;
    if n > 0 then
      raise exception 'FAIL [%]: write was ALLOWED (% row(s) affected) — %', label, n, stmt;
    end if;
    raise notice 'PASS [%]  (blocked: no rows affected)', label;
  exception
    when insufficient_privilege then
      raise notice 'PASS [%]  (blocked: 42501)', label;
  end;
end $fn$;

create or replace function pg_temp._expect_allowed(label text, stmt text)
returns void language plpgsql as $fn$
declare n bigint;
begin
  execute stmt;
  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'FAIL [%]: write affected no rows (policy hid the target?) — %', label, stmt;
  end if;
  raise notice 'PASS [%]  (% row(s) written)', label, n;
exception
  when insufficient_privilege then
    raise exception 'FAIL [%]: write was DENIED (42501) but should be allowed — %', label, stmt;
end $fn$;

-- ── Fixture: one small fictional school ────────────────────────
-- Runs as the session role, which owns the tables and therefore bypasses
-- RLS — exactly how an admin-provisioned project gets seeded.
do $$
declare
  v_year int; v_grade int; v_subject int;
  v_class_a int; v_class_b int;
  v_teacher int; v_teacher2 int;
  v_cst_a int; v_cst_b int;
  v_student_a int; v_student_b int;
  v_period int; v_assignment int;
begin
  insert into auth.users (id, email)
  select uid, who || '@rls-audit.invalid' from _audit_ids;

  -- handle_new_user() created the profiles rows; set the roles under test.
  update public.profiles set role = 'admin'
   where id = (select uid from _audit_ids where who = 'admin');
  update public.profiles set role = 'teacher'
   where id in (select uid from _audit_ids where who in ('teacher', 'teacher2'));
  update public.profiles set role = 'student'
   where id in (select uid from _audit_ids where who in ('studentA', 'studentB'));

  insert into public.school_years (name, start_date, end_date, is_active)
    values ('RLS Audit Year', date '2400-02-01', date '2400-11-30', false)
    returning id into v_year;
  insert into public.grade_levels (name, numeric_level)
    values ('RLS Audit Grade', 999) returning id into v_grade;
  insert into public.subjects (name, code)
    values ('RLS Audit Subject', 'RLSA') returning id into v_subject;

  insert into public.teachers (first_name, last_name, email, auth_user_id)
    values ('Audit', 'TeacherOne', 't1@rls-audit.invalid',
            (select uid from _audit_ids where who = 'teacher'))
    returning id into v_teacher;
  insert into public.teachers (first_name, last_name, email, auth_user_id)
    values ('Audit', 'TeacherTwo', 't2@rls-audit.invalid',
            (select uid from _audit_ids where who = 'teacher2'))
    returning id into v_teacher2;

  -- Class A belongs to teacher one; class B to teacher two. Everything the
  -- teacher checks assert comes down to this boundary.
  insert into public.classes (school_year_id, grade_level_id, section, homeroom_teacher_id)
    values (v_year, v_grade, 'RA', v_teacher) returning id into v_class_a;
  insert into public.classes (school_year_id, grade_level_id, section, homeroom_teacher_id)
    values (v_year, v_grade, 'RB', v_teacher2) returning id into v_class_b;

  insert into public.class_subject_teachers (class_id, subject_id, teacher_id, school_year_id)
    values (v_class_a, v_subject, v_teacher, v_year) returning id into v_cst_a;
  insert into public.class_subject_teachers (class_id, subject_id, teacher_id, school_year_id)
    values (v_class_b, v_subject, v_teacher2, v_year) returning id into v_cst_b;

  insert into public.students
    (first_name, last_name, enrollment_number, class_id, auth_user_id)
    values ('Audit', 'StudentA', 'RLS-A-001', v_class_a,
            (select uid from _audit_ids where who = 'studentA'))
    returning id into v_student_a;
  insert into public.students
    (first_name, last_name, enrollment_number, class_id, auth_user_id)
    values ('Audit', 'StudentB', 'RLS-B-001', v_class_b,
            (select uid from _audit_ids where who = 'studentB'))
    returning id into v_student_b;

  insert into public.grading_periods
    (school_year_id, name, start_date, end_date, period_order)
    values (v_year, 'RLS P1', date '2400-02-01', date '2400-05-31', 991)
    returning id into v_period;

  insert into public.assignments
    (class_subject_teacher_id, grading_period_id, name, max_score)
    values (v_cst_a, v_period, 'RLS Audit Quiz', 100) returning id into v_assignment;
  insert into public.assignment_grades (assignment_id, student_id, score)
    values (v_assignment, v_student_a, 80);

  insert into public.attendance (student_id, class_id, date, status)
    values (v_student_a, v_class_a, date '2400-03-01', 'present');
  insert into public.attendance (student_id, class_id, date, status)
    values (v_student_b, v_class_b, date '2400-03-01', 'absent');

  insert into public.student_grades
    (student_id, class_subject_teacher_id, grading_period_id, score)
    values (v_student_a, v_cst_a, v_period, 80);

  insert into public.discipline_records (student_id, date, type, description, reported_by_teacher)
    values (v_student_a, date '2400-03-02', 'RLS Audit', 'fixture', v_teacher);

  -- Stash the ids so the impersonation blocks can find them by name.
  create temporary table _audit_fx (k text primary key, v int) on commit drop;
  insert into _audit_fx values
    ('year', v_year), ('grade', v_grade), ('subject', v_subject),
    ('class_a', v_class_a), ('class_b', v_class_b),
    ('teacher', v_teacher), ('teacher2', v_teacher2),
    ('cst_a', v_cst_a), ('cst_b', v_cst_b),
    ('student_a', v_student_a), ('student_b', v_student_b),
    ('period', v_period), ('assignment', v_assignment);

  raise notice '--- fixture ready (year %, classes %/%, students %/%) ---',
    v_year, v_class_a, v_class_b, v_student_a, v_student_b;
end $$;

-- Impersonation reads these, and they must survive the role switch.
grant select on _audit_ids, _audit_fx to anon, authenticated;

-- ═══════════════════════════════════════════════════════════════
--  1. Anonymous visitor — reads nothing, writes nothing
-- ═══════════════════════════════════════════════════════════════
set local request.jwt.claims = '{"role":"anon"}';
set local role anon;

do $$
begin
  perform pg_temp._expect_rows('anon cannot read students',
    'select 1 from public.students', 0);
  perform pg_temp._expect_rows('anon cannot read grades',
    'select 1 from public.student_grades', 0);
  perform pg_temp._expect_rows('anon cannot read attendance',
    'select 1 from public.attendance', 0);
  perform pg_temp._expect_rows('anon cannot read profiles',
    'select 1 from public.profiles', 0);
  perform pg_temp._expect_rows('anon cannot read discipline',
    'select 1 from public.discipline_records', 0);
  perform pg_temp._expect_denied('anon cannot insert a student',
    'insert into public.students (first_name, last_name, enrollment_number)
       values (''Anon'', ''Intruder'', ''RLS-X-999'')');
end $$;
reset role;

-- ═══════════════════════════════════════════════════════════════
--  2. Student A — own records only, and strictly read-only
-- ═══════════════════════════════════════════════════════════════
set local request.jwt.claims = '{"sub":"00000000-0000-4000-a000-00000000c0a1","role":"authenticated"}';
set local role authenticated;

do $$
declare
  student_b int := (select v from _audit_fx where k = 'student_b');
  class_a    int := (select v from _audit_fx where k = 'class_a');
  teacher    int := (select v from _audit_fx where k = 'teacher');
begin
  -- Sees exactly one student: themselves.
  perform pg_temp._expect_rows('student sees only their own student row',
    'select 1 from public.students', 1);
  perform pg_temp._expect_rows('student cannot see another student by id',
    format('select 1 from public.students where id = %s', student_b), 0);

  perform pg_temp._expect_rows('student sees their own attendance only',
    'select 1 from public.attendance', 1);
  perform pg_temp._expect_rows('student sees their own period grades only',
    'select 1 from public.student_grades', 1);
  perform pg_temp._expect_rows('student sees their own discipline only',
    'select 1 from public.discipline_records', 1);
  perform pg_temp._expect_rows('student sees only their own profile',
    'select 1 from public.profiles', 1);

  -- Reference data stays readable — the portal needs it to render.
  perform pg_temp._expect_rows('student can read subjects (reference data)',
    'select 1 from public.subjects', 1);

  -- The teachers table was the leak: any signed-in user could read every
  -- teacher's national_id, address, phone and hire_date (RLS restricts rows,
  -- not columns, and the old policy had no row restriction either). Now the
  -- row itself is invisible to a student, so a select naming any of these
  -- columns comes back empty rather than just "column not requested".
  perform pg_temp._expect_rows('student cannot read a teacher''s national_id',
    format('select national_id from public.teachers where id = %s', teacher), 0);
  perform pg_temp._expect_rows('student cannot read a teacher''s address',
    format('select address from public.teachers where id = %s', teacher), 0);
  perform pg_temp._expect_rows('student cannot read a teacher''s phone',
    format('select phone from public.teachers where id = %s', teacher), 0);
  perform pg_temp._expect_rows('student cannot read a teacher''s hire_date',
    format('select hire_date from public.teachers where id = %s', teacher), 0);
  -- The PII-free directory view is still readable — the Teachers tab works.
  perform pg_temp._expect_rows('student can read the teacher directory (no PII)',
    'select 1 from public.teachers_directory', 2);

  -- Nothing is writable, including their own record.
  perform pg_temp._expect_denied('student cannot change their own grade',
    'update public.student_grades set score = 100');
  perform pg_temp._expect_denied('student cannot edit their own student row',
    'update public.students set first_name = ''Renamed''');
  perform pg_temp._expect_denied('student cannot record attendance',
    format('insert into public.attendance (student_id, class_id, date, status)
              values (%s, %s, date ''2400-04-01'', ''present'')',
           (select v from _audit_fx where k = 'student_a'), class_a));
  perform pg_temp._expect_denied('student cannot create a subject',
    'insert into public.subjects (name) values (''Student Made This'')');
  perform pg_temp._expect_denied('student cannot delete their discipline record',
    'delete from public.discipline_records');
  perform pg_temp._expect_denied('student cannot promote themselves to admin',
    'update public.profiles set role = ''admin''');
end $$;
reset role;

-- ═══════════════════════════════════════════════════════════════
--  3. Teacher — scoped to their own classes, refused admin surfaces
-- ═══════════════════════════════════════════════════════════════
set local request.jwt.claims = '{"sub":"00000000-0000-4000-a000-000000007ea1","role":"authenticated"}';
set local role authenticated;

do $$
declare
  student_a  int := (select v from _audit_fx where k = 'student_a');
  student_b  int := (select v from _audit_fx where k = 'student_b');
  class_a    int := (select v from _audit_fx where k = 'class_a');
  class_b    int := (select v from _audit_fx where k = 'class_b');
  cst_a      int := (select v from _audit_fx where k = 'cst_a');
  cst_b      int := (select v from _audit_fx where k = 'cst_b');
  period     int := (select v from _audit_fx where k = 'period');
  year       int := (select v from _audit_fx where k = 'year');
  teacher2   int := (select v from _audit_fx where k = 'teacher2');
  demo_locked boolean := exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'attendance'
       and policyname = 'demo_deny_insert');
begin
  -- Reads: own class yes, other class no.
  perform pg_temp._expect_rows('teacher reads students in their own class',
    format('select 1 from public.students where id = %s', student_a), 1);
  perform pg_temp._expect_rows('teacher cannot read a student from another class',
    format('select 1 from public.students where id = %s', student_b), 0);
  perform pg_temp._expect_rows('teacher sees exactly one student overall',
    'select 1 from public.students', 1);
  perform pg_temp._expect_rows('teacher reads attendance for their class only',
    'select 1 from public.attendance', 1);
  perform pg_temp._expect_rows('teacher reads discipline for their students only',
    'select 1 from public.discipline_records', 1);

  -- The gradebook view must respect the same boundary.
  perform pg_temp._expect_rows('teacher sees only their own rows in student_period_grades',
    format('select 1 from public.student_period_grades where class_subject_teacher_id = %s', cst_b), 0);

  -- Self-read on `teachers` must survive the narrowed policy (the Settings
  -- view reads their own national_id/phone/address/hire_date) — but a
  -- colleague's PII must stay just as invisible as a student's would be.
  perform pg_temp._expect_rows('teacher reads their own full teacher record',
    'select 1 from public.teachers where auth_user_id = auth.uid()', 1);
  perform pg_temp._expect_rows('teacher cannot read a colleague''s national_id',
    format('select national_id from public.teachers where id = %s', teacher2), 0);

  -- Writes inside their own classes. On the demo project the lockdown
  -- outranks every permissive policy, so there the same three writes must
  -- be refused — a demo teacher gets the console, not the database.
  if demo_locked then
    raise notice '--- demo lockdown detected: teacher writes must be refused too ---';
    perform pg_temp._expect_denied('demo lockdown blocks teacher attendance',
      format('insert into public.attendance (student_id, class_id, date, status)
                values (%s, %s, date ''2400-04-02'', ''late'')', student_a, class_a));
    perform pg_temp._expect_denied('demo lockdown blocks teacher assignment',
      format('insert into public.assignments
                (class_subject_teacher_id, grading_period_id, name, max_score)
                values (%s, %s, ''Teacher Made This'', 50)', cst_a, period));
    perform pg_temp._expect_denied('demo lockdown blocks teacher grading',
      format('update public.student_grades set score = 91
               where class_subject_teacher_id = %s', cst_a));
  else
    perform pg_temp._expect_allowed('teacher records attendance for their class',
      format('insert into public.attendance (student_id, class_id, date, status)
                values (%s, %s, date ''2400-04-02'', ''late'')', student_a, class_a));
    perform pg_temp._expect_allowed('teacher creates an assignment on their subject',
      format('insert into public.assignments
                (class_subject_teacher_id, grading_period_id, name, max_score)
                values (%s, %s, ''Teacher Made This'', 50)', cst_a, period));
    perform pg_temp._expect_allowed('teacher updates a period grade for their subject',
      format('update public.student_grades set score = 91
               where class_subject_teacher_id = %s', cst_a));
  end if;

  -- Writes outside them.
  perform pg_temp._expect_denied('teacher cannot record attendance for another class',
    format('insert into public.attendance (student_id, class_id, date, status)
              values (%s, %s, date ''2400-04-02'', ''present'')', student_b, class_b));
  perform pg_temp._expect_denied('teacher cannot create an assignment on another teacher''s subject',
    format('insert into public.assignments
              (class_subject_teacher_id, grading_period_id, name, max_score)
              values (%s, %s, ''Not Mine'', 50)', cst_b, period));
  perform pg_temp._expect_denied('teacher cannot grade another teacher''s subject',
    format('insert into public.student_grades
              (student_id, class_subject_teacher_id, grading_period_id, score)
              values (%s, %s, %s, 100)', student_b, cst_b, period));

  -- Admin surfaces stay closed.
  perform pg_temp._expect_denied('teacher cannot create a school year',
    'insert into public.school_years (name, start_date, end_date)
       values (''Teacher Year'', date ''2401-02-01'', date ''2401-11-30'')');
  perform pg_temp._expect_denied('teacher cannot create a subject',
    'insert into public.subjects (name) values (''Teacher Made This'')');
  perform pg_temp._expect_denied('teacher cannot create a teacher record',
    'insert into public.teachers (first_name, last_name) values (''Fake'', ''Colleague'')');
  perform pg_temp._expect_denied('teacher cannot enroll a student',
    format('insert into public.students (first_name, last_name, enrollment_number, class_id)
              values (''Fake'', ''Student'', ''RLS-X-998'', %s)', class_a));
  perform pg_temp._expect_denied('teacher cannot edit a student record',
    format('update public.students set first_name = ''Renamed'' where id = %s', student_a));
  perform pg_temp._expect_denied('teacher cannot create a class',
    format('insert into public.classes (school_year_id, grade_level_id, section)
              values (%s, %s, ''RX'')', year, (select v from _audit_fx where k = 'grade')));
  perform pg_temp._expect_denied('teacher cannot edit staff records',
    'update public.staff set phone = ''000''');
  perform pg_temp._expect_rows('teacher cannot read staff records',
    'select 1 from public.staff', 0);
  perform pg_temp._expect_denied('teacher cannot promote themselves to admin',
    'update public.profiles set role = ''admin''');
end $$;
reset role;

-- ═══════════════════════════════════════════════════════════════
--  4. Admin — can still run the school
-- ═══════════════════════════════════════════════════════════════
set local request.jwt.claims = '{"sub":"00000000-0000-4000-a000-00000000ad11","role":"authenticated"}';
set local role authenticated;

do $$
declare demo_locked boolean;
begin
  select exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'rooms'
       and policyname = 'demo_deny_insert'
  ) into demo_locked;

  -- Reads are unrestricted either way.
  perform pg_temp._expect_rows('admin reads every student',
    'select 1 from public.students', 2);
  perform pg_temp._expect_rows('admin reads every teacher',
    'select 1 from public.teachers', 2);

  if demo_locked then
    -- On the demo project the lockdown outranks the admin policy. That is
    -- the point of demo_lockdown.sql: nobody writes, not even an admin.
    raise notice '--- demo lockdown detected: asserting writes are refused for everyone ---';
    perform pg_temp._expect_denied('demo lockdown blocks admin insert',
      'insert into public.rooms (name) values (''RLS Audit Room'')');
    perform pg_temp._expect_denied('demo lockdown blocks admin update',
      'update public.school_settings set name = ''Renamed By Audit'' where id = 1');
    perform pg_temp._expect_denied('demo lockdown blocks admin delete',
      'delete from public.subjects');
  else
    raise notice '--- no demo lockdown (school project): asserting admin can write ---';
    perform pg_temp._expect_allowed('admin creates a room',
      'insert into public.rooms (name) values (''RLS Audit Room'')');
    perform pg_temp._expect_allowed('admin renames that room',
      'update public.rooms set name = ''RLS Audit Room 2'' where name = ''RLS Audit Room''');
    perform pg_temp._expect_allowed('admin deletes that room',
      'delete from public.rooms where name = ''RLS Audit Room 2''');
    perform pg_temp._expect_allowed('admin enrolls a student',
      format('insert into public.students (first_name, last_name, enrollment_number, class_id)
                values (''Audit'', ''StudentC'', ''RLS-C-001'', %s)',
             (select v from _audit_fx where k = 'class_a')));
  end if;
end $$;
reset role;

-- ═══════════════════════════════════════════════════════════════
--  Summary
-- ═══════════════════════════════════════════════════════════════
do $$
begin
  raise notice ' ';
  raise notice '═══════════════════════════════════════════════';
  raise notice ' RLS AUDIT: ALL CHECKS PASSED';
  raise notice ' Rolling back — no fixture data is kept.';
  raise notice '═══════════════════════════════════════════════';
end $$;

rollback;
