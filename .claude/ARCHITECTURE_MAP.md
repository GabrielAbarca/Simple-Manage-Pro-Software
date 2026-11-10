# ARCHITECTURE_MAP.md

A navigation map for AI agents (and humans) working in this repo, so a session
can find the right file without reading the whole tree. See root `CLAUDE.md`
for conventions and hard rules; this file is structure only.

Last refreshed Nov 10, 2026, after the portal restructure (#129 student, #130
teacher) and the entry-page swap (#135). Line counts are approximate; `ls`
and `grep` on `src/js/` stay the source of truth.

Organized by **feature**, not by portal: most features span two or three
portals, and the portal view hides that.

## Entry points

Six HTML pages. Four are portals with a controller each; two are static legal
pages.

| Page           | Controller          | Lines | Role                                  |
| -------------- | ------------------- | ----- | ------------------------------------- |
| `index.html`   | `src/js/login.js`   | 523   | Sign-in, sign-up, recovery, demo lock |
| `student.html` | `src/js/student.js` | 86    | Student portal bootstrap              |
| `teacher.html` | `src/js/teacher.js` | 111   | Teacher console bootstrap             |
| `admin.html`   | `src/js/admin.js`   | 86    | Admin console bootstrap               |
| `privacy.html` | `src/js/legal.js`   | —     | Shared by both legal pages            |
| `terms.html`   | `src/js/legal.js`   | —     |                                       |

The three portal controllers are thin bootstraps: resolve the session, start
theme/i18n/controls, hand a `{page: loader}` map to their portal's `nav.js`.
Logic lives in the per-portal directories below. `login.js` is the one
controller that still holds its own screen logic.

`errorHandler.js` **must remain the first import of every page entry point**
(`speedInsights.js` is second on the four portals).

## Directory layout

Each portal has its own directory with the same skeleton: `auth.js` (on-load
guard), `state.js` (session state), `nav.js` (sidebar + `{page: loader}`), a
data layer, and `screens/`.

| Path               | Holds                                                                                                                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/js/student/`  | 13 modules. `auth`, `state`, `nav`, `data.js` (the student data layer, read-only) and `screens/` (9: dashboard, grades, attendance, conduct, schedule, events, teachers, settings, `helpers.js`) |
| `src/js/teacher/`  | 37 modules. `auth`, `state`, `context.js` (resolves teacher + active year + periods), `nav`, `data/` (9), `screens/` (22) and `ui/` (`format.js`, `tables.js`)                                   |
| `src/js/admin/`    | 45 modules. `auth`, `state`, `data.js` (picks the real vs demo gateway), `nav`, plus `ui/` (2), `domain/` (6), `screens/` (18), `schedules/` (6), `import/` (9 incl. `descriptors/`)             |
| `src/js/controls/` | 6 modules: portal-agnostic custom form-control widgets                                                                                                                                           |
| `src/js/i18n/`     | `en.js`/`es.js` composition roots (25 lines each) over 12 per-namespace fragments each, mirrored file-for-file                                                                                   |
| `src/css/style/`   | 22 partials behind `style.css`: 19 in `@layer base`, 3 in `@layer controls`                                                                                                                      |
| `src/css/teacher/` | 18 partials behind `teacher.css`, all in `@layer page`                                                                                                                                           |
| `src/icons/`       | `icons.svg`, the shared SVG sprite, inlined into every HTML entry at build time by the `inline-svg-sprite` plugin in `vite.config.js`                                                            |

Everything else in `src/js/` is a flat single-purpose module; see **Shared vs
single-portal modules** below.

**The teacher data layer.** `teacher/data/` is split by domain (`identity`,
`classes`, `students`, `gradebook`, `categories`, `attendance`, `schedule`,
`reference`) and `teacher/data/index.js` spreads them into one `db`. In demo
mode that `db` is wrapped by `demoDb.js`. Screens only ever import `db` from
`teacher/data/index.js`, never a domain file directly.

**CSS cascade.** Every stylesheet repeats `@layer base, page, controls;`
verbatim, so load order is irrelevant: `style.css` writes into `base`, the
per-page files into `page`. `style.css` (49) and `teacher.css` (40) are thin
`@import` entry points whose import order reproduces the original single-file
source order. **Do not reorder the imports.** `admin.css` (866) and
`login.css` (724) are still single files.

**i18n key trap.** The `admin` dictionary key is the **teacher** console; the
`console` key is the **admin** console (see `i18n/en.js`). It reliably catches
people out.

## Feature map

Column meanings: **Data** = the module that talks to Supabase. **Rules** =
validation and domain math. **UI** = rendering and forms. **Leans on** =
notable shared helpers and stylesheets.

Substrate every admin row uses, not repeated per row: `admin/data.js` over
`adminData.js`/`adminDemoDb.js`; `admin/ui/{format,tables}.js`;
`admin/state.js`; `admin/domain/{lookups,references,enums}.js`; and the flat
`modal.js` + `modalFields.js` (form dialogs and their validation) and
`feedback.js` (toasts, confirms, error text).

Substrate every teacher row uses: `teacher/data/index.js` (the `db` handle),
`teacher/state.js`, `teacher/context.js`, `teacher/ui/format.js`,
`teacher/ui/tables.js`, and the same flat `modal.js` / `feedback.js` pair.
`modal.js` is the **only** validation site for form dialogs, turning field
specs into `validate.js` rules.

### Academic structure

| Feature                         | Data                                                        | Rules                                         | UI                                                                                                                    | Leans on                                                             |
| ------------------------------- | ----------------------------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| School years                    | `admin/data.js`                                             | `gradingPeriods.js`, `validate.js`            | `admin/screens/years.js`                                                                                              | `domain/references.js`; import via `import/descriptors/structure.js` |
| Grading periods                 | admin `admin/data.js`; teacher `teacher/data/identity.js`   | `gradingPeriods.js` (weights must total 100%) | `admin/screens/periods.js`                                                                                            | same descriptor file                                                 |
| Grade levels                    | `admin/data.js`                                             | `validate.js`                                 | `admin/screens/gradeLevels.js`                                                                                        | `import/descriptors/catalog.js`                                      |
| Rooms                           | `admin/data.js`                                             | `validate.js`, `domain/enums.js`              | `admin/screens/rooms.js`                                                                                              | `import/descriptors/catalog.js`                                      |
| Sections (DB `classes`)         | `admin/data.js`                                             | `validate.js`                                 | `admin/screens/sections.js`                                                                                           | `domain/lookups.js`; `import/resolvers.js` for FK names              |
| Subjects                        | admin `admin/data.js`; teacher `teacher/data/reference.js`  | `validate.js`                                 | `admin/screens/subjects.js` (CRUD), `teacher/screens/subjects.js` (read-only)                                         | `import/descriptors/catalog.js`                                      |
| Grade-component templates (MEP) | admin `admin/data.js`; teacher `teacher/data/categories.js` | `gradingPeriods.js` (weights)                 | `admin/screens/componentTemplates.js` + `templateItems.js`; applied teacher-side from `teacher/screens/categories.js` | the one import cycle (see below)                                     |

`admin/screens/gradesSections.js` is an 8-line composer that loads grade
levels, rooms and sections into a single tab; it holds no logic of its own.

### People

| Feature                | Data                                                                                                                  | Rules                            | UI                                                                                               | Leans on                                                                                        |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| Teachers               | admin `admin/data.js`; student directory `student/data.fetchTeachers`; lookups `teacher/data/reference.fetchTeachers` | `validate.js`, `domain/enums.js` | `admin/screens/teachers.js`; `student/screens/teachers.js` (directory)                           | `domain/schoolProfile.js` (ID label), `domain/accountActions.js`, `css/style/teacher-cards.css` |
| Students / enrollment  | admin `admin/data.js`; teacher `teacher/data/students.js`                                                             | `validate.js`, `domain/enums.js` | `admin/screens/students.js`; `teacher/screens/roster.js` + `studentForm.js` + `studentDrawer.js` | `domain/lookups.js`, `teacher/auth.applyAdminLock`, `css/teacher/student-drawer.css`            |
| Guardians (encargados) | `admin/data.js` (`guardians` + `student_guardians`)                                                                   | `validate.js`                    | `admin/screens/guardians.js`, an overlay opened from the students table                          | —                                                                                               |
| Teaching assignments   | `admin/data.js`                                                                                                       | none dedicated                   | `admin/screens/assignments.js`                                                                   | `domain/lookups.js`, `domain/references.js`                                                     |
| Login accounts         | `accounts.js` (the `admin-users` Edge Function, simulated in demo)                                                    | `validate.js`                    | `admin/screens/accounts.js`; per-row button `domain/accountActions.js`                           | `recovery.js` (redirect URL)                                                                    |

### Teaching & assessment

| Feature                       | Data                                                                                                                                           | Rules                                                                  | UI                                                                                                                                                             | Leans on                                                                                                  |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Classes & the class workspace | `teacher/data/classes.js`; `teacher/data/identity.js` (teacher, active year, periods)                                                          | —                                                                      | `teacher/screens/myClasses.js` (card grid), `classWorkspace.js` (sub-tab dispatch into roster/gradebook/conduct/attendance/schedule), `today.js`               | `teacher/ui/format.js`, `css/teacher/my-classes.css`, `css/teacher/class-workspace.css`                   |
| Gradebook & grades            | `teacher/data/gradebook.js`; student read `student/data.fetchStudentGrades`                                                                    | `teacher/ui/format.js` (weighted overall, grade bands), `promotion.js` | `teacher/screens/gradebook.js` (hub) + `studentGrades.js` + `postGrades.js` + `columnGrades.js`; `student/screens/grades.js`                                   | `student/screens/helpers.js`, `css/teacher/gradebook-scoresheet.css`, `css/teacher/grade-entry-grids.css` |
| Assignments                   | `teacher/data/gradebook.js`                                                                                                                    | `modal.js` → `validate.js`                                             | `teacher/screens/assignments.js`                                                                                                                               | `css/teacher/wide-modal.css`                                                                              |
| Grading categories            | `teacher/data/categories.js`                                                                                                                   | `modal.js` → `validate.js`, `gradingPeriods.js`                        | `teacher/screens/categories.js`                                                                                                                                | reads admin schemes via `fetchComponentTemplates`                                                         |
| Attendance                    | `teacher/data/attendance.js` (sheet + history); `teacher/data/students.fetchStudentAttendance` (drawer); `student/data.fetchStudentAttendance` | `atRisk.js` (shared with the admin overview), `attendanceScore.js`     | `teacher/screens/attendance.js`; `student/screens/attendance.js`                                                                                               | `css/style/attendance-events.css`, `css/teacher/attendance-buttons.css`                                   |
| Discipline & conducta         | `teacher/data/students.js` (discipline reads/writes, period conduct, posting); `student/data.fetchOwnConduct`                                  | `conduct.js`, `promotion.js` conduct floor, `modal.js` → `validate.js` | `teacher/screens/conduct.js` (load, state, clicks) + `conductTables.js` (pure HTML) + `discipline.js` (forms) + `postConduct.js`; `student/screens/conduct.js` | `teacher/ui/format.js`, `css/teacher/conduct.css`                                                         |
| Progress report               | none of its own (rendered from what `studentDrawer.js` holds)                                                                                  | none                                                                   | `teacher/screens/progressReport.js`                                                                                                                            | `teacher/ui/format.js`                                                                                    |
| Class exports                 | rows from `classExportRows.js`                                                                                                                 | `csv.js` `toCsv` (formula-safe), `xlsx.js`                             | `teacher/screens/classExports.js`                                                                                                                              | `tableExport.js`                                                                                          |

### Timetable

| Feature                 | Data                                                                                                 | Rules                                                                                                  | UI                                                                                                                                                                        | Leans on                                                                              |
| ----------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Schedules & bell blocks | admin `admin/data.js`; teacher `teacher/data/schedule.js`; student `student/data.fetchClassSchedule` | `scheduleLogic.js` holds **all** of it: conflicts, block validation, plan copying, day/time arithmetic | admin `admin/schedules/index.js` (rail) + `editor.js` + `bells.js` + `forms.js`; teacher `teacher/screens/schedule.js`, `today.js`; student `student/screens/schedule.js` | `admin/schedules/helpers.js`, `admin/schedules/tabState.js`, `css/style/schedule.css` |

The schedules tab is a sidebar screen that lives in `admin/schedules/`, **not**
in `admin/screens/`, so `screens/*` is not the complete screen list.

### Cross-cutting

| Feature                   | Data                                                                                                              | Rules                                                                                     | UI                                                                                                                                                        | Leans on                                                                                          |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Auth, session, roles      | `auth.js` (demo-write blocking), `supabaseClient.js` + `projectRef.ts` (fails fast on missing or wrong env)       | `role.js` (`profiles.role` resolution, portal routing), `paths.js` (page URLs)            | guards `student/auth.js`, `teacher/auth.js`, `admin/auth.js`; navs `student/nav.js`, `teacher/nav.js`, `admin/nav.js`                                     | `demoMode.js`; `student/state.js`, `teacher/state.js`, `admin/state.js`                           |
| Sign-in & recovery        | `auth.js`                                                                                                         | `validate.js`; `recovery.js` parses the three shapes a recovery link arrives in           | `login.js`; `legal.js` for the privacy/terms pages                                                                                                        | `css/login.css`, `css/style/legal.css`                                                            |
| Settings                  | each portal supplies the data                                                                                     | `validate.js`, `auth.js` password change                                                  | shared renderer `settings.js` + `student/screens/settings.js`, `teacher/screens/settings.js`, `admin/screens/settings.js`                                 | `css/style/settings-core.css`, `css/style/settings-secondary.css`                                 |
| School profile & ID label | `admin/domain/schoolProfile.js`                                                                                   | —                                                                                         | `admin/screens/settings.js`                                                                                                                               | swaps cédula/DIMEX/carné labels across forms                                                      |
| Table export              | —                                                                                                                 | `csv.js` `toCsv`, `xlsx.js` (dependency-free workbook writer)                             | `tableExport.js`: the admin students table and a class's gradebook and attendance (`teacher/screens/classExports.js`)                                     | —                                                                                                 |
| CSV import                | parse + header auto-map `csv.js`; commit through `admin/data.js`                                                  | `admin/import/rows.js` (row build + skip report), `admin/import/resolvers.js` (name → FK) | `admin/import/wizard.js`, buttons wired by `admin/import/index.js`                                                                                        | `admin/import/descriptors/` (`people.js`, `catalog.js`, `structure.js`, `messages.js`)            |
| Demo sandbox              | `demoMode.js` (flag + credentials); `demoDb.js` wraps the **teacher** `db`; `adminDemoDb.js` is the admin gateway | reads pass through, writes only record in-memory deltas and **never leave the browser**   | —                                                                                                                                                         | the student portal is read-only and deliberately **not** wrapped                                  |
| Events                    | student `student/data.fetchEvents` (memoized in `student/state.js`); admin `admin/data.js`                        | `domain/enums.js`; `upcomingEvents.js`                                                    | `student/screens/events.js`, `student/screens/dashboard.js`; admin CRUD `admin/screens/events.js`                                                         | `css/style/attendance-events.css`                                                                 |
| Dashboard                 | `student/data.fetchStudentProfile` + `fetchDashboardStats`                                                        | `promotion.js`                                                                            | `student/screens/dashboard.js`                                                                                                                            | `css/style/dashboard.css`                                                                         |
| i18n                      | —                                                                                                                 | —                                                                                         | engine `i18n.js` (ES default, EN fallback, localStorage) over `i18n/en.js` + `i18n/es.js`                                                                 | see the key trap above                                                                            |
| Theming                   | `theme.js` (localStorage, all pages)                                                                              | —                                                                                         | toggler styled in `css/style/right-panel.css`                                                                                                             | `css/style/design-tokens.css`                                                                     |
| Dialogs, toasts, errors   | —                                                                                                                 | `dbErrors.js` maps Postgres/PostgREST failures to safe messages                           | `dialog.js` (Esc stack + focus trap), `feedback.js` (toasts, confirms, `errorText` via `dbErrors.js`), `ui.js` (skeletons, error rows), `errorHandler.js` | `html.js` `escapeHtml`                                                                            |
| Form controls             | —                                                                                                                 | `controls/dateUtils.js` (pure date math)                                                  | `controls/index.js` → `select.js` + `typeahead.js`, `datepicker.js`, `popover.js` → `dialog.js`                                                           | `css/style/native-controls.css`, `css/style/custom-select.css`, `css/style/custom-datepicker.css` |

## Shared vs single-portal modules

Which flat modules are actually shared, the thing a session most often guesses
wrong. Derived from imports on Nov 10, 2026.

**All four portals:** `errorHandler.js`, `speedInsights.js`, `theme.js`,
`i18n.js` + `i18n/**`, `demoMode.js`, `supabaseClient.js`, `auth.js`.

**Three portals (student, teacher, admin):** `ui.js`, `controls/**`,
`settings.js`, `role.js` (also login), `html.js`, `paths.js` (also login, via
`recovery.js`), `promotion.js`, `scheduleLogic.js`.

**Two portals (teacher + admin):** `modal.js` + `modalFields.js`,
`feedback.js` (and through it `dbErrors.js`), `dialog.js` (the student portal
only touches it through `controls/popover.js`), `validate.js` (also login and
`settings.js`), `atRisk.js`, `gradingPeriods.js`, `tableExport.js` + `csv.js`

- `xlsx.js`.

**Single-portal despite a generic name:**

| Module               | Actually used by                                         |
| -------------------- | -------------------------------------------------------- |
| `demoDb.js`          | teacher console only, through `teacher/data/index.js`    |
| `attendanceScore.js` | `demoDb.js` only (mirrors the server's attendance score) |
| `conduct.js`         | teacher console and `demoDb.js`                          |
| `classExportRows.js` | teacher console only                                     |
| `upcomingEvents.js`  | student portal only                                      |
| `accounts.js`        | admin console only                                       |
| `recovery.js`        | login and `accounts.js`                                  |
| `legal.js`           | `privacy.html` and `terms.html` only                     |
| `projectRef.ts`      | `supabaseClient.js` only                                 |

`adminData.js` and `adminDemoDb.js` deliberately stay flat at the top level
rather than moving under `admin/`: they are the type-checked logic layer, and
their unit tests import them by path.

## Import cycles

One reciprocal pair is left: `admin/screens/componentTemplates.js` ↔
`templateItems.js`. The `openTemplateItems(tpl, { onChange })` callback breaks
the loader direction, but `templateItems.js` imports `weightBadgeHtml` back
from `componentTemplates.js`. It's safe because every cross-call happens
inside an event handler, never at module evaluation. The five teacher-console
pairs this map used to list were removed in the restructure.

Everything else avoids cycles by injecting callbacks:

- each portal's `nav.js` takes a `{page: loader}` map, so a screen can call
  `showSection(...)` without nav importing any screen;
- `admin/schedules/tabState.js` is a leaf holding the active sub-tab and a
  `repaint()` that `schedules/index.js` registers once. The panels import
  `repaint` from there, never `index.js`.

## Conventions worth knowing before you edit

- **Module-scope wiring.** Admin screens attach their own toolbar listeners at
  module top level, and the dialogs (`feedback.js`, `modal.js`,
  `admin/import/wizard.js`) register their own keyboard contract via
  `dialog.registerDialog`. Every page loads its entry with
  `type="module" defer`, so the DOM is parsed before any module body runs.
- **typecheck.** `tsconfig.json` checks `src/js/**/*.{js,ts}` but excludes the
  page controllers, `src/js/admin/**`, every `*/nav.js` and `*/screens/**`
  (DOM glue, typed incrementally). Screens that already pass are listed back
  in through its `files` array, and a new screen that passes should be added
  there. New logic-layer modules may be `.ts` (`projectRef.ts` is the
  reference), imported with the explicit `.ts` extension. ESLint does not lint
  `.ts`; `typecheck` and Prettier cover it.
- **Demo mode.** `DEMO_MODE` defaults **ON**. A demo-mode write must never
  reach Supabase, so preserve that invariant when touching any data flow.

## Split history

Every monolith has been split. Recorded so a future session follows the same
template rather than reinventing it.

| Was                      | Before        | Became                                                                   |
| ------------------------ | ------------- | ------------------------------------------------------------------------ |
| `src/js/admin.js`        | 5,452         | 86-line bootstrap + `src/js/admin/` (45 modules)                         |
| `src/js/teacher.js`      | 3,972         | 111-line bootstrap + `src/js/teacher/` (37 modules)                      |
| `src/js/main.js`         | 1,016         | `src/js/student.js` (86-line bootstrap) + `src/js/student/` (13 modules) |
| `src/css/style.css`      | 3,301         | 49-line `@import` entry + `src/css/style/` (22 partials)                 |
| `src/css/teacher.css`    | 1,660         | 40-line `@import` entry + `src/css/teacher/` (18 partials)               |
| `src/js/i18n/{en,es}.js` | 1,195 / 1,200 | 25-line composition roots + 12 fragments each                            |

The template, in order: pull the session guard out, pull shared mutable state
into one module, pull the data layer out, extract a small UI kit, then one
module per screen or tab, with the controller reduced to a `{page: loader}`
map. Since #129/#130 every portal has its own directory.

**Over the 300-line cap**, none yet through a splitting pass: `demoDb.js`
(1,117), `login.js` (523), `adminData.js` (502), `admin/screens/guardians.js`
(426), `scheduleLogic.js` (400), `admin/screens/students.js` (383),
`settings.js` (377), `controls/select.js` (345), `student/data.js` (334),
`controls/datepicker.js` (330), `admin/schedules/bells.js` (315), plus the two
unsplit stylesheets `admin.css` (866) and `login.css` (724).

## Backend (`supabase/`)

- **Schema**: `supabase/schema/school_schema.sql` is the baseline for a fresh
  per-school project. Everything else is an `incremental_*.sql` snippet
  applied by hand to an already-provisioned project (`attendance_by_subject`,
  `attendance_component`, `conducta`, `grade_component_templates`,
  `grading_period_bounds`, `narrow_read_policies`, `profile_role_guard`,
  `schedules`, `school_settings`, `teacher_auth_user_id`, `teacher_policies`).
  See `docs/ONBOARDING_RUNBOOK.md` for the order.
- **Migrations**: there is deliberately **no** `supabase/migrations/`
  directory or `config.toml`. The demo project's schema is managed out of
  band, so a tracked migrations dir would make the Supabase↔GitHub
  integration report a history mismatch.
- **RLS policies**: defined inline in `school_schema.sql`, then narrowed by
  `incremental_narrow_read_policies.sql`, `incremental_profile_role_guard.sql`
  and `incremental_teacher_policies.sql`. Audited end to end by
  `supabase/schema/rls_audit.sql` inside a rolled-back transaction.
- **Edge Functions**: `supabase/functions/admin-users/index.ts` does
  service-role account management, real school projects only, never the demo.
- **Demo-only artifacts**: `demo_lockdown.sql`, `demo_seed_costa_rica.sql`,
  `demo_seed_attendance.sql`, `demo_seed_grade_components.sql`.

`supabase/` has its own nested `CLAUDE.md`. Read it before touching anything
in there, and remember hard rule 5: never change RLS, Auth, migrations, or the
database without asking first.

Docs: `docs/ONBOARDING_RUNBOOK.md` (provisioning), `docs/BACKUP_RESTORE.md`
(backups + restore drill), `docs/ACCOUNT_RECOVERY.md` (who resets a password).
