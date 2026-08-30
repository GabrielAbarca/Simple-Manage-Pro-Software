-- ═══════════════════════════════════════════════════════════════
--  Demo grade-component template — a default MEP scheme
--  ⚠ DEMO PROJECT ONLY — never run this on a school project.
-- ═══════════════════════════════════════════════════════════════
--
-- incremental_grade_component_templates.sql adds the tables but no content,
-- so on the demo the admin's "Componentes" screen and the teacher's "Apply
-- MEP template" action would open empty and the feature would appear to do
-- nothing. This seeds one school-wide default scheme so both can be seen
-- working. The weights sum to 100 and are illustrative — a real school edits
-- them per its own MEP configuration.
--
-- WHY IT IS SAFE TO RE-RUN
--   The template is found-or-created by name ('Plantilla MEP', school-wide),
--   and the items upsert on the (template_id, name) unique constraint with
--   `on conflict do nothing`, so a repeat run is a no-op.
--
-- HOW TO RUN
--   Supabase Dashboard → SQL Editor → paste → Run, on the DEMO project.
--   One DO block, so it is atomic. It refuses to run on a project without the
--   demo_deny_* lockdown and demo_teacher_id(), so the DEMO-ONLY warning above
--   is enforced rather than advisory.
--
--   Re-run demo_lockdown.sql AFTER this only if you ran it before the tables
--   existed; this seed adds no tables of its own.
-- ═══════════════════════════════════════════════════════════════

do $$
declare
  v_template int;
begin
  -- ── Refuse to run anywhere but the demo ─────────────────────────
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

  -- ── One school-wide default scheme, idempotent by name ──────────
  select id into v_template
    from public.grade_component_templates
   where name = 'Plantilla MEP' and subject_id is null
   limit 1;
  if v_template is null then
    insert into public.grade_component_templates (name, subject_id, is_default)
      values ('Plantilla MEP', null, true)
      returning id into v_template;
  end if;

  insert into public.grade_component_template_items
    (template_id, name, weight, item_order)
  values
    (v_template, 'Cotidiano',  35, 1),
    (v_template, 'Pruebas',    40, 2),
    (v_template, 'Tareas',     10, 3),
    (v_template, 'Proyecto',   10, 4),
    (v_template, 'Asistencia',  5, 5)
  on conflict (template_id, name) do nothing;

  raise notice 'Demo MEP template VERIFIED: "Plantilla MEP" (id %) with % item(s).',
    v_template,
    (select count(*) from public.grade_component_template_items
      where template_id = v_template);
end $$;
