# ARCHITECTURE_MAP.md

A navigation map for AI agents (and humans) working in this repo, so a session
can find the right file without reading the whole tree. See root `CLAUDE.md`
for conventions and hard rules; this file is structure only.

## Portals

There are **no per-portal directories** (`admin-console/`, `teacher-console/`,
`student-portal/` do not exist). This is a flat multi-page app: each portal is
one page controller living directly under `src/js/`.

| Portal          | HTML entry     | Controller       | Purpose                                                        |
| --------------- | -------------- | ----------------- | --------------------------------------------------------------- |
| Login            | `login.html`   | `src/js/login.js`  | Sign-in/up, password recovery, role-based redirect              |
| Student          | `index.html`   | `src/js/main.js`   | Student dashboard SPA (grades, schedule, attendance, settings)  |
| Teacher          | `teacher.html` | `src/js/teacher.js`| Teacher console (classes, roster, gradebook, attendance)        |
| Admin            | `admin.html`   | `src/js/admin.js`  | Admin console (school setup, CRUD, accounts, schedules)         |

The only real subdirectories under `src/js/` are:

- `src/js/controls/` — shared, portal-agnostic custom form-control widgets
  (`select.js`, `datepicker.js`, `popover.js`, `typeahead.js`, `dateUtils.js`,
  `index.js`).
- `src/js/i18n/` — the two translation dictionaries (`en.js`, `es.js`),
  consumed by `src/js/i18n.js`.

Everything else in `src/js/` is a flat, single-purpose logic module shared
across portals (see root `CLAUDE.md`'s Architecture section for the full
list): `auth.js`, `role.js`, `theme.js`, `dialog.js`, `errorHandler.js`,
`validate.js`, `dbErrors.js`, `csv.js`, `gradingPeriods.js`,
`scheduleLogic.js`, `recovery.js`, `projectRef.js`, `demoMode.js`,
`speedInsights.js`, `supabaseClient.js`, `supabaseQueries.js`, `settings.js`,
`ui.js`, `legal.js`, `accounts.js`, `adminData.js`, `adminDemoDb.js`,
`demoDb.js`.

CSS follows the same flat convention: `src/css/style.css` (shared design
system + student portal) plus one override file per page (`admin.css`,
`teacher.css`, `login.css`), composed via CSS cascade layers rather than
folders.

## Data layer

- **Schema**: `supabase/schema/school_schema.sql` is the baseline for a fresh
  per-school project. Everything else in `supabase/schema/` is an
  `incremental_*.sql` snippet, meant to be applied by hand to an
  already-provisioned project (see `docs/ONBOARDING_RUNBOOK.md`).
- **Migrations**: there is deliberately **no** `supabase/migrations/`
  directory or `config.toml` — confirmed absent. The demo project's schema is
  managed out of band, so a tracked migrations dir would make the
  Supabase↔GitHub integration report a history mismatch (see
  `supabase/schema/incremental_teacher_auth_user_id.sql`'s header comment and
  `supabase/CLAUDE.md`).
- **RLS policies**: defined inline in `school_schema.sql`, then narrowed/added
  to by `incremental_narrow_read_policies.sql`,
  `incremental_profile_role_guard.sql`, and `incremental_teacher_policies.sql`.
  Audited end-to-end by `supabase/schema/rls_audit.sql` (~45 allowed/denied
  assertions inside a rolled-back transaction).
- **Edge Functions**: `supabase/functions/admin-users/index.ts` — service-role
  account management, real school projects only, never the demo.
- **Demo-only operational artifacts**: `demo_lockdown.sql`,
  `demo_seed_costa_rica.sql`, `demo_seed_attendance.sql`. See
  `supabase/CLAUDE.md` for details on all of these.

## Validation, auth/session, and i18n

- **Validation**: `src/js/validate.js` (declarative field-validation rule
  engine for admin console forms), `src/js/gradingPeriods.js` (grading-period
  weight/date-bounds rules), `src/js/scheduleLogic.js` (schedule conflict
  detection).
- **Auth/session**: `src/js/auth.js` (Supabase auth wrapper, demo-mode
  blocking), `src/js/role.js` (`profiles.role` resolution + portal routing),
  `src/js/supabaseClient.js` (client creation, fails fast on missing env).
- **i18n**: `src/js/i18n.js` (engine — per-view language selection,
  localStorage persistence, ES default with EN fallback) +
  `src/js/i18n/en.js` + `src/js/i18n/es.js` (dictionaries).

## Large files — flagged, not fixed

Files over 1,000 lines, largest first. These are **flagged only** — no split
plan in this pass, no application code was touched to produce this list.

| File                    | Lines | Notes                                                             |
| ------------------------ | ----: | ------------------------------------------------------------------ |
| `src/js/admin.js`        | 5,092 | **Top candidate for a future dedicated splitting task.**          |
| `src/js/teacher.js`      | 3,876 | Second-largest controller.                                        |
| `src/css/style.css`      | 3,301 | Shared design system + student portal styles combined.            |
| `src/css/teacher.css`    | 1,660 | Teacher-console-only component styles.                            |
| `src/js/i18n/es.js`      | 1,200 | Spanish translation dictionary.                                   |
| `src/js/i18n/en.js`      | 1,195 | English translation dictionary.                                   |
| `src/js/main.js`         | 1,016 | Student portal SPA controller.                                    |

**`admin.js` (5,092 lines) — why it's this large:** it's a single monolithic
controller for the whole admin portal, holding 8+ largely independent feature
sections inline instead of split per section — auth guard, Supabase/demo data
gateway, generic UI helpers, navigation, then one section each for overview,
year & periods, grades & sections, subjects, teachers & accounts, schedules,
students/enrollment (+ CSV import), and settings. Each section is effectively
a self-contained mini-page (its own load/render/form/import logic), so the
file grows linearly with every new admin feature.

**`teacher.js` (3,876 lines):** mixes an auth/identity guard, its data layer
(kept inline as a `db` object rather than split out the way `adminData.js`
splits the admin console's), UI helpers, and all class workspace/roster/
gradebook/attendance features in one controller.

**`style.css` (3,301 lines):** carries both the shared design-system tokens
(used by every page) and the full student-portal layout/chrome in one file,
rather than separating tokens from student-portal-specific rules the way
`admin.css`/`teacher.css`/`login.css` are separated out for their portals.

Note: an earlier assumption referred to "the 6000+ line file" as the top
splitting candidate. No file in this repo exceeds 6,000 lines — the actual
largest is `admin.js` at 5,092 lines. Correcting that assumption here so
future sessions don't go looking for a file that doesn't exist.

## Structural notes for future sessions

- No `admin-console/`, `teacher-console/`, or `student-portal/` directories
  exist. Don't assume a per-portal folder layout — it's flat `src/js/` with
  one controller file per page.
- `supabase/` is the only directory with its own nested `CLAUDE.md`
  (`supabase/CLAUDE.md`) — Claude Code auto-loads directory-scoped
  `CLAUDE.md` files, and `supabase/` is the only portal-adjacent directory
  that actually exists to host one.
