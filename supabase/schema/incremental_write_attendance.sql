-- ═══════════════════════════════════════════════════════════════
--  Write middleware, part 2: attendance
--  Requires incremental_write_guards.sql. School projects only.
-- ═══════════════════════════════════════════════════════════════
--
-- save_attendance replaces the browser's direct upsert on `attendance`.
-- What it checks that the old RLS policy did not:
--   · the CST belongs to the caller (the policy only checked class_id, so a
--     teacher could write under a colleague's subject in a shared section)
--   · every student sits in that CST's class (the policy never looked at
--     student_id at all)
--   · class_id and recorded_by come from the server, not the payload
--   · the date falls inside the CST's school year
--
-- Payload: [{ "student_id": int, "status": text, "notes": text|null }, ...]
--
-- Idempotent: safe to re-run.

create or replace function public.assert_attendance_rows(p_rows jsonb)
returns integer[]
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_ids integer[];
begin
  if jsonb_typeof(p_rows) is distinct from 'array'
     or jsonb_array_length(p_rows) not between 1 and 500 then
    raise exception 'invalid attendance payload' using errcode = '22023';
  end if;
  select array_agg(r.student_id) into v_ids
    from jsonb_to_recordset(p_rows) as r(student_id integer, status text);
  if exists (
       select 1 from jsonb_to_recordset(p_rows) as r(student_id integer, status text)
        where r.student_id is null
           or r.status is null
           or r.status not in ('present', 'absent', 'late', 'excused'))
     or cardinality(v_ids) <> (select count(distinct x) from unnest(v_ids) x) then
    raise exception 'invalid attendance payload' using errcode = '22023';
  end if;
  return v_ids;
end;
$$;

create or replace function public.save_attendance(
  p_cst integer, p_date date, p_rows jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_class integer;
begin
  perform public.assert_not_demo();
  v_class := public.assert_teacher_cst(p_cst);
  perform public.assert_date_in_cst_year(p_cst, p_date);
  perform public.assert_students_in_class(v_class, public.assert_attendance_rows(p_rows));

  insert into public.attendance
    (student_id, class_id, class_subject_teacher_id, date, status, notes, recorded_by)
  select r.student_id, v_class, p_cst, p_date, r.status, nullif(r.notes, ''), public.teacher_id()
    from jsonb_to_recordset(p_rows) as r(student_id integer, status text, notes text)
  on conflict (student_id, class_subject_teacher_id, date) do update
    set status = excluded.status,
        notes = excluded.notes,
        class_id = excluded.class_id,
        recorded_by = excluded.recorded_by;

  perform public.log_write('save', 'attendance', p_cst,
    jsonb_build_object('date', p_date, 'rows', jsonb_array_length(p_rows)));
end;
$$;

comment on function public.save_attendance(integer, date, jsonb) is 'smp:write-rpc';

revoke execute on function public.assert_attendance_rows(jsonb)
  from anon, authenticated, public;
revoke execute on function public.save_attendance(integer, date, jsonb)
  from anon, public;
grant execute on function public.save_attendance(integer, date, jsonb)
  to authenticated;
