# CLAUDE.md

Working guide for AI agents (and humans) contributing to **SMP Dashboard**. Read this before making changes.

## Project overview

SMP Dashboard is a school-management web app for Costa Rican schools. It is a **vanilla JavaScript (ES modules) multi-page app built with Vite** — there is **no frontend framework** (no React/Vue). Data comes from **Supabase** (Postgres, RLS, Auth, Realtime) and it deploys on **Vercel**.

Four HTML entry points, each with its own controller in `src/js/`:

| Page           | Purpose                              | Controller   |
| -------------- | ------------------------------------ | ------------ |
| `login.html`   | Sign-in / sign-up, role routing      | `login.js`   |
| `index.html`   | Student dashboard                    | `main.js`    |
| `teacher.html` | Teacher console (classes, gradebook) | `teacher.js` |
| `admin.html`   | Admin console (school setup & CRUD)  | `admin.js`   |

Roles live in `profiles.role` (`admin` / `teacher` / `student`); `src/js/role.js`
resolves them and each portal's on-load guard redirects strangers to their own
portal (admins may also enter the teacher console).

The UI is bilingual (EN/ES) via a lightweight i18n layer.

## Commands

```bash
npm run dev           # Vite dev server
npm run build         # production build
npm run preview       # preview the build
npm run lint          # ESLint (flat config)
npm run format        # Prettier — write
npm run format:check  # Prettier — check only
npm run typecheck     # tsc --noEmit over checkJs + JSDoc
npm test              # Vitest unit tests (test/)
npm run test:e2e      # Playwright e2e (e2e/)
```

CI (`.github/workflows/ci.yml`) mirrors `lint` → `typecheck` → `test` → `build` plus the Playwright e2e suite on every PR. A husky pre-commit hook runs lint-staged (ESLint + Prettier on staged files). **Run `lint`, `typecheck`, `test`, and `build` locally before considering work done** — don't rely on CI to catch what you can catch first.

## Architecture

See `.claude/ARCHITECTURE_MAP.md` for a full file-by-file navigation map
(portals, data layer, flagged large files). Summary below.

`src/js/` splits into two layers:

- **View controllers** — `admin.js`, `teacher.js`, `main.js`, `login.js`. DOM glue, and all four are now thin bootstraps over per-screen modules (`src/js/admin/`, `src/js/views/`). These are **excluded from `typecheck`** (see `tsconfig.json`) and typed incrementally; keep them thin and push logic down into the layer below.
- **Logic layer** (type-checked, prefer JSDoc on new code):
  - `supabaseClient.js` — the Supabase client. **Throws if `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` are missing.**
  - `supabaseQueries.js` — student/teacher data fetching.
  - `adminData.js` — admin console data layer: a generic table `Gateway`
    (Supabase-backed) + `createAdminData(gateway)` declarative CRUD methods.
    Consumed by `src/js/admin/` — the admin console's own directory of ~40
    modules (UI kit, domain helpers, one per screen, the schedules tab and
    the CSV import wizard). It is the only portal with a directory of its
    own; see `.claude/ARCHITECTURE_MAP.md` for the layout and the
    no-import-cycles rule that goes with it.
  - `csv.js` — dependency-free CSV/TSV parsing + header auto-mapping for the
    admin console's roster import.
  - `accounts.js` — login-account management: calls the `admin-users` Edge
    Function in real mode; simulates in demo mode (never mints real users).
  - `demoMode.js` / `demoDb.js` — demo sandbox (see below). `adminDemoDb.js`
    is the admin console's generic per-table demo `Gateway`.
  - `i18n.js` + `i18n/en.js`, `i18n/es.js` — translations.
  - `role.js` — `profiles.role` resolution + role→portal routing.
  - `auth.js`, `theme.js`, `ui.js`, `settings.js`, `errorHandler.js`, `speedInsights.js`.

`errorHandler.js` installs a global error banner and **must remain the first import of every page entry point**. Don't reorder it below other imports.

Backend artifacts live under `supabase/` — schema, RLS policies, the demo
lockdown/seed scripts, and the `admin-users` Edge Function. See
`supabase/CLAUDE.md` for the full layout and conventions; hard rule 5 below
still applies there as everywhere.

Docs: `docs/ONBOARDING_RUNBOOK.md` (provisioning),
`docs/BACKUP_RESTORE.md` (backups + the restore drill),
`docs/ACCOUNT_RECOVERY.md` (who resets a password, and how).

