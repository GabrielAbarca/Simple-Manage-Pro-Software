---
name: prime-frontend
description: Orients the session on the Simple Manage Pro UI a ticket touches — the portal's HTML entry and controller, its admin screens or views, controls, i18n areas, CSS partials, and the e2e specs that cover them — without loading the data layer. Use before planning a ticket whose Prime line says frontend.
argument-hint: "[#ticket]"
---

# Prime frontend: the portal, screens and strings a ticket touches

**Input**: $ARGUMENTS, the ticket `#N`.

Vanilla JS ES modules and Vite, four HTML entry points, no framework. Load
only what the ticket needs.

## 0. The ticket

Read `#N` with `mcp__github__issue_read` (method `get`, owner `GabrielAbarca`,
repo `Simple-Manage-Pro-Software`): Concern, Acceptance checks, Context seams,
Out of scope. Read the epic docs sections its `**Docs:**` line names.

## 1. Rules

`CLAUDE.md` and `.claude/references/conventions.md` (section code). Keep in mind:
`errorHandler.js` must stay the first import of each entry point; view
controllers are thin bootstraps and logic belongs in the type-checked layer;
every user-facing string goes through `t()` with keys in both languages.

## 2. Locate the portal

| Portal            | HTML           | Controller          | Screens / views                                                                                             | Styles                                     |
| ----------------- | -------------- | ------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Admin console     | `admin.html`   | `src/js/admin.js`   | `src/js/admin/screens/`, `admin/ui/`, `admin/nav.js`, `admin/state.js`, `admin/import/`, `admin/schedules/` | `src/css/admin.css`                        |
| Teacher console   | `teacher.html` | `src/js/teacher.js` | `src/js/views/` (teacher views), `teacher{Auth,State,Nav,Feedback,Modal,TableHelpers,Format}.js`            | `src/css/teacher.css` + `src/css/teacher/` |
| Student dashboard | `index.html`   | `src/js/main.js`    | `src/js/views/` (student views), `student{Auth,State,Nav}.js`                                               | `src/css/style.css` + `src/css/style/`     |
| Login             | `login.html`   | `src/js/login.js`   | —                                                                                                           | `src/css/login.css`                        |

Confirm the exact files in `.claude/ARCHITECTURE_MAP.md` (Entry points,
the matching Feature map subsection, Shared vs single-portal modules). In
`src/js/admin/`, also read **Import cycles**.

## 3. Read, scoped

- The ticket's seam files, in full.
- One sibling screen or view that already does something similar (the
  "pattern to mirror"), to copy its structure: module-scope wiring, dialogs via
  `admin/ui/` or the teacher modal kit, tables, toolbars, empty, error and
  retry states.
- Shared controls only if used: `src/js/controls/` (select, datepicker,
  typeahead, popover).
- The i18n area files the strings belong to: `src/js/i18n/en/<area>.js` and
  `src/js/i18n/es/<area>.js`. Areas: common, a11y, validation, errors, enums,
  settings, student, login, teacherConsole.core, teacherConsole.grading,
  adminConsole.setup, adminConsole.operations. Note the naming quirk recorded
  in the map: the `admin` namespace holds teacher-console keys and `console`
  holds admin-console keys.
- The e2e spec that covers this portal (`e2e/smoke.spec.js` plus the
  feature's spec) and the fixture set it uses in `e2e/fixtures.js`
  (`consoleFix`, `teacherFix`, `studentFix`, `scheduleFix`).

## 4. State

```bash
git status --short && git log -10 --oneline -- src/js src/css '*.html' e2e
```

## Output

- **Portal and entry:** HTML, controller, the screens or views involved (paths).
- **Pattern to mirror:** file, plus the 2–3 conventions it shows.
- **Strings:** i18n area(s) and namespace; Spanish in _usted_.
- **Styles:** the partial(s) to touch; mobile breakpoints to respect.
- **Tests:** the e2e spec and fixture set to extend; selectors already in use.
- **Risks:** import cycles, files near 1,000 lines, admin-locked controls
  (`IS_ADMIN`), async re-renders.
