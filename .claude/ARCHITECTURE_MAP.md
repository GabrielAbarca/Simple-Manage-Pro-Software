# ARCHITECTURE_MAP.md

A navigation map for AI agents (and humans) working in this repo, so a session
can find the right file without reading the whole tree. See root `CLAUDE.md`
for conventions and hard rules; this file is structure only.

## Portals

There are **no per-portal directories** (`admin-console/`, `teacher-console/`,
`student-portal/` do not exist). This is a flat multi-page app: each portal is
one page controller living directly under `src/js/`.

| Portal  | HTML entry     | Controller          | Purpose                                                  |
| ------- | -------------- | ------------------- | -------------------------------------------------------- |
| Login   | `login.html`   | `src/js/login.js`   | Sign-in/up, password recovery, role-based redirect       |
| Student | `index.html`   | `src/js/main.js`    | Student dashboard SPA — thin orchestrator; see below     |
| Teacher | `teacher.html` | `src/js/teacher.js` | Teacher console (classes, roster, gradebook, attendance) |
| Admin   | `admin.html`   | `src/js/admin.js`   | Admin console (school setup, CRUD, accounts, schedules)  |

The only real subdirectories under `src/js/` are:

- `src/js/controls/` — shared, portal-agnostic custom form-control widgets
  (`select.js`, `datepicker.js`, `popover.js`, `typeahead.js`, `dateUtils.js`,
  `index.js`).
- `src/js/i18n/` — the two translation dictionaries. `en.js`/`es.js` are thin
  composition roots (~30 lines each) that import and spread per-namespace
  fragments from the sibling `en/`/`es/` directories (`common.js`,
  `a11y.js`, `validation.js`, `errors.js`, `enums.js`, `settings.js`,
  `student.js`, `teacherConsole.core.js` + `teacherConsole.grading.js`
  (merged into the `admin` key), `adminConsole.setup.js` +
  `adminConsole.operations.js` (merged into the `console` key), `login.js`).
  `en/` and `es/` mirror each other file-for-file. Consumed by
  `src/js/i18n.js`.
- `src/js/views/` — per-section view controllers for **both** the student
  portal and the teacher console, extracted from `main.js` and `teacher.js`
  respectively. Student portal: `dashboard.js`, `grades.js`, `schedule.js`,
  `teachers.js`, `attendance.js`, `events.js`, `settingsView.js` (one file per
  sidebar section). Teacher console: `teacherToday.js`, `myClasses.js`,
  `classWorkspace.js` (workspace shell + sub-tab dispatch), `roster.js` +
  `studentForm.js` + `studentDrawer.js` + `discipline.js` +
  `progressReport.js` (roster tab and everything reachable from a student
  row), `gradebook.js` + `assignments.js` + `studentGrades.js` +
  `categories.js` + `postGrades.js` + `columnGrades.js` (gradebook tab and
  its modals), `teacherAttendance.js` (attendance tab + absence summary),
  `teacherSchedule.js` (read-only schedule tab), `subjects.js` (read-only
  catalog), `teacherSettings.js`. The teacher-side files that would otherwise
  collide with an existing student-portal filename are prefixed `teacher*`
  (`teacherAttendance.js` vs `attendance.js`, `teacherSchedule.js` vs
  `schedule.js`, `teacherSettings.js` vs `settingsView.js`); everything else
  keeps its natural name since there's no collision. All of it is DOM glue —
  excluded from `typecheck` alongside `admin.js`/`teacher.js`/`login.js`/
  `main.js`/`studentNav.js`/`teacherNav.js`/`teacherFeedback.js`/
  `teacherModal.js`. Unlike a hypothetical `student-portal/`/`teacher-console/`
  directory this only holds JS view sections, not each page's HTML/CSS —
  those still live at the flat top level (`index.html`, `teacher.html`,
  `src/css/style.css`, `src/css/teacher.css`), though the two largest
  stylesheets are themselves thin entry points over `src/css/style/` and
  `src/css/teacher/` (see the CSS note below).
