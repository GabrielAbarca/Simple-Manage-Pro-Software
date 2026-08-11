-- ═══════════════════════════════════════════════════════════════
--  Demo content — Costa Rica
--  ⚠ DEMO PROJECT ONLY — never run this on a school project.
-- ═══════════════════════════════════════════════════════════════
--
-- The public demo was seeded with Venezuelan content: `V-` prefixed cédulas
-- (Venezuela's format), three "Lapso" grading periods ("lapso" is the
-- Venezuelan term; Costa Rica says "periodo"), a September–July school year,
-- and Carnaval as a school holiday. The product claims to be built for Costa
-- Rica, and the demo is what a visitor actually sees, so the demo has to say
-- the same thing the source does.
--
-- WHAT THIS CHANGES
--   · school identity — a name at all (it was NULL) + id_label 'Cédula'
--   · school year     — '2026', Feb→Dec, the CR *curso lectivo* shape
--   · grading periods — two periodos at 50/50, replacing three lapsos
--   · grade levels    — Décimo / Undécimo / Duodécimo
--   · people          — CR names with two apellidos, cédula-format ids
--   · events          — the CR school calendar, no lapso references
--   · stray dates     — rows left in 2024/2025 pulled into the 2026 year
--
-- WHY 10th–12th GRADE IS CORRECT HERE
--   Costa Rica's *académica* track ends at undécimo (11th). The *técnico*
--   track runs a twelfth year, so this demo is a Colegio Técnico Profesional
--   and its existing 10/11/12 structure is right as-is rather than needing
--   to be renumbered.
--
-- WHY IT IS ALL UPDATE AND NEVER DELETE-AND-REINSERT
--   students.auth_user_id backs the demo student login, and
--   app_config.demo_teacher_id pins a teacher row by id (teacher 1). Editing
--   in place keeps those links and every FK in attendance, student_grades,
--   schedules and class_subject_teachers intact.
--
-- IT HAS ALREADY BEEN APPLIED, AND THE DEMO HAS MOVED ON SINCE
--   This is a one-time migration off the Venezuelan content, and the demo has
--   long since run it. What the demo did next is the reason this file needed
--   revisiting: it grew from 11 students to 90, from 38 grades to 1080, and
--   its calendar was curated by hand (the curso lectivo now closes December 9,
--   not the 18th this file first wrote, and II Periodo opens July 20).
--
--   So two classes of assumption had to go. The closing checks used to assert
--   absolute row counts — "expected 11 students" — which turned ordinary
--   growth into 'VERIFY FAILED' on a seed that advertises itself as safe to
--   re-run. They now compare against a baseline taken at the top of this block,
--   which is what "nothing was lost" actually means. And the year and periodo
--   dates are no longer rewritten wholesale: a calendar that already runs
--   Feb→Dec keeps its own, and only the opening date is corrected.
--
--   Re-running it today is a no-op that verifies. It is kept runnable so a
--   fresh demo project can still be localized from scratch.
--
-- HOW TO RUN
--   Supabase Dashboard → SQL Editor → paste → Run, on the DEMO project.
--   One DO block, so it is atomic: any failed assertion rolls the whole thing
--   back rather than leaving the demo half-localized. Idempotent — re-running
--   finds nothing left to change and passes its own checks.
--
--   It refuses to run on a project without the demo_deny_* lockdown and
--   demo_teacher_id(), so the DEMO-ONLY warning above is enforced, not just
--   advisory. Re-running demo_lockdown.sql afterwards is NOT needed: this
--   adds no tables.
--
-- Names here are invented. Do not substitute a real Costa Rican school's
-- name or a real person's — this is a public demo.
-- ═══════════════════════════════════════════════════════════════