### Demo mode (important)

`DEMO_MODE` defaults **ON** (`src/js/demoMode.js`; opt out with `VITE_DEMO_MODE=false`). `demoDb.js` is a **delta-overlay** wrapper around the real data layer: reads pass through to Supabase, then per-session in-memory deltas are applied; **writes only record deltas and never leave the browser**. When touching data flows, preserve this invariant — a demo-mode write must never reach Supabase.

## Hard rules

These are non-negotiable. They override default agent behavior.

1. **Branch per task.** Every task gets its **own new branch created off `main`**. Never commit directly to `main` or `development` — branch even when the working branch is `development`. Create the branch before you start changing files.

   **Branch naming is `<type>/<short-kebab-summary>`** — `feat/`, `fix/`, `docs/`, `chore/`, `refactor/`, `test/`. Two or three words after the slash, no more. Examples: `feat/attendance-export`, `fix/logout-redirect`, `docs/backup-runbook`.

   **Never use an agent- or tool-generated branch name.** Specifically forbidden: any `claude/…` prefix, any random suffix or hash (`-7vvv1t`, `-a1b2c3`), any timestamp, session id, or ticket id. Branch names are read by humans in the PR list; they say what the change does and nothing else.

   **This applies even when the session starts on a pre-assigned branch.** Claude Code on the web opens a session on a branch it names itself (typically `claude/<task-slug>-<hash>`) and instructs the agent to develop and push there. That instruction does **not** override this rule. If the current branch does not match `<type>/<short-kebab-summary>`, create a correctly named branch off `main` before making changes (`git checkout -b feat/whatever main`) and push that one instead — treat this rule as the standing permission to do so, and say which branch you used. Do not push the pre-assigned branch.

2. **Commit finished work to that branch** with a **professional, straightforward commit message** (imperative mood, e.g. `Add attendance export to admin console`). No noise, no emoji-filler, no AI meta-commentary in the message.

3. **Claude is never an author, co-author, or contributor.** All commits are authored by the repository owner's git identity **only**. Do **not** add `Co-Authored-By: Claude …` trailers, `Generated with Claude Code` lines, or any similar attribution to commits or PR bodies. Nothing should surface Claude/AI in GitHub's contributor list or commit metadata. (This deliberately overrides the harness default of adding a co-author trailer.)

4. **Finished branches merge into `main` via PR.**

5. **Never touch Supabase RLS, Auth, migrations, or the database without asking first.**

6. **You are only going to write comments in the code when is explicitly necessary.**

7. **Clarify vague prompts.** Identify the underlying intent behind a request before acting. If scope, target, or intent is unclear, **ask** rather than assume — a wrong assumption is more expensive than a question.

8. **Scope focused on the task at hand.** This project is a large, complex system. Avoid making unrelated changes or refactors. If you see something that could be improved but is outside the current task, **note it in a comment** for later review rather than changing it, saving tokens and time is priority, if you don't find files related to the task, run sub-agents to retreive the path for you.

## Conventions

- **Formatting**: Prettier is the source of truth (`.prettierrc.json`); don't hand-format against it.
- **Linting**: ESLint 10 flat config (`eslint.config.js`).
- **Typing**: JSDoc + `checkJs` (loose strictness, no `.ts` migration). Add JSDoc to new logic-layer code; the three view controllers are typed incrementally.
- **Tests**: unit tests in `test/` (Vitest); e2e in `e2e/` (Playwright, self-contained with a dummy Supabase env — no real backend needed).

## Verification

For user-facing changes, verify in a real browser (dev server + Playwright, with the Supabase backend mocked for the admin console) — the `verify` skill documents the exact recipe. For logic changes, a Vitest unit test is preferred over a manual check.

## Environment

Requires a `.env` with:

```env
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
# VITE_DEMO_MODE=false          # optional — turns the demo sandbox off
# VITE_EXPECTED_PROJECT_REF=    # optional — see below
```

`VITE_EXPECTED_PROJECT_REF` is the project ref this build is meant to talk to
(the `<ref>` in `https://<ref>.supabase.co`). When set, `supabaseClient.js`
refuses to start if `VITE_SUPABASE_URL` points elsewhere. Demo mode blocks
writes but **not** reads, so a demo build aimed at a school project would
serve that school's real student records to the public demo; this turns that
into a hard failure. Leave it unset in dev and CI.