- `src/js/teacherData/` — the teacher console's data layer (Supabase
  queries), split by domain: `identity.js`, `classes.js`, `students.js`,
  `gradebook.js`, `categories.js`, `attendance.js`, `schedule.js`,
  `reference.js`, composed and demo-wrapped by `index.js` into the same `db`
  shape the console used to expose as an inline object. Mirrors how
  `adminData.js` gives the admin console a data layer, but as flat
  per-domain modules rather than a generic CRUD `Gateway`. Pure query
  functions, no DOM — checked by `typecheck`, except `index.js` itself (a
  thin composition file that also wires in `teacherFeedback.js`'s toast for
  the demo-write notice, so it stays excluded for the same reason `main.js`
  does — see the `tsconfig.json` comment).

`src/js/main.js` itself is now a thin orchestrator (~90 lines): resolves the
session via `studentAuth.js`, bootstraps theme/i18n/controls, and wires the
`views/*.js` init functions into `studentNav.js`'s router. The routing/sidebar
chrome (`navigateTo`, view caching, error-retry, cross-portal links) lives in
`src/js/studentNav.js`; the shared session state (current student id, cached
profile, memoized events/grading-periods fetchers) lives in
`src/js/studentState.js`; the auth guard (`resolveStudentSession`) and
session-lifecycle listeners live in `src/js/studentAuth.js`.

Everything else in `src/js/` is a flat, single-purpose logic module shared
across portals (see root `CLAUDE.md`'s Architecture section for the full
list): `auth.js`, `role.js`, `theme.js`, `dialog.js`, `errorHandler.js`,
`validate.js`, `dbErrors.js`, `csv.js`, `gradingPeriods.js`,
`scheduleLogic.js`, `recovery.js`, `projectRef.js`, `demoMode.js`,
`speedInsights.js`, `supabaseClient.js`, `supabaseQueries.js`, `settings.js`,
`ui.js`, `legal.js`, `accounts.js`, `adminData.js`, `adminDemoDb.js`,
`demoDb.js`, `studentAuth.js`, `studentState.js`, `studentNav.js`,
`teacherAuth.js`, `teacherState.js`, `teacherNav.js`, `teacherFeedback.js`,
`teacherModal.js`, `teacherTableHelpers.js`, `teacherFormat.js`.

CSS keeps the same flat page-level convention: `src/css/style.css` (shared
design system + student portal) plus one override file per page
(`admin.css`, `teacher.css`, `login.css`). Load order is made irrelevant by
CSS cascade layers — every stylesheet repeats the same
`@layer base, page, controls;` order statement verbatim, `style.css` writes
into `base` and the per-page files into `page`, so page overrides win no
matter which file the browser gets first.

The two big ones are now **thin `@import` entry points** over a directory of
per-domain partials: `style.css` → `src/css/style/*.css` (22 files, each
wrapping itself in `@layer base`, plus three form-control files in
`@layer controls`), and `teacher.css` → `src/css/teacher/*.css` (17 files,
each wrapping itself in `@layer page`). `admin.css` (789) and `login.css`
(709) are still single files. In both splits the import order reproduces the
original single-file source order and every partial is a contiguous slice of
it, so cascade results at equal specificity are unchanged — **do not reorder
the imports.** Vite inlines the `@import` graph at build time; the shipped
bundles are rule-for-rule identical to the pre-split ones.

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
  `src/js/i18n/en.js` + `src/js/i18n/es.js` (composition roots that spread
  together the per-namespace fragments under `src/js/i18n/en/` and
  `src/js/i18n/es/`).

## Large files — flagged, not fixed

Files over 1,000 lines, largest first. These are **flagged only** — no split
plan in this pass, no application code was touched to produce this list.

| File              | Lines | Notes                                                    |
| ----------------- | ----: | -------------------------------------------------------- |
| `src/js/admin.js` | 5,092 | **Top candidate for a future dedicated splitting task.** |

`admin.js` is the only file left on this list — every other entry has since
been split (see below).

`src/js/i18n/en.js` and `src/js/i18n/es.js` (formerly 1,195 / 1,200 lines)
were each split into a ~30-line composition root plus 11 per-namespace
fragment files under `en/`/`es/` (largest ~220 lines) — see the Portals
section above. No file in the split exceeds 300 lines.