do $$
declare
  y_id     integer;
  y_start  date;
  y_end    date;
  reshaped boolean;
  blockers integer;
  bad      integer;
  n        integer;
  -- Row counts taken before the first mutation and compared again at the end.
  -- See the "nothing was lost" check for why these are measured, not literals.
  pre_students   integer;
  pre_teachers   integer;
  pre_guardians  integer;
  pre_staff      integer;
  pre_grades     integer;
  pre_attendance integer;
  pre_events     integer;
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

  -- ── 0b. Baseline ────────────────────────────────────────────
  -- Taken before anything is written, so the closing checks can prove this run
  -- destroyed nothing without needing to know how big the demo happens to be.
  select count(*) into pre_students   from public.students;
  select count(*) into pre_teachers   from public.teachers;
  select count(*) into pre_guardians  from public.guardians;
  select count(*) into pre_staff      from public.staff;
  select count(*) into pre_grades     from public.student_grades;
  select count(*) into pre_attendance from public.attendance;
  select count(*) into pre_events     from public.events;

  -- ── 1. School identity ──────────────────────────────────────
  -- Both columns were NULL, so the demo rendered a nameless school and the
  -- default ID label. Setting id_label also exercises the per-school label.
  update public.school_settings
     set name     = 'Colegio Técnico Profesional SMP',
         id_label = 'Cédula'
   where id = 1;

  -- ── 2. School year ──────────────────────────────────────────
  -- CR's curso lectivo is one calendar year, February to December — not the
  -- Sep→Jul span the demo carried. 2026 opened on February 23 per the MEP
  -- calendar, which is the date the demo's "Inicio del curso lectivo" and its
  -- I Periodo both start on.
  select id, start_date, end_date into y_id, y_start, y_end
    from public.school_years where is_active order by id limit 1;
  if y_id is null then
    raise exception 'no active school year on this project — nothing to seed against';
  end if;

  -- Reshape only a year that is not already a curso lectivo. This migration has
  -- been applied to the demo for some time, and the demo's calendar has been
  -- curated since — its year now closes December 9, not the 18th this file
  -- first wrote, and II Periodo opens July 20. Rewriting those wholesale would
  -- undo somebody's deliberate work, so a year that already runs Feb→Dec keeps
  -- its own dates and only has the opening corrected, which is the one value
  -- this file is authoritative for (MEP opened 2026 on February 23).
  reshaped := extract(month from y_start) <> 2 or extract(month from y_end) <> 12;

  -- Widened before the periods below: grading_period_within_year() fires on
  -- period writes, so the parent year has to be able to contain them first.
  if reshaped then
    update public.school_years
       set name = '2026', start_date = '2026-02-23', end_date = '2026-12-18'
     where id = y_id;
  else
    update public.school_years
       set start_date = '2026-02-23'
     where id = y_id and start_date <> '2026-02-23';
  end if;

  select start_date, end_date into y_start, y_end
    from public.school_years where id = y_id;

  -- ── 3. Two periodos, 50/50 ──────────────────────────────────
  -- Dropping a period is destructive by schema design: student_grades
  -- cascades from grading_periods and assignments restrict it. Assert the
  -- extra periods are empty rather than trusting they are.
  select count(*) into blockers
    from public.assignments a
    join public.grading_periods g on g.id = a.grading_period_id
   where g.school_year_id = y_id and g.period_order > 2;
  if blockers > 0 then
    raise exception
      'REFUSING TO DELETE: period_order > 2 still carries % assignment(s). '
      'Move or remove them first.', blockers;
  end if;

  select count(*) into blockers
    from public.student_grades sg
    join public.grading_periods g on g.id = sg.grading_period_id
   where g.school_year_id = y_id and g.period_order > 2;
  if blockers > 0 then
    raise exception
      'REFUSING TO DELETE: period_order > 2 still carries % grade(s), which '
      'would cascade away. Move or remove them first.', blockers;
  end if;

  delete from public.grading_periods
   where school_year_id = y_id and period_order > 2;

  -- Same rule as the year above: the naming and the 50/50 split are this
  -- file's to enforce, but on a calendar that is already CR-shaped the dates
  -- belong to whoever curated it. I Periodo is the exception — it opens with
  -- the curso lectivo by definition, so it tracks the year's start either way.
  if reshaped then
    update public.grading_periods
       set name = 'I Periodo', start_date = y_start,
           end_date = '2026-07-03', weight = 50.00
     where school_year_id = y_id and period_order = 1;

    update public.grading_periods
       set name = 'II Periodo', start_date = '2026-07-13',
           end_date = y_end, weight = 50.00
     where school_year_id = y_id and period_order = 2;
  else
    update public.grading_periods
       set name = 'I Periodo', start_date = y_start, weight = 50.00
     where school_year_id = y_id and period_order = 1;

    update public.grading_periods
       set name = 'II Periodo', weight = 50.00
     where school_year_id = y_id and period_order = 2;
  end if;

  -- ── 4. Grade levels ─────────────────────────────────────────
  update public.grade_levels set name = 'Décimo'    where numeric_level = 10;
  update public.grade_levels set name = 'Undécimo'  where numeric_level = 11;
  update public.grade_levels set name = 'Duodécimo' where numeric_level = 12;

  -- ── 5. People ───────────────────────────────────────────────
  -- Costa Rican given names (including the English-derived ones that are
  -- genuinely common there — Kenneth, Randall, Jefferson, Yendry) and two
  -- apellidos per person, paterno then materno, which the existing
  -- first_name/last_name columns already accommodate.
  --
  -- Student 11 is the repository owner's own record; only its cédula is
  -- filled in, its name is left alone deliberately.
  update public.students s
     set first_name = v.first_name,
         last_name  = v.last_name
    from (values
      (1,  'Yendry',    'Rojas Vargas'),
      (2,  'Kenneth',   'Villalobos Céspedes'),
      (3,  'Kimberly',  'Cordero Zamora'),
      (4,  'Randall',   'Solís Quirós'),
      (5,  'Mariela',   'Chinchilla Montero'),
      (6,  'Jefferson', 'Alfaro Bonilla'),
      (7,  'Priscilla', 'Araya Brenes'),
      (8,  'Esteban',   'Madrigal Fallas'),
      (9,  'Natalia',   'Granados Hidalgo'),
      (10, 'Bryan',     'Naranjo Obando')
    ) as v(id, first_name, last_name)
   where s.id = v.id;

  update public.teachers t
     set first_name    = v.first_name,
         last_name     = v.last_name,
         email         = v.email
    from (values
      (1, 'Gerardo',  'Picado Sáenz',      'g.picado@ctp-smp.ed.cr'),
      (2, 'Marielos', 'Ulloa Venegas',     'm.ulloa@ctp-smp.ed.cr'),
      (3, 'Adriana',  'Barrantes Camacho', 'a.barrantes@ctp-smp.ed.cr'),
      (4, 'Mauricio', 'Delgado Aguilar',   'm.delgado@ctp-smp.ed.cr'),
      (5, 'Karla',    'Espinoza Mora',     'k.espinoza@ctp-smp.ed.cr'),
      (6, 'Álvaro',   'Quesada Rivera',    'a.quesada@ctp-smp.ed.cr'),
      (7, 'Fabiola',  'Sandí Núñez',       'f.sandi@ctp-smp.ed.cr'),
      (8, 'Josué',    'Corrales Vega',     'j.corrales@ctp-smp.ed.cr')
    ) as v(id, first_name, last_name, email)
   where t.id = v.id;

  -- Guardians 1–5 are the primary contacts for students 1–5. Their apellidos
  -- follow the CR convention the children's names imply: a madre's first
  -- apellido is the child's second, a padre's first apellido is the child's first.
  update public.guardians g
     set first_name = v.first_name,
         last_name  = v.last_name
    from (values
      (1, 'Xinia',   'Vargas Alpízar'),
      (2, 'Jorge',   'Villalobos Solano'),
      (3, 'Sandra',  'Zamora Picado'),
      (4, 'Ricardo', 'Solís Barquero'),
      (5, 'Elena',   'Montero Fallas')
    ) as v(id, first_name, last_name)
   where g.id = v.id;

  update public.staff s
     set first_name = v.first_name,
         last_name  = v.last_name,
         role       = v.role,
         email      = v.email
    from (values
      (1, 'Óscar',   'Vega Salas',     'director',    'direccion@ctp-smp.ed.cr'),
      (2, 'Ligia',   'Campos Rojas',   'subdirector', 'subdireccion@ctp-smp.ed.cr'),
      (3, 'Marisol', 'Arias Segura',   'secretaria',  'secretaria@ctp-smp.ed.cr'),
      (4, 'Tomás',   'Cruz Fonseca',   'orientador',  'orientacion@ctp-smp.ed.cr'),
      (5, 'Beatriz', 'Jiménez Trejos', 'psicólogo',   'psicologia@ctp-smp.ed.cr')
    ) as v(id, first_name, last_name, role, email)
   where s.id = v.id;

  -- Cédulas: 9 digits as X-XXXX-XXXX. The leading digit is the province of
  -- registration (1–7 are valid), varied per table so the four sets stay
  -- visibly distinct. Derived from the row id, so unique and stable on re-run.
  update public.students
     set national_id = format('1-%s-%s', lpad((1500 + id)::text, 4, '0'),
                                         lpad((3000 + id * 37)::text, 4, '0'));

  update public.teachers
     set national_id = format('2-%s-%s', lpad((400 + id)::text, 4, '0'),
                                         lpad((5000 + id * 53)::text, 4, '0'));

  update public.guardians
     set national_id = format('3-%s-%s', lpad((300 + id)::text, 4, '0'),
                                         lpad((6000 + id * 71)::text, 4, '0'));

  update public.staff
     set national_id = format('4-%s-%s', lpad((200 + id)::text, 4, '0'),
                                         lpad((7000 + id * 89)::text, 4, '0'));

  -- ── 6. School calendar ──────────────────────────────────────
  -- Was: two events named after lapsos, plus Carnaval — a major Venezuelan
  -- holiday, not a Costa Rican school one. Now the CR curso lectivo.
  update public.events e
     set title       = v.title,
         start_date  = v.start_date,
         end_date    = v.end_date,
         description = v.description
    from (values
      (1, 'Inicio del curso lectivo',      '2026-02-23'::date, null::date,
          'Bienvenida a estudiantes y familias'),
      (2, 'Exámenes finales I Periodo',    '2026-06-22'::date, '2026-07-03'::date,
          'Semana de exámenes del I Periodo'),
      (3, 'Vacaciones de medio periodo',   '2026-07-06'::date, '2026-07-10'::date,
          'Receso de medio curso lectivo'),
      (4, 'Entrega de notas I Periodo',    '2026-07-10'::date, null::date,
          'Reunión de padres de familia y encargados'),
      (5, 'Día de la Independencia',       '2026-09-15'::date, null::date,
          'Feriado nacional — actos cívicos'),
      (6, 'Exámenes finales II Periodo',   '2026-11-30'::date, '2026-12-11'::date,
          'Semana de exámenes del II Periodo')
    ) as v(id, title, start_date, end_date, description)
   where e.id = v.id;

  -- ── 7. Stray dates ─────────────────────────────────────────
  -- Pre-existing drift: most activity was already dated 2026 while some rows
  -- sat in 2024. Pull the strays into the 2026 year. Attendance moves onto two
  -- specific weekdays (Thu/Fri 2026-08-06/07) rather than by an interval,
  -- because attendance is unique per (student_id, date) and a blind shift can
  -- collide; these two dates are clear for the affected students.
  update public.attendance set date = '2026-08-06' where date = '2024-09-16';
  update public.attendance set date = '2026-08-07' where date = '2024-09-17';

  -- No uniqueness on discipline dates, so a constant shift is safe and keeps
  -- the original spacing between records.
  --
  -- The threshold is a fixed sentinel, deliberately NOT the year's start_date.
  -- Anchoring it to the start would mean that moving the start forward — as
  -- February 9 → 23 did — re-catches rows a previous run already shifted into
  -- the gap and shifts them a second time, 22 months further out, silently, on
  -- a seed whose whole contract is that re-running it is a no-op. January 1
  -- separates the 2024/2025 strays from anything already in the curso lectivo,
  -- which is all this needs to do.
  update public.discipline_records
     set date = date + interval '22 months'
   where date < '2026-01-01';

  -- A fixed shift cannot promise to land inside a year whose start can move:
  -- +22 months puts an April 2024 record on 2026-02-15, which was inside a
  -- curso lectivo opening February 9 and is outside one opening February 23.
  -- Rather than retune the interval — and move every stray, breaking the
  -- spacing the shift exists to preserve — pull just the ones that fell short
  -- into the first week of classes. Idempotent: a second run finds nothing
  -- before the start date left to move.
  update public.discipline_records
     set date = '2026-03-02'
   where date < '2026-02-23';

  -- ═══════════════════════════════════════════════════════════
  --  Verification — fails loudly rather than half-applying
  -- ═══════════════════════════════════════════════════════════

  -- No Venezuelan cédulas left anywhere.
  select (select count(*) from public.students  where national_id like 'V-%')
       + (select count(*) from public.teachers  where national_id like 'V-%')
       + (select count(*) from public.guardians where national_id like 'V-%')
       + (select count(*) from public.staff     where national_id like 'V-%')
    into bad;
  if bad > 0 then
    raise exception 'VERIFY FAILED: % row(s) still carry a V- national_id', bad;
  end if;

  -- Exactly two periodos, summing to 100%, and no "Lapso" naming.
  select count(*) into n from public.grading_periods where school_year_id = y_id;
  if n <> 2 then
    raise exception 'VERIFY FAILED: expected 2 grading periods, found %', n;
  end if;

  select round(sum(weight), 2) into bad
    from public.grading_periods where school_year_id = y_id;
  if bad <> 100 then
    raise exception 'VERIFY FAILED: period weights total %, expected 100', bad;
  end if;

  select count(*) into bad from public.grading_periods where name ilike '%lapso%';
  if bad > 0 then
    raise exception 'VERIFY FAILED: % grading period(s) still named "Lapso"', bad;
  end if;

  -- School identity actually set.
  if not exists (
    select 1 from public.school_settings
     where id = 1 and name is not null and id_label is not null
  ) then
    raise exception 'VERIFY FAILED: school_settings still incomplete';
  end if;

  -- Attendance and discipline are records of school days, so they genuinely
  -- cannot fall outside the curso lectivo. Read the bounds from the year
  -- itself rather than repeating literals, so the check follows the calendar
  -- instead of pinning it to the dates this file was written with.
  select (select count(*) from public.attendance
           where date < y_start or date > y_end)
       + (select count(*) from public.discipline_records
           where date < y_start or date > y_end)
    into bad;
  if bad > 0 then
    raise exception 'VERIFY FAILED: % row(s) fall outside the curso lectivo (% → %)',
      bad, y_start, y_end;
  end if;

  -- Events are held to the calendar year instead, not to the teaching year.
  -- A colegio's calendar legitimately brackets the last day of classes — the
  -- demo's own acto de graduación and entrega de notas del II Periodo sit two
  -- days past it — so the tighter bound rejected correct data. The 2024/2025
  -- strays this seed exists to catch are still caught.
  select count(*) into bad from public.events
   where extract(year from start_date) <> extract(year from y_start);
  if bad > 0 then
    raise exception 'VERIFY FAILED: % event(s) fall outside %',
      bad, extract(year from y_start);
  end if;

  -- Nothing was lost. Measured against the baseline taken at the top of this
  -- block, not against literals: written when the demo held 11 students and 38
  -- grades, those numbers made a seed that advertises itself as idempotent
  -- fail outright once the demo grew to 90 and 1080 — a false alarm about
  -- growth, on a check whose entire job is to catch a cascading DELETE. A
  -- cascade shows up as a drop from whatever the table held a moment ago, so
  -- that is what this compares.
  --
  -- Only shrinkage is an error. Rows appearing between the baseline and here
  -- would mean something else wrote concurrently, which is not this seed's
  -- business to police.
  select count(*) into n from public.students;
  if n < pre_students then
    raise exception 'VERIFY FAILED: students dropped from % to %', pre_students, n;
  end if;
  select count(*) into n from public.teachers;
  if n < pre_teachers then
    raise exception 'VERIFY FAILED: teachers dropped from % to %', pre_teachers, n;
  end if;
  select count(*) into n from public.guardians;
  if n < pre_guardians then
    raise exception 'VERIFY FAILED: guardians dropped from % to %', pre_guardians, n;
  end if;
  select count(*) into n from public.staff;
  if n < pre_staff then
    raise exception 'VERIFY FAILED: staff dropped from % to %', pre_staff, n;
  end if;
  select count(*) into n from public.student_grades;
  if n < pre_grades then
    raise exception 'VERIFY FAILED: grades dropped from % to % — a period delete cascaded',
      pre_grades, n;
  end if;
  select count(*) into n from public.attendance;
  if n < pre_attendance then
    raise exception 'VERIFY FAILED: attendance dropped from % to %', pre_attendance, n;
  end if;
  select count(*) into n from public.events;
  if n < pre_events then
    raise exception 'VERIFY FAILED: events dropped from % to %', pre_events, n;
  end if;

  -- The two 2024 attendance dates this seed moves are actually gone. That is
  -- the move's real post-condition; the count it used to assert instead (21)
  -- was a fact about the demo's size, not about the move.
  select count(*) into n from public.attendance
   where date in ('2024-09-16', '2024-09-17');
  if n > 0 then
    raise exception 'VERIFY FAILED: % attendance row(s) still dated 2024-09-16/17', n;
  end if;

  -- The demo's login plumbing survived.
  if not exists (
    select 1 from public.app_config c
     where c.key = 'demo_teacher_id'
       and exists (select 1 from public.teachers t where t.id = c.value::integer)
  ) then
    raise exception 'VERIFY FAILED: app_config.demo_teacher_id no longer resolves to a teacher';
  end if;

  select count(*) into n from public.students where auth_user_id is not null;
  if n <> 2 then
    raise exception 'VERIFY FAILED: % student auth links, expected 2', n;
  end if;

  -- The read-only lockdown is still on (this seed must not have loosened it).
  select count(*) into n from pg_policies
   where schemaname = 'public'
     and policyname in ('demo_deny_insert', 'demo_deny_update', 'demo_deny_delete');
  if n <> (select count(*) * 3 from pg_tables where schemaname = 'public') then
    raise exception 'VERIFY FAILED: demo lockdown is no longer complete (% policies)', n;
  end if;

  raise notice 'Costa Rica demo seed VERIFIED: 2 periodos, school year 2026, '
    'no V- cédulas, lockdown intact (% deny policies).', n;
end $$;
