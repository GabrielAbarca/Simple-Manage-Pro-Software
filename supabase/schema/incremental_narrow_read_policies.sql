-- ═══════════════════════════════════════════════════════════════
--  incremental_narrow_read_policies.sql
--  Security fix — narrow the blanket `teachers` read policy.
-- ═══════════════════════════════════════════════════════════════
--
--  WHY THIS EXISTS
--  school_schema.sql's "Authenticated can read %s" loop puts `teachers` in the
--  same bucket as pure reference tables (subjects, rooms, grade_levels, ...):
--  `for select using (auth.role() = 'authenticated')`. RLS restricts rows, not
--  columns, so that policy hands every signed-in user — including a student —
--  the whole row: national_id, phone, address, hire_date included. The student
--  portal's own fetchTeachers() does select("*"), so this data already ships to
--  a student's browser today.
--
--  THE FIX
--  Drop the blanket policy on `teachers`. Replace it with:
--    · a self-read policy, so a teacher can still read their OWN full record
--      (the read-only Settings view in teacher.js needs national_id, phone,
--      address, hire_date for the logged-in teacher, and only them)
--    · `teachers_directory`, a PII-free view (id, first_name, last_name,
--      specialization, email, status) for every other legitimate read: the
--      student portal's teacher list, homeroom-teacher name, discipline/
--      attendance recorder name, and the teacher console's own colleague
--      lookups.
--
--  The view is deliberately NOT security_invoker: it must return every teacher
--  row regardless of caller (a directory listing), which the now-narrowed base
--  table policy would no longer allow. That's safe here specifically because
--  the view's column list structurally excludes the PII columns — there is
--  nothing to leak by running as the view owner instead of the caller.
--
--  Admin console CRUD (adminData.js -> Gateway) reads/writes public.teachers
--  directly and is untouched: "Admins have full access to teachers" already
--  covers it, and column privileges are not touched by this file.
--
--  PostgREST embeds a nested resource by tracing a real foreign key to the
--  named table, not to an arbitrary view — so `teachers ( ... )` embedded
--  inside class_subject_teachers / schedules reads no longer resolves for a
--  non-admin, non-self caller. Those call sites move to an explicit batched
--  query against teachers_directory instead (src/js/supabaseQueries.js,
--  src/js/teacher.js) — see the branch's other changes.
--
--  ORDER OF APPLICATION
--    1. school_schema.sql + incremental_teacher_auth_user_id.sql
--       (public.teachers.auth_user_id must already exist)
--    2. this file
--    3. supabase/schema/rls_audit.sql   <- verify
--
--  Idempotent: safe to re-run.
-- ═══════════════════════════════════════════════════════════════

drop policy if exists "Authenticated can read teachers" on public.teachers;

drop policy if exists "Teachers can read their own full record" on public.teachers;
create policy "Teachers can read their own full record" on public.teachers
  for select to authenticated
  using (auth_user_id = auth.uid());

drop view if exists public.teachers_directory;
create view public.teachers_directory as
  select id, first_name, last_name, specialization, email, status
  from public.teachers;

revoke all on public.teachers_directory from anon, public;
grant select on public.teachers_directory to authenticated;
