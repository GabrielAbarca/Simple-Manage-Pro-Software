# ARCHITECTURE_MAP.md

A navigation map for AI agents (and humans) working in this repo, so a session
can find the right file without reading the whole tree. See root `CLAUDE.md`
for conventions and hard rules; this file is structure only.

Organized by **feature**, not by portal — most features span two or three
portals, and the portal view hides that.

## Entry points

Four HTML pages, each with one controller. There are **no per-portal
directories** (`admin-console/`, `teacher-console/`, `student-portal/` do not
exist); this is a flat multi-page app.

| Portal  | HTML entry     | Controller          | Lines |
| ------- | -------------- | ------------------- | ----- |
| Login   | `login.html`   | `src/js/login.js`   | 523   |
| Student | `index.html`   | `src/js/main.js`    | 80    |
| Teacher | `teacher.html` | `src/js/teacher.js` | 122   |
| Admin   | `admin.html`   | `src/js/admin.js`   | 105   |

All three non-login controllers are thin bootstraps: resolve the session,
start theme/i18n/controls, hand a `{page: loader}` map to their nav module.
Logic lives in the per-screen modules below. `login.js` is the one controller
that still holds its own screen logic.

`errorHandler.js` **must remain the first import of every page entry point.**

## Directory layout

| Path                  | Holds                                                                                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/js/admin/`       | 44 modules — the admin console. `auth.js`, `state.js`, `data.js`, `nav.js`, plus `ui/` (5), `domain/` (5), `screens/` (15), `schedules/` (6), `import/` (8)              |
| `src/js/views/`       | 26 view modules — **both** the student portal (7) and the teacher console (18), plus `viewHelpers.js`                                                                    |
| `src/js/teacherData/` | 9 modules — the teacher console's Supabase query layer, split by domain, composed by `index.js` into one `db`                                                            |
| `src/js/controls/`    | 6 modules — portal-agnostic custom form-control widgets                                                                                                                  |
| `src/js/i18n/`        | `en.js`/`es.js` composition roots (40/31 lines) over 12 per-namespace fragments each, mirrored file-for-file                                                             |
| `src/css/style/`      | 22 partials behind `style.css` — 19 in `@layer base`, 3 in `@layer controls`                                                                                             |
| `src/css/teacher/`    | 17 partials behind `teacher.css`, all in `@layer page`                                                                                                                   |
| `src/icons/`          | `icons.svg` — the shared SVG sprite, inlined into every HTML entry at build time by the `inline-svg-sprite` plugin in `vite.config.js` (no `<use>` href to it in source) |

Everything else in `src/js/` is a flat single-purpose module — see **Shared vs
single-portal modules** below.

**CSS cascade.** Every stylesheet repeats `@layer base, page, controls;`
verbatim, so load order is irrelevant: `style.css` writes into `base`, the
per-page files into `page`. `style.css` (72) and `teacher.css` (64) are thin
`@import` entry points whose import order reproduces the original single-file
source order, each partial a contiguous slice of it — **do not reorder the
imports.** Vite inlines the graph at build time. `admin.css` (789) and
`login.css` (709) are still single files.

**i18n key trap.** The `admin` dictionary key is the **teacher** console; the
`console` key is the **admin** console. Documented in `i18n/en.js`, repeated
here because it reliably catches people out.

## Feature map

Column meanings: **Data** = the module that talks to Supabase. **Rules** =
validation and domain math. **UI** = rendering and forms. **Leans on** =
notable shared helpers and stylesheets.

Substrate almost every admin row uses, not repeated per row:
`src/js/admin/data.js` (picks the real vs demo gateway, exports `data`) over
`adminData.js`/`adminDemoDb.js`; the UI kit
`admin/ui/{format,feedback,modal,modalFields,tables}.js`; `admin/state.js`;
`admin/domain/{lookups,references,enums}.js`.

Substrate every teacher row uses: `teacherData/index.js` (the `db` handle),
`teacherState.js`, `teacherTableHelpers.js`, `teacherFormat.js`,
`teacherFeedback.js`, and `teacherModal.js` — which is the console's **only**
validation site, converting field specs into `validate.js` rules.

### Academic structure

| Feature                         | Data                                                       | Rules                                         | UI                                                                                                          | Leans on                                                             |
| ------------------------------- | ---------------------------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| School years                    | `admin/data.js`                                            | `gradingPeriods.js`, `validate.js`            | `admin/screens/years.js`                                                                                    | `domain/references.js`; import via `import/descriptors/structure.js` |
| Grading periods                 | `admin/data.js`                                            | `gradingPeriods.js` (weights must total 100%) | `admin/screens/periods.js`                                                                                  | same descriptor file                                                 |
| Grade levels                    | `admin/data.js`                                            | `validate.js`                                 | `admin/screens/gradeLevels.js`                                                                              | `import/descriptors/catalog.js`                                      |
| Rooms                           | `admin/data.js`                                            | `validate.js`, `domain/enums.ROOM_TYPES`      | `admin/screens/rooms.js`                                                                                    | `import/descriptors/catalog.js`                                      |
| Sections (DB `classes`)         | `admin/data.js`                                            | `validate.js`                                 | `admin/screens/sections.js`                                                                                 | `domain/lookups.js`; `import/resolvers.js` for FK names              |
| Subjects                        | admin `admin/data.js`; teacher `teacherData/reference.js`  | `validate.js`                                 | `admin/screens/subjects.js` (CRUD), `views/subjects.js` (teacher, read-only)                                | `import/descriptors/catalog.js`                                      |
| Grade-component templates (MEP) | admin `admin/data.js`; teacher `teacherData/categories.js` | `gradingPeriods.js` (weights)                 | `admin/screens/componentTemplates.js` + `templateItems.js`; applied teacher-side from `views/categories.js` | one import cycle — see below                                         |

`admin/screens/gradesSections.js` is a 13-line composer that loads grade
levels, rooms and sections into a single tab; it holds no logic of its own.

### People

| Feature               | Data                                                                                                                    | Rules                                          | UI                                                                                     | Leans on                                                                                                                           |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Teachers              | admin `admin/data.js`; student directory `supabaseQueries.fetchTeachers`; lookups `teacherData/reference.fetchTeachers` | `validate.js`, `domain/enums.TEACHER_STATUSES` | `admin/screens/teachers.js`; `views/teachers.js` (student directory)                   | `domain/schoolProfile.js` (ID label), `domain/accountActions.js`, `css/style/teacher-cards.css`                                    |
| Students / enrollment | admin `admin/data.js`; teacher `teacherData/students.js`                                                                | `validate.js`, `domain/enums.STUDENT_STATUSES` | `admin/screens/students.js`; `views/roster.js` + `studentForm.js` + `studentDrawer.js` | `domain/lookups.sectionOptions`, `teacherAuth.bindAdminAction`, `css/teacher/clickable-rows.css`, `css/teacher/student-drawer.css` |
| Teaching assignments  | `admin/data.js`                                                                                                         | none dedicated                                 | `admin/screens/assignments.js`                                                         | `domain/lookups.js`, `domain/references.js`                                                                                        |
| Login accounts        | `accounts.js` — the `admin-users` Edge Function, simulated in demo                                                      | `validate.js`                                  | `admin/screens/accounts.js`; per-row button `domain/accountActions.js`                 | `recovery.js` (redirect URL)                                                                                                       |

### Teaching & assessment

| Feature                       | Data                                                                                                                                                      | Rules                                                                   | UI                                                                                                                                                                          | Leans on                                                                                                                 |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Classes & the class workspace | `teacherData/classes.js` (the teacher's classes + enrollment counts); `teacherData/identity.js` (teacher, active year, grading periods)                   | —                                                                       | `views/myClasses.js` (card grid), `views/classWorkspace.js` (shell + sub-tab dispatch into roster/gradebook/attendance/schedule), `views/teacherToday.js` (today's classes) | `teacherFormat.className`, `css/teacher/my-classes.css`, `css/teacher/class-workspace.css`, `css/teacher/stat-cards.css` |
| Gradebook & grades            | `teacherData/gradebook.js`; student read `supabaseQueries.fetchStudentGrades`                                                                             | `teacherFormat.js` — `weightedOverall`, `gradeBandClass`, `gradeStatus` | `views/gradebook.js` (hub, sole writer of `gradebookState`) + `studentGrades.js` + `postGrades.js` + `columnGrades.js`; `views/grades.js` (student)                         | `views/viewHelpers.scoreHtml`, `css/teacher/gradebook-scoresheet.css`, `css/teacher/grade-entry-grids.css`               |
| Assignments                   | `teacherData/gradebook.js`                                                                                                                                | `teacherModal.js` → `validate.js`                                       | `views/assignments.js`                                                                                                                                                      | `css/teacher/wide-modal.css`                                                                                             |
| Grading categories            | `teacherData/categories.js`                                                                                                                               | `teacherModal.js` → `validate.js`                                       | `views/categories.js`                                                                                                                                                       | reads admin schemes via `fetchComponentTemplates`                                                                        |
| Attendance                    | `teacherData/attendance.js` (sheet + history); `teacherData/students.fetchStudentAttendance` (drawer); `supabaseQueries.fetchStudentAttendance` (student) | none                                                                    | `views/teacherAttendance.js`; `views/attendance.js` (student)                                                                                                               | `css/style/attendance-events.css`, `css/teacher/absence-and-today.css`, `css/teacher/attendance-buttons.css`             |
| Discipline                    | `teacherData/students.js` — `fetchStudentDiscipline`, `insertDiscipline`, `updateDiscipline`                                                              | `teacherModal.js` → `validate.js`                                       | `views/discipline.js`, surfaced from `views/studentDrawer.js`                                                                                                               | —                                                                                                                        |
| Progress report               | none of its own — rendered from data `studentDrawer.js` already holds                                                                                     | none                                                                    | `views/progressReport.js`                                                                                                                                                   | `teacherFormat.js`                                                                                                       |

### Timetable

| Feature                 | Data                                                                                                   | Rules                                                                                                                                   | UI                                                                                                                                                                               | Leans on                                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Schedules & bell blocks | admin `admin/data.js`; teacher `teacherData/schedule.js`; student `supabaseQueries.fetchClassSchedule` | `scheduleLogic.js` holds **all** of it — `findConflicts`, `findAllConflicts`, `validateBlocks`, `copySchedulePlan`, day/time arithmetic | admin `admin/schedules/index.js` (rail) + `editor.js` (grid) + `bells.js` + `forms.js`; teacher `views/teacherSchedule.js`, `views/teacherToday.js`; student `views/schedule.js` | `admin/schedules/helpers.js`, `admin/schedules/tabState.js`, `teacherFormat.dayName`, `css/style/schedule.css` |

The schedules tab is a sidebar screen that lives in `admin/schedules/`, **not**
in `admin/screens/` — `screens/*` is not the complete screen list.

### Cross-cutting

| Feature                    | Data                                                                                                                 | Rules                                                                                                                          | UI                                                                                                                           | Leans on                                                                                                                         |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Auth, session, roles       | `auth.js` (demo-write blocking), `supabaseClient.js` + `projectRef.js` (fails fast on missing/wrong env)             | `role.js` — `profiles.role` resolution, `portalPath`, `RedirectHalt`                                                           | guards `studentAuth.js` / `teacherAuth.js` / `admin/auth.js`; nav `studentNav.js` / `teacherNav.js` / `admin/nav.js`         | `demoMode.js`; `studentState.js` / `teacherState.js` / `admin/state.js` hold session state                                       |
| Sign-in & recovery         | `auth.js`                                                                                                            | `validate.EMAIL_RE`, `validate.MIN_PASSWORD_LENGTH`; `recovery.js` parses the three shapes a Supabase recovery link arrives in | `login.js`; `legal.js` for the linked privacy/terms pages                                                                    | `css/login.css`, `css/style/legal.css`                                                                                           |
| Settings                   | per-portal adapter supplies the data                                                                                 | `validate.js`, `auth.updatePassword`                                                                                           | shared renderer `settings.js` + `views/settingsView.js` (student) / `views/teacherSettings.js` / `admin/screens/settings.js` | `css/style/settings-core.css`, `css/style/settings-secondary.css`                                                                |
| School profile & ID label  | `admin/domain/schoolProfile.js`                                                                                      | —                                                                                                                              | `admin/screens/settings.js`                                                                                                  | `applyIdLabels` swaps cédula/DIMEX/carné across forms                                                                            |
| CSV import                 | parse + header auto-map `csv.js`; commit through `admin/data.js`                                                     | `admin/import/rows.js` (pure row build + skip report), `admin/import/resolvers.js` (name → FK)                                 | `admin/import/wizard.js`, buttons wired by `admin/import/index.js`                                                           | `admin/import/descriptors/` — 8 entities across `people.js`, `catalog.js`, `structure.js`, plus shared phrasing in `messages.js` |
| Demo sandbox               | `demoMode.js` (flag + credentials); `demoDb.js` wraps the **teacher** `db`; `adminDemoDb.js` wraps the admin gateway | reads pass through to Supabase, writes only record in-memory deltas and **never leave the browser**                            | —                                                                                                                            | the student portal is read-only and is deliberately **not** wrapped                                                              |
| Events                     | `supabaseQueries.fetchEvents`, reached only through `studentState.getEvents()`'s memoized promise                    | —                                                                                                                              | `views/events.js`; `views/dashboard.js` warms the same promise                                                               | `css/style/attendance-events.css`                                                                                                |
| Dashboard                  | `supabaseQueries.fetchStudentProfile` + `fetchDashboardStats`                                                        | —                                                                                                                              | `views/dashboard.js`                                                                                                         | `views/viewHelpers.js`, `css/style/dashboard.css`                                                                                |
| i18n                       | —                                                                                                                    | —                                                                                                                              | engine `i18n.js` (ES default, EN fallback, localStorage) over `i18n/en.js` + `i18n/es.js`                                    | see the key trap above                                                                                                           |
| Theming                    | `theme.js` (localStorage, all pages)                                                                                 | —                                                                                                                              | toggler markup styled in `css/style/right-panel.css`                                                                         | `css/style/design-tokens.css`                                                                                                    |
| Dialogs, skeletons, errors | —                                                                                                                    | `dbErrors.js` maps Postgres/PostgREST failures to safe, table-name-free messages                                               | `dialog.js` (Esc stack + focus trap), `ui.js` (skeletons, error rows, sidebar toggle), `errorHandler.js` (global banner)     | per-portal wrappers `teacherFeedback.js`, `admin/ui/feedback.js`                                                                 |
| Form controls              | —                                                                                                                    | `controls/dateUtils.js` (pure locale date math, `withinRange`)                                                                 | `controls/index.js` → `select.js` + `typeahead.js`, `datepicker.js` + `dateUtils.js`, `popover.js` → `dialog.js`             | `css/style/native-controls.css`, `css/style/custom-select.css`, `css/style/custom-datepicker.css` (all `@layer controls`)        |

## Shared vs single-portal modules

Which flat modules are actually shared — the thing a session most often
guesses wrong.

**All four portals:** `auth.js`, `role.js`, `theme.js`, `errorHandler.js`,
`speedInsights.js`, `supabaseClient.js`, `demoMode.js`, `i18n.js` + `i18n/**`.

**Three portals:** `ui.js` (not login), `settings.js` (student/teacher/admin),
`controls/**` (not login), `scheduleLogic.js` (student/teacher/admin),
`validate.js` (login/teacher/admin — reaches the student portal only
indirectly, through `settings.js`).

**Two portals:** `dialog.js` (teacher + admin directly; the student portal
only touches it transitively via `controls/popover.js`), `dbErrors.js`
(teacher + admin).

**Single-portal despite a generic name — do not treat these as shared:**

| Module               | Actually used by                                                     |
| -------------------- | -------------------------------------------------------------------- |
| `supabaseQueries.js` | student portal only (its own header calls it the student data layer) |
| `demoDb.js`          | teacher console only — imported solely by `teacherData/index.js`     |
| `gradingPeriods.js`  | admin console only                                                   |
| `recovery.js`        | login only                                                           |
| `projectRef.js`      | imported only by `supabaseClient.js`                                 |

`adminData.js` and `adminDemoDb.js` deliberately stay flat at the top level
rather than moving under `admin/`: they are the type-checked logic layer, and
`adminDemoDb.js` has a unit test importing it by path.

## Import cycles

Six reciprocal-import pairs exist. All are safe for the same reason: every
cross-call happens inside an event-handler closure, never at module top-level
evaluation — the standard case ES modules and Vite/Rollup handle correctly,
and this repo has no `import/no-cycle` lint rule.

**Teacher console — five pairs.** `views/gradebook.js` ↔ each of
`assignments.js`, `studentGrades.js`, `categories.js`, `postGrades.js`; and
`views/roster.js` ↔ `views/studentForm.js`. In each, the hub opens the
sub-feature from a toolbar or row action, and the sub-feature calls back into
the hub to refresh on save.

`views/columnGrades.js` is **not** in a cycle — it imports `gradebook.js`, but
`gradebook.js` does not import it back; it is reached only via
`assignments.js`.

**Admin console — one pair.** `admin/screens/componentTemplates.js` ↔
`templateItems.js`. The `openTemplateItems(tpl, { onChange })` callback breaks
the loader direction, but `templateItems.js` imports `weightBadgeHtml` back
from `componentTemplates.js`, which re-creates the cycle. (The header comment
in `templateItems.js` claiming the two stay free of a circular import is
wrong.)

Everything else in `admin/` genuinely avoids cycles by injecting callbacks:

- `nav.js` takes a `{page: loader}` map, so `screens/overview.js` can call
  `showSection("yearperiods")` without nav importing any screen.
- `schedules/tabState.js` is a leaf holding the active sub-tab and a
  `repaint()` that `schedules/index.js` registers itself into once. The panels
  import `repaint` from there, never `index.js`.

## Conventions worth knowing before you edit

- **Module-scope wiring.** Each admin screen attaches its own toolbar
  listeners at module top level (as `teacherModal.js` self-registers), and the
  three dialogs (`ui/feedback.js`, `ui/modal.js`, `import/wizard.js`) register
  their own keyboard contract via `dialog.registerDialog`. Every page loads
  its entry with `type="module" defer`, so the DOM is parsed before any module
  body runs.
- **typecheck.** `tsconfig.json` excludes the view-controller layer — it is
  all DOM glue, and TS walks an excluded root's imports and checks them anyway
  (see that file's comment). The globs do not match
  `adminData.js`/`adminDemoDb.js`. `admin/ui/format.js` and
  `admin/domain/enums.js` are DOM-free (they do import `i18n.js`) and would be
  the natural first candidates for a typing pass.
- **Demo mode.** `DEMO_MODE` defaults **ON**. A demo-mode write must never
  reach Supabase — preserve that invariant when touching any data flow.

## Split history

Every monolith has been split; **no file exceeds 1,000 lines.** Recorded so a
future session follows the same template rather than reinventing it.

| Was                      | Before        | Became                                                                                                                                                | Largest now                      |
| ------------------------ | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `src/js/admin.js`        | 5,452         | 105-line bootstrap + `src/js/admin/` (44 modules)                                                                                                     | `admin/schedules/bells.js` 318   |
| `src/js/teacher.js`      | 3,972         | 122-line bootstrap + `teacher{Auth,State,Nav}.js`, the `teacher{Feedback,Modal,TableHelpers,Format}.js` kit, `teacherData/` (9), 18 files in `views/` | `views/teacherAttendance.js` 239 |
| `src/js/main.js`         | 1,016         | 80-line bootstrap + `studentAuth.js`, `studentState.js`, `studentNav.js`, 7 files in `views/`                                                         | `views/dashboard.js` 275         |
| `src/css/style.css`      | 3,301         | 72-line `@import` entry + `src/css/style/` (22 partials)                                                                                              | `responsive.css` 263             |
| `src/css/teacher.css`    | 1,660         | 64-line `@import` entry + `src/css/teacher/` (17 partials)                                                                                            | `student-drawer.css` 170         |
| `src/js/i18n/{en,es}.js` | 1,195 / 1,200 | 40/31-line composition roots + 12 fragments each                                                                                                      | `en/adminConsole.setup.js` 266   |

The template, in order: pull the session guard out, pull shared mutable state
into one module, pull the data layer out, extract a small UI kit, then one
module per screen or tab with the controller reduced to a `{page: loader}`
map. `main.js` was the first; `teacher.js` and `admin.js` followed it.
`admin.js` was the only split large enough to earn its own directory.

**Next candidates**, none yet through a splitting pass: `demoDb.js` (850),
`login.js` (523), `settings.js` (420), `scheduleLogic.js` (417),
`controls/select.js` (371), `controls/datepicker.js` (353),
`adminData.js` (348), plus the two unsplit stylesheets `admin.css` (789) and
`login.css` (709).

## Backend (`supabase/`)

- **Schema**: `supabase/schema/school_schema.sql` is the baseline for a fresh
  per-school project. Everything else is an `incremental_*.sql` snippet meant
  to be applied by hand to an already-provisioned project
  (`attendance_by_subject`, `grade_component_templates`,
  `grading_period_bounds`, `narrow_read_policies`, `profile_role_guard`,
  `schedules`, `school_settings`, `teacher_auth_user_id`, `teacher_policies`)
  — see `docs/ONBOARDING_RUNBOOK.md`.
- **Migrations**: there is deliberately **no** `supabase/migrations/`
  directory or `config.toml` — confirmed absent. The demo project's schema is
  managed out of band, so a tracked migrations dir would make the
  Supabase↔GitHub integration report a history mismatch.
- **RLS policies**: defined inline in `school_schema.sql`, then narrowed by
  `incremental_narrow_read_policies.sql`, `incremental_profile_role_guard.sql`
  and `incremental_teacher_policies.sql`. Audited end-to-end by
  `supabase/schema/rls_audit.sql` inside a rolled-back transaction.
- **Edge Functions**: `supabase/functions/admin-users/index.ts` — service-role
  account management, real school projects only, never the demo.
- **Demo-only artifacts**: `demo_lockdown.sql`, `demo_seed_costa_rica.sql`,
  `demo_seed_attendance.sql`, `demo_seed_grade_components.sql`.

`supabase/` is the only directory with its own nested `CLAUDE.md` — read it
before touching anything in there, and remember hard rule 5: never change RLS,
Auth, migrations, or the database without asking first.

Docs: `docs/ONBOARDING_RUNBOOK.md` (provisioning), `docs/BACKUP_RESTORE.md`
(backups + restore drill), `docs/ACCOUNT_RECOVERY.md` (who resets a password).