`src/js/main.js` (formerly 1,016 lines) was split into `src/js/views/*.js`
(one file per dashboard section, largest ~280 lines), `src/js/studentNav.js`,
`src/js/studentState.js`, and `src/js/studentAuth.js` — see the Portals
section above. No file in the split exceeds 300 lines. This was the template
for splitting `teacher.js` (below); `admin.js` is the one candidate still
unsplit.

`src/js/teacher.js` (formerly 3,972 lines) was split the same way, plus a
data layer: `src/js/teacherAuth.js` (session guard + admin-lock helpers),
`src/js/teacherState.js` (shared session/nav state), `src/js/teacherData/*`
(Supabase queries, split by domain — see the Portals section above), a small
shared UI kit (`teacherFeedback.js`, `teacherModal.js`,
`teacherTableHelpers.js`, `teacherFormat.js`), `src/js/teacherNav.js`
(sidebar section switching + cross-portal links, taking a `{page: loader}`
map like `studentNav.js`'s `initNav`), and one `src/js/views/teacher*.js` /
`views/*.js` file per class-workspace tab and its modals (roster, gradebook,
attendance, schedule, plus every dialog reachable from them — see the
Portals section above for the full list). `teacher.js` itself is now a
~120-line thin bootstrap. Only `roster.js` (406 lines, table + list) needed
a further split (`studentForm.js`, the add/edit forms) to stay near the
300-line guideline; every other file in the split is under 300.

A handful of module pairs in the gradebook cluster (`gradebook.js` ↔ its
sub-features) and the roster cluster (`roster.js` ↔ `studentForm.js`) import
each other: the sub-feature is opened from the hub's toolbar/row action and,
on save, calls back into the hub to refresh. This is safe because every
cross-call happens inside an event-handler closure, never at module
top-level evaluation — the standard case ES modules (and Vite/Rollup) handle
correctly, and this repo has no `import/no-cycle` lint rule.

**`admin.js` (5,092 lines) — why it's this large:** it's a single monolithic
controller for the whole admin portal, holding 8+ largely independent feature
sections inline instead of split per section — auth guard, Supabase/demo data
gateway, generic UI helpers, navigation, then one section each for overview,
year & periods, grades & sections, subjects, teachers & accounts, schedules,
students/enrollment (+ CSV import), and settings. Each section is effectively
a self-contained mini-page (its own load/render/form/import logic), so the
file grows linearly with every new admin feature. `teacher.js`'s split above
is a second template available for this one, in addition to `main.js`'s.

**The two CSS monoliths are split.** `src/css/style.css` (formerly 3,301
lines) became a ~70-line entry point over `src/css/style/*.css` — 22 partials
split by component domain (fonts, design tokens, reset, app shell, student
views, settings, right panel, legal/404, responsive, native/custom form
controls), largest ~263 lines. `src/css/teacher.css` (formerly 1,660 lines)
followed the same template: a ~64-line entry point over
`src/css/teacher/*.css` — 17 partials (console chrome, the class-first
workspace, the gradebook, the roster, the student drawer, the grade-entry
grids), largest ~170 lines. No partial in either split exceeds 300 lines.
See the CSS paragraph in the Portals section for the cascade-layer and
import-order rules that make the splits safe.

Note: an earlier assumption referred to "the 6000+ line file" as the top
splitting candidate. No file in this repo exceeds 6,000 lines — the actual
largest is `admin.js` at 5,092 lines. Correcting that assumption here so
future sessions don't go looking for a file that doesn't exist.

## Structural notes for future sessions

- No `admin-console/`, `teacher-console/`, or `student-portal/` directories
  exist. Don't assume a per-portal folder layout — it's flat `src/js/` with
  one controller file per page. `src/js/views/` is not an exception to this:
  it groups the student portal's _JS view sections_ only (mirroring
  `controls/`), not a full per-portal directory — the page's HTML/CSS and
  shared session/auth/routing modules stay flat at the top of `src/js/`.
- `supabase/` is the only directory with its own nested `CLAUDE.md`
  (`supabase/CLAUDE.md`) — Claude Code auto-loads directory-scoped
  `CLAUDE.md` files, and `supabase/` is the only portal-adjacent directory
  that actually exists to host one.
