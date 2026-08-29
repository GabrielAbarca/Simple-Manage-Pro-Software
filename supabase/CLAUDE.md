# CLAUDE.md — supabase/

Conventions specific to the `supabase/` backend artifacts. See root
`CLAUDE.md` for global stack, commands, and hard rules — in particular hard
rule 5 ("Never touch Supabase RLS, Auth, migrations, or the database without
asking first") applies here as everywhere.

## Layout

Backend artifacts live under `supabase/`: `schema/` (`school_schema.sql`, the
baseline for a fresh per-school project, plus incremental snippets) and
`functions/admin-users/` (the service-role Edge Function for account
management, deployed to real school projects only — never the demo). There is
deliberately **no** `supabase/migrations/` or `config.toml`: the demo
project's schema is managed out of band, so a tracked migrations dir would
make the Supabase↔GitHub integration report a history mismatch. Apply schema
artifacts by hand (dashboard / CLI) per `docs/ONBOARDING_RUNBOOK.md`.

## Operational artifacts

Four of the files under `schema/` are operational rather than structural:

- `demo_lockdown.sql` — restrictive `demo_deny_*` policies making the demo
  project read-only server-side. **Demo project only**; re-run after any
  schema change (it loops over the live table catalog, so new tables get
  locked too).
- `demo_seed_costa_rica.sql` — the demo project's Costa Rican content: school
  identity, a Feb–Dec `curso lectivo`, two `periodos`, CR names and
  cédula-format ids. **Demo project only** — it refuses to run on a project
  without the `demo_deny_*` lockdown and `demo_teacher_id()`. One atomic DO
  block, idempotent, and it asserts a period is empty before deleting it
  (`student_grades` cascades from `grading_periods`).
- `incremental_profile_role_guard.sql` — trigger stopping a user from editing
  their own `profiles.role`. RLS chooses rows, not columns, so without it any
  signed-in user could PATCH themselves to `admin` with the browser's anon
  key.
- `rls_audit.sql` — impersonates anon/student/teacher/admin and asserts ~45
  allowed/denied outcomes inside a transaction that rolls back. Run it after
  any policy change and as the last step of a restore drill.

## Docs

`docs/ONBOARDING_RUNBOOK.md` (provisioning), `docs/BACKUP_RESTORE.md`
(backups + the restore drill), `docs/ACCOUNT_RECOVERY.md` (who resets a
password, and how).
