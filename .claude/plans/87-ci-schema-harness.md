# Plan — Prove the schema baseline and the access audit in CI

**Implements:** #87 · **Epic:** #86 · **Branch:** feat/ci-schema-harness
**Status:** Approved 2026-10-08
**Red commit:** 6ca0b41
**Confidence:** 8/10 that one unattended pass reaches a green PR

> Validate every pattern and path below against the code before acting on it.
> Import from the files named here; don't recreate helpers that already exist.

## Ticket

**Concern:** Spike S1, delivered as the first slice of CI's `schema` job. Every
pull request starts a disposable Supabase Postgres in GitHub Actions, applies
`school_schema.sql` and runs `rls_audit.sql` in the school shape (no demo
locks), then applies `demo_lockdown.sql` and runs the audit again in the demo
shape (three locks on every public table). A schema change that breaks an
access rule or the demo lock turns a check red before any project sees it.
Synthetic data only, no credentials.

**User story:** As the owner, I want every pull request to prove the committed
baseline still passes the access audit with and without the demo lock, so that
a broken access rule or an unlocked demo table is caught in CI instead of on a
live project.

**Type:** New capability · **Complexity:** Medium
**Portals:** none (CI and delivery tooling) · **Supabase:** no (reads
`supabase/schema/*.sql`, writes nothing under `supabase/`, touches no project)

## Inherited decisions

- CI proves the SQL on a throwaway database with only synthetic data and no
  credentials. `architecture.md#recommended-approach` (part 1)
- S1's decision rule: bare `supabase/postgres` image if the files pass there;
  otherwise `supabase db start` with its `config.toml` outside `supabase/`
  (`--workdir`); otherwise plain Postgres with a stubbed `auth`.
  `architecture.md#spikes`
- No `config.toml` and no `supabase/migrations/` under `supabase/`, so the
  GitHub integration never sees one. `architecture.md#supabase-impact-owner-approval`
- The deliver command reaches a database through an **executor** interface,
  with `psql` against the CI container as one implementation.
  `architecture.md#data-seams-and-demo-mode-behaviour`
- The demo lock proof is three `demo_deny_*` policies on every public table,
  and zero on a school shape. `architecture.md#data-seams-and-demo-mode-behaviour`
- No new runtime dependency; `psql` is preinstalled on GitHub's Ubuntu runners
  and the Supabase CLI is already a devDependency.
  `architecture.md#other-build-vs-buy`
- New modules live in `scripts/delivery/`, JSDoc-typed and added to
  `typecheck`. `architecture.md#architecture_map-rows-to-add`

## S1 result (spike run on 2026-10-08, in this session)

| Option                                                                      | Result                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bare `supabase/postgres:17.11.0.004` (also how a service container runs it) | Baseline applies. **Audit fails** at `student sees only their own student row`: the image's `auth.uid()` / `auth.role()` read only the legacy `request.jwt.claim.sub` / `.role` settings. GoTrue's migrations replace them with the `request.jwt.claims` versions the audit uses. |
| `npx supabase db start --workdir <dir>` (CLI 2.104.0, `major_version = 17`) | Runs GoTrue's migrations. Image `public.ecr.aws/supabase/postgres:17.6.1.132` with `gotrue:v2.189.0`. School audit **passes**; `demo_lockdown.sql` locks 30 tables (90 policies); demo audit **passes**. Fresh start 2m08s with image pulls, 25s cached.                          |
| Same with `major_version = 15`                                              | Image `postgres:15.8.1.085`. Both shapes **pass**.                                                                                                                                                                                                                                |

Decision, by the rule: **`supabase db start`**, from a minimal `config.toml`
(`project_id` plus `[db] major_version = 17`) at
`scripts/delivery/harness/supabase/config.toml`. Recorded under S1 in
`architecture.md` by task 7.

## Out of scope

- "Upgrade ≡ fresh" and re-run checks (#97), expected fingerprints (#93),
  provisioning through deliver (#103).
- Any edit under `supabase/`. The three SQL files are read only.
- `format:check` and dependency checks in CI (#92). The `quality` job is not
  touched.
- Live projects. Nothing here connects to the demo or the pilot.
- Not changing: `test/rls.live.test.js` (the PostgREST-level audit stays
  opt-in and manual).

## Context references — read before implementing

- `supabase/schema/rls_audit.sql` lines 66–75, 81–96, 98–111: every failure is
  `raise exception 'FAIL [<check>]: …'` (SQLSTATE P0001); line 644: the
  `RLS AUDIT: ALL CHECKS PASSED` summary. Header lines 31–35: no summary line
  means the run did not finish, which is a failure.
- `supabase/schema/demo_lockdown.sql` lines 105–116: its own gap query counts
  `policyname like 'demo\_deny\_%'` per `pg_tables` row. The proof mirrors
  this.
- `supabase/schema/school_schema.sql` lines 425–428: the trigger on
  `auth.users`, the reason the harness needs GoTrue's `auth` schema.
- `.github/workflows/ci.yml` lines 31–49: the `e2e` job, the shape to mirror.
- `test/rls.live.test.js` lines 4–30, 80: the opt-in header and
  `describe.skipIf`.
- `scripts/build-sprite.mjs` lines 14–24: Node script style (`node:` imports,
  `fileURLToPath(import.meta.url)`).
- `eslint.config.js` lines 34–46: `scripts/**/*.{js,mjs}` already gets Node
  globals. `js.configs.recommended` makes an unused argument an **error**
  there.
- `tsconfig.json`: `include` is `src/js/**/*.js`, `types` is `vite/client`.

### Patterns to follow

Opt-in database tests (`test/rls.live.test.js:80`):

```js
describe.skipIf(!live)("live RLS audit", () => {
```

CI job shape (`.github/workflows/ci.yml:31-42`):

```yaml
e2e:
  name: playwright e2e
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v6
    - uses: actions/setup-node@v6
      with:
        node-version: 24
        cache: npm
    - run: npm ci
```

Lock gap semantics (`supabase/schema/demo_lockdown.sql:106-112`):

```sql
select string_agg(t.tablename, ', ' order by t.tablename) into gaps
  from pg_tables t
 where t.schemaname = 'public'
   and (select count(*) from pg_policies p
         where p.schemaname = 'public'
           and p.tablename = t.tablename
           and p.policyname like 'demo\_deny\_%') <> 3;
```

## Phase R — acceptance checks, red before any implementation

| AC  | Behaviour                                                                                                                  | Kind | Where (file › test name)                                                                              | Command                                                                                                                                   | Expected red                                  |
| --- | -------------------------------------------------------------------------------------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| AC1 | The committed baseline passes the audit with no `demo_deny_*` policy (school) and with exactly three on every table (demo) | unit | `test/schemaHarness.db.test.js` › "passes the committed baseline in the school and demo shapes"       | `SMP_SCHEMA_DB_URL=… npx vitest run test/schemaHarness.db.test.js -t "passes the committed baseline in the school and demo shapes"`       | school audit `{ ok: false }` ≠ `{ ok: true }` |
| AC2 | A fixture that drops one access rule fails the school shape, and the failure names the audit check                         | unit | `test/schemaHarness.db.test.js` › "fails the school shape when the audit finds a missing access rule" | `SMP_SCHEMA_DB_URL=… npx vitest run test/schemaHarness.db.test.js -t "fails the school shape when the audit finds a missing access rule"` | `check: null` ≠ the check's name              |
| AC3 | A fixture that removes one table's locks fails the demo shape, naming that table                                           | unit | `test/schemaHarness.db.test.js` › "fails the demo shape when a table lacks its three demo locks"      | `SMP_SCHEMA_DB_URL=… npx vitest run test/schemaHarness.db.test.js -t "fails the demo shape when a table lacks its three demo locks"`      | `tables: []` ≠ `['guardians']`                |
| AC4 | The `schema` job runs on every PR, gives the harness tests their database URL, references no secret                        | unit | `test/ciWorkflow.test.js` › "runs the schema job on every pull request without any secret"            | `npx vitest run test/ciWorkflow.test.js -t "runs the schema job on every pull request without any secret"`                                | no `schema` job: `expected 0 > 0`             |

`SMP_SCHEMA_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres`,
after `npx supabase db start --workdir <a dir holding supabase/config.toml>`
(task 6 commits that dir as `scripts/delivery/harness`).

Fixtures (frozen with the tests):

- `test/fixtures/delivery/drop_student_self_read.sql` drops
  `"Users can read their own student record"` on `public.students`. The audit
  then fails at `student sees only their own student row` (checked by hand on
  a clone: `ERROR:  P0001: FAIL [student sees only their own student row]: expected 1 row(s), got 0`).
- `test/fixtures/delivery/unlock_guardians.sql` drops the three
  `demo_deny_*` policies on `public.guardians`. The demo audit still prints
  `RLS AUDIT: ALL CHECKS PASSED` (it never writes `guardians`), so only the
  per-table lock proof can catch it. That is why the proof exists.
  `rooms` and `attendance` are avoided on purpose: the audit uses them to
  detect the demo lock.

How the db tests get a clean database: `beforeAll` makes
`smp_harness_template` once (as the CLI's local `supabase_admin`, which ends
the pg_net and pg_cron workers' sessions on `postgres` so it can be copied),
and each test clones it as `postgres` and drops the clone afterwards. The
harness itself never touches the server's `postgres` database.

**STUB tasks** (done in Phase R):

- STUB `scripts/delivery/executors/psql.mjs`: `createPsqlExecutor()` returns
  an executor whose `runFile` / `runStatement` resolve a not-run result.
- STUB `scripts/delivery/schemaHarness.mjs`: `runSchemaHarness()` returns
  `{ ok: false, school, demo }` with neutral shape results (`lock.counts {}`,
  `lock.tables []`, `audit.check null`), so every assertion is reachable.

Stubs take no parameters, because `js.configs.recommended` makes an unused
argument an error in `scripts/**`. The real signatures come in tasks 2 and 4.

**Red evidence** (run 2026-10-08 against a fresh `supabase db start`, 17.6.1.132):

- AC1: `npx vitest run test/schemaHarness.db.test.js -t "passes the committed baseline in the school and demo shapes"` → `AssertionError: expected { ok: false, check: null, …(2) } to match object { ok: true }` ✅ valid red
- AC2: `npx vitest run test/schemaHarness.db.test.js -t "fails the school shape when the audit finds a missing access rule"` → `AssertionError: expected { ok: false, check: null, …(2) } to match object { ok: false, …(1) }` ✅ valid red
- AC3: `npx vitest run test/schemaHarness.db.test.js -t "fails the demo shape when a table lacks its three demo locks"` → `AssertionError: expected { ok: false, counts: {}, …(2) } to match object { ok: false, tables: [ 'guardians' ] }` ✅ valid red
- AC4: `npx vitest run test/ciWorkflow.test.js -t "runs the schema job on every pull request without any secret"` → `AssertionError: expected 0 to be greater than 0` ✅ valid red
- `npm test` without the URL: the db file reports 3 skipped. The only other
  failure is `test/i18n.test.js` › "formats 24h time strings to the locale's
  12h form", which fails in this container on `main` too (Node 22 / ICU 77
  prints U+202F in "p. m."; CI runs Node 24). Not this ticket's.

## Implementation tasks

Run top to bottom. Each task has its own Validate and isn't done until it
passes. Start a local server first:
`npx supabase db start --workdir scripts/delivery/harness` (after task 6, or
any dir holding the same `config.toml`), then
`export SMP_SCHEMA_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres`.

### 1. ADD Node types for the delivery scripts

- **Implement:** `npm i -D @types/node@^24`. In `tsconfig.json`, add
  `"scripts/delivery/**/*.mjs"` to `include` and `"node"` to `types`. Keep
  every existing comment and exclude.
- **Gotcha:** probed in this session: adding `node` to `types` leaves
  `npm run typecheck` clean over `src/js`.
- **Validate:** `npm run typecheck`
- **Satisfies:** ticket context (JSDoc-typed modules in `typecheck`)

### 2. CREATE `scripts/delivery/executors/psql.mjs` (replace the stub)

- **Implement:**
  - Keep the `ExecResult` and `Executor` typedefs.
    `ExecResult = { ok, sqlstate, error, notices, rows }`.
  - `connectionEnv(databaseUrl)`: split the URL into `PGHOST`, `PGPORT`,
    `PGUSER`, `PGPASSWORD` (URL-decoded), `PGDATABASE`, plus `PGSSLMODE` from
    `?sslmode=`. The password never goes on the command line.
  - `parseMessages(stderr)`: each line matching
    `^(?:psql:[^:]*:\d+: )?(ERROR|FATAL|WARNING|NOTICE|INFO):\s+(?:([0-9A-Z]{5}): )?(.*)$`
    starts a message. `LOCATION:`, `CONTEXT:`, `DETAIL:`, `HINT:`, `QUERY:`,
    `STATEMENT:` and `LINE n:` lines are dropped. Any other line continues the
    previous message (multi-line query text in a FAIL). Returns
    `{ notices: string[], error: { sqlstate, message } | null }`, where error
    is the first ERROR or FATAL.
  - `createPsqlExecutor({ databaseUrl, psql = "psql" })` returns
    `{ runFile(file), runStatement(sql) }`. Each spawns `psql` with
    `-X -q -A -t -F \x1f -v ON_ERROR_STOP=1 -v VERBOSITY=verbose` plus
    `-f <file>` or `-c <sql>`, and env `{ ...process.env, ...connectionEnv() }`.
    It resolves (never rejects) to
    `{ ok: code === 0 && !error, sqlstate, error: message, notices, rows }`.
    `rows` is stdout split on `\n` (empties dropped), then on `\x1f`. With a
    non-zero exit and no parsed ERROR, `error` is the last non-empty stderr
    line (connection failures print `psql: error: …`). A spawn `error` event
    (no `psql` on PATH) resolves `ok: false` with that message.
- **Gotcha:** `VERBOSITY=verbose` is what puts the SQLSTATE on the line
  (`ERROR:  P0001: FAIL [...]`). It also prefixes notices with `00000:`,
  which the regex strips.
- **Validate:** `npx eslint scripts/delivery && npm run typecheck`
- **Satisfies:** AC1–AC3 (the executor the harness runs on)

### 3. CREATE `scripts/delivery/proofs.mjs`

- **Implement:**
  - `export const AUDIT_SUMMARY = "RLS AUDIT: ALL CHECKS PASSED"`.
  - `proveAudit(executor, auditFile)` returns
    `{ ok, check, sqlstate, error }`. It passes only when the run is `ok` **and**
    a notice contains `AUDIT_SUMMARY`. On failure, `check` is the label from
    `/^FAIL \[(.+?)\]/` on the error (or `null`). A run that ends without the
    summary gets the error `"the audit ended without its summary line"`.
  - `demoLockCounts(executor)` returns `{ counts, error }`. It runs
    `select t.tablename, count(p.policyname) from pg_tables t left join pg_policies p on p.schemaname = t.schemaname and p.tablename = t.tablename and p.policyname like 'demo\_deny\_%' where t.schemaname = 'public' group by t.tablename order by t.tablename`
    and builds `counts` as a `Record<string, number>` of every public table.
  - `proveDemoLock(executor, shape)`, where `shape` is `"school" | "demo"`,
    returns `{ ok, counts, tables, error }`. It expects 0 per table for school
    and 3 for demo. `tables` lists the tables whose count differs, sorted.
    `ok` requires no error, no differing table and at least one table.
  - JSDoc typedefs `AuditProof` and `LockProof`. The deliver command will
    import these later, so nothing here is CI-specific.
- **Validate:** `npx eslint scripts/delivery && npm run typecheck`
- **Satisfies:** AC1 (counts), AC2 (`check`), AC3 (`tables`)

### 4. CREATE `scripts/delivery/schemaHarness.mjs` (replace the stub)

- **Implement:**
  - `export const SCHEMA_DIR = fileURLToPath(new URL("../../supabase/schema/", import.meta.url))`.
  - `runSchemaHarness({ executor, schemaDir = SCHEMA_DIR, afterBaseline = [], afterLockdown = [] })`
    returns `{ ok, school, demo }`. Each shape is
    `{ ok, applied: { ok, file, sqlstate, error }[], lock: LockProof, audit: AuditProof }`.
  - School: apply `school_schema.sql`, then each `afterBaseline` file, stopping
    at the first failed apply. Then `proveDemoLock(…, "school")` and
    `proveAudit(…, rls_audit.sql)`.
  - Demo: apply `demo_lockdown.sql`, then each `afterLockdown` file, then
    `proveDemoLock(…, "demo")` and `proveAudit`. It runs whenever the school
    applies succeeded, even if the school proofs failed. If a school apply
    failed, the demo shape is not run: `ok: false`, an empty `applied`, and
    proofs with the error `"not run: the school shape did not apply"`.
  - A shape's `ok` is every apply ok, `lock.ok` and `audit.ok`. The top-level
    `ok` is `school.ok && demo.ok`.
- **Gotcha:** `rls_audit.sql` opens and rolls back its own transaction, so it
  can run twice on one database. Never wrap a shape in a transaction.
- **Validate:**
  `npx vitest run test/schemaHarness.db.test.js` (with `SMP_SCHEMA_DB_URL`)
- **Satisfies:** AC1, AC2, AC3

### 5. UPDATE `.github/workflows/ci.yml`: append the `schema` job after `e2e`

- **Implement:**
  ```yaml
  schema:
    name: schema · baseline and access audit
    runs-on: ubuntu-latest
    env:
      SMP_SCHEMA_DB_URL: postgresql://postgres:postgres@127.0.0.1:54322/postgres
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npx supabase db start --workdir scripts/delivery/harness
      - run: npx vitest run test/schemaHarness.db.test.js
  ```
  `postgres:postgres` is the CLI's fixed local password on a container that
  lives for one job. It is not a secret. Leave `quality` and `e2e` untouched
  (#92 edits `quality`).
- **Validate:** `npx vitest run test/ciWorkflow.test.js`
- **Satisfies:** AC4

### 6. CREATE `scripts/delivery/harness/supabase/config.toml` and its `.gitignore`

- **Implement:** `config.toml` is `project_id = "smp-schema-harness"`, a blank
  line, then `[db]` and `major_version = 17`. Add a `.gitignore` next to it
  holding `.branches` and `.temp` (the CLI writes both there).
- **Validate:** stop the scratch server, then
  `npx supabase db start --workdir scripts/delivery/harness` and the full db
  test file (all 3 pass). `git status --short` shows no `.branches`.
- **Satisfies:** AC1–AC3 in CI

### 7. UPDATE the docs

- **Implement:**
  - `docs/epics/delivery-pipeline/architecture.md`, under **S1**: a
    `Result (2026-10-08, #87):` paragraph. Give the table above in prose:
    bare image fails on the legacy `auth.uid()`; `supabase db start` (CLI
    2.104.0 → `postgres:17.6.1.132`, `gotrue:v2.189.0`) passes both shapes;
    15 also passes; the chosen `--workdir` and the per-test template clone.
  - `docs/ONBOARDING_RUNBOOK.md` § "Verifying RLS": one sentence saying CI's
    `schema` job runs the file in both shapes against a throwaway database on
    every pull request, which does not replace running it on a project after
    a change.
- **Validate:** `npx prettier --check docs/epics/delivery-pipeline/architecture.md docs/ONBOARDING_RUNBOOK.md`
- **Satisfies:** ticket context (record S1)

### 8. UPDATE `.claude/ARCHITECTURE_MAP.md`

- **Implement:** a `## Delivery` section right after `## Backend (`supabase/`)`,
  holding one table (`Path` | `Responsibility`) sorted by path. Rows:
  - `.github/workflows/ci.yml` (`schema` job): starts the CLI's Postgres from
    `scripts/delivery/harness` and runs `test/schemaHarness.db.test.js`
    (both shapes) on every PR, with no secret.
  - `scripts/delivery/executors/psql.mjs`
  - `scripts/delivery/proofs.mjs`
  - `scripts/delivery/schemaHarness.mjs`

  Add one line under the table saying later tickets insert their rows in path
  order.

- **Validate:** every path in the table exists (`ls`).
- **Satisfies:** ticket context

### 9. Turn Phase R green

- **Validate:** all four Phase R commands pass; `npm run lint && npm run typecheck && npm test && npm run build`.

## Validation commands

```bash
npm run format:check && npm run lint && npm run typecheck
npm test
npm run build
npm run test:e2e
npx supabase db start --workdir scripts/delivery/harness
SMP_SCHEMA_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run test/schemaHarness.db.test.js
```

Plus each Phase R command above.

## Open questions / assumptions

Each has a default the loop uses if the reviewer approves without overriding it.

1. **Which Postgres major are the demo and the pilot on?** The repo doesn't
   record it (Dashboard → Settings → Infrastructure shows it). — **Default:**
   run 17 only, which is the CLI's default and what a new school project gets.
   Both 15 and 17 pass today. If either project is on 15, a follow-up adds a
   second workdir with `major_version = 15` as a job matrix.
   Resolved: default stands (17 only), approved 2026-10-08.
2. **Add `@types/node` as a devDependency?** `tsc` needs it to type
   `node:child_process` in the new modules. The ticket allows "Node types if
   `tsc` needs them". It's dev-only and ships nothing. — **Default:** yes,
   `@types/node@^24`.
   Resolved: default stands (add `@types/node@^24`), approved 2026-10-08.
3. **Test isolation uses the CLI's local superuser** (`supabase_admin`, same
   local password) once per run. It ends the pg_net and pg_cron worker sessions
   on `postgres` so the pristine database can be copied as a template. This
   happens only in the test file, against a throwaway local server, and
   against a real project that login fails before anything runs. — **Default:**
   accept. The alternative, resetting `public` in place between tests, would
   drop the default privileges Supabase sets on that schema. It could also
   wipe a developer's local database if the URL pointed at one.
   Resolved: default stands (template clones), approved 2026-10-08.

## Notes

- **Why not the bare image as a service container:** its `auth.uid()` is the
  pre-GoTrue version (spike table above). Running GoTrue's `migrate` in a
  one-off container next to a service container would also work, but it means
  pinning two image tags by hand. The CLI pins both through `package-lock.json`
  and is the S1 rule's own second branch.
- **Image drift:** the images follow the CLI version in `package-lock.json`. A
  Dependabot bump of `supabase` (#92) moves them, and the job log prints the
  pulled tags.
- **A skipped db test is green.** If the URL ever went missing from the job,
  the three tests would report as skipped. AC4 pins the URL in the job to
  prevent that.
- **The guard:** `.claude/hooks/guard.mjs` matches `npx supabase db …`, so an
  agent session running `supabase db start` locally is asked (Default mode) or
  refused (other modes), although it only starts a local container. In this
  session, `psql` and `npx supabase db start` against the local container ran
  without a prompt. Left as is (Not in this change).
- **Coupling check:** the implementation lives in `scripts/delivery/`,
  `.github/workflows/ci.yml` and `tsconfig.json`, not `src/`. The acceptance
  validator's revert step should restore those paths to the red commit.
- Fresh-runner cost: about 2 minutes to pull the images, then about 30 s of
  tests. Free on a public repo.

## AMENDMENTS

Append-only. Every change to this plan or to a frozen acceptance test after the
red commit goes here: date — what changed — why.

- 2026-10-08 — Task 6's Validate ran as a byte-for-byte `diff` of the
  committed `scripts/delivery/harness/supabase/config.toml` against the config
  the local server was started from (identical), instead of a restart from the
  committed path. Mid-implementation, the PreToolUse guard began refusing
  `psql …` and `npx supabase db …` command lines (this session isn't in
  Default mode). It refuses them even against the local throwaway container.
  CI's first run is the restart from the committed path. No acceptance test or
  AC changed.
- 2026-10-08 — Added `test/deliveryProofs.test.js` (7 tests, no database
  needed): the audit proof fails a run with no summary line, the FAIL label is
  read, both lock directions are checked, a failed or empty count fails, and
  the executor's verbose-stderr parsing and password-free `connectionEnv` work.
  These cover behaviour the db-only ACs don't, and they run in the `quality`
  job. Not a frozen test.
- 2026-10-08 — Task 1 changed after review round 1. The root `tsconfig.json`
  is back to `main` (`types: ["vite/client"]`, `src/js` only). A new
  `tsconfig.scripts.json` extends it with `types: ["node"]` and
  `lib: ["ES2022"]` and includes `scripts/delivery/**/*.mjs`. `npm run
typecheck` runs both. Reason: `"node"` in the root `types` let `src/js`
  type-check `process` and `Buffer`, which don't exist in the browser. The
  delivery scripts are still type-checked, which is the ticket's intent. No
  acceptance test changed.

## Manual Supabase steps

- None.

## Validation

Branch `feat/ci-schema-harness`, run 2026-10-08 in the cloud container (Node
22.22). AC1–AC3 ran against `npx supabase db start` (CLI 2.104.0,
`postgres:17.6.1.132`).

| Check               | Result                    | Notes                                                                                                                                                                                                                                                          |
| ------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| format:check        | ✅                        |                                                                                                                                                                                                                                                                |
| lint                | ✅                        |                                                                                                                                                                                                                                                                |
| typecheck           | ✅                        | now includes `scripts/delivery/**/*.mjs` with Node types                                                                                                                                                                                                       |
| unit                | ✅ 506 passed, 19 skipped | 1 failure not this branch's: `test/i18n.test.js` › "formats 24h time strings to the locale's 12h form" fails identically on an `origin/main` worktree in this container (Node 22 / ICU 77 prints U+202F). CI runs Node 24.                                     |
| build               | ✅                        |                                                                                                                                                                                                                                                                |
| e2e                 | ✅ 119                    | `playwright.local.config.js` (bundled Chromium 1228 missing; used `/opt/pw-browsers/chromium-1194`). Two full runs each hit 1–2 `page.goto` 30 s timeouts on different specs; those specs pass when re-run (16/16). No `src/` or `e2e/` change on this branch. |
| AC1 (unit)          | ✅                        |                                                                                                                                                                                                                                                                |
| AC2 (unit)          | ✅                        |                                                                                                                                                                                                                                                                |
| AC3 (unit)          | ✅                        |                                                                                                                                                                                                                                                                |
| AC4 (unit)          | ✅                        |                                                                                                                                                                                                                                                                |
| skip/only           | ✅ clean                  |                                                                                                                                                                                                                                                                |
| entry-point order   | ✅                        | the check printed "errorHandler not first in src/js/admin.js": its `head -20` window ends before line 22, where `import "./errorHandler.js"` is the first import. A false positive in the check.                                                               |
| supabase/ untouched | ✅                        |                                                                                                                                                                                                                                                                |

**Overall: PASS**, with the two environment exceptions above shown to be
unrelated to this branch.

| AC  | Kind | Red before (Phase R)                                                                              | Green after |
| --- | ---- | ------------------------------------------------------------------------------------------------- | ----------- |
| AC1 | unit | `expected { ok: false, check: null, …(2) } to match object { ok: true }`                          | ✅ 1386 ms  |
| AC2 | unit | `expected { ok: false, check: null, …(2) } to match object { ok: false, …(1) }`                   | ✅ 1113 ms  |
| AC3 | unit | `expected { ok: false, counts: {}, …(2) } to match object { ok: false, tables: [ 'guardians' ] }` | ✅ 1180 ms  |
| AC4 | unit | `expected 0 to be greater than 0`                                                                 | ✅          |

### Review (round 1)

**Verdict:** fix before PR · **Acceptance:** UNPROVEN (AC1, AC2, AC3) · AC4 PASS

| AC  | Kind | Exists | Faithful | Passes  | Coupled                                        | Frozen    | Probe | Verdict  |
| --- | ---- | ------ | -------- | ------- | ---------------------------------------------- | --------- | ----- | -------- |
| AC1 | unit | ✅     | ✅       | not run | not run (statically would fail at RED)         | unchanged | n/a   | UNPROVEN |
| AC2 | unit | ✅     | ✅       | not run | not run (statically would fail at RED)         | unchanged | n/a   | UNPROVEN |
| AC3 | unit | ✅     | ✅       | not run | not run (statically would fail at RED)         | unchanged | n/a   | UNPROVEN |
| AC4 | unit | ✅     | ✅       | ✅      | ✅ fails at RED (`scripts`/`.github` reverted) | unchanged | n/a   | PASS     |

The validator could not run AC1–AC3. The guard refused `npx supabase db start`
and `psql` in this session's permission mode, so it reached no database to
check "passes" at HEAD or "coupled" at RED.

Findings: 1 High, 1 Medium, 2 Low.

- High: `test/schemaHarness.db.test.js:105,144,158`. AC1–AC3 are UNPROVEN
  because the evidence is missing (environment), not the behaviour.
- Medium: `tsconfig.json:10`. `"node"` in the root `types` exposes Node
  globals to `src/js` (confirmed with a `process`/`Buffer` probe).
- Low: `scripts/delivery/executors/psql.mjs:39-40,101`. Inherited `PG*`
  variables apply, and unknown URL parameters are dropped silently.
- Low: `CLAUDE.md:70`. The CI summary doesn't name the `schema` job.

Outcomes (unattended policy):

- Fixed: Node globals visible to `src/js` (`tsconfig.json:10`) →
  `test/typecheckConfig.test.js` › "type-checks Node code only in the delivery
  scripts". It was red with
  `expected [ 'vite/client', 'node' ] to not include 'node'`. Now
  `tsconfig.scripts.json` checks the three delivery modules, and a
  `process`/`Buffer` probe in `src/js` fails `npm run typecheck` again
  (TS2591).
- Not in this change: `psql.mjs` merges `connectionEnv` over inherited `PG*`
  variables and drops URL parameters other than `sslmode` (Low). It's harmless
  for the CI harness, which builds its own URL. It matters when the deliver
  command reuses the executor with a project URL, so that ticket should strip
  inherited `PG*` keys and reject unknown parameters.
- Not in this change: `CLAUDE.md:70` doesn't name the `schema` job (Low). One
  clause, for the owner to fold into the next `CLAUDE.md` edit or the epic's
  process-docs ticket.
- Needs your decision: AC1–AC3 are UNPROVEN by the independent validator
  (High, evidence missing). This session isn't in Default permission mode, so
  the guard refuses `npx supabase db start` and `psql`, and the validator
  could reach no database. The author's evidence: red at `6ca0b41` (Phase R
  table) and green at HEAD against the CLI's 17.6.1.132 database. The PR's
  `schema` job will also show them passing. **Recommendation:** once CI is
  green, re-run the validator in a Default-mode session, or run the two-step
  recipe in `test/schemaHarness.db.test.js` at HEAD and at `6ca0b41`. Then
  mark the PR ready.

### Review (round 2, final)

**Verdict:** clean code, with acceptance blocked by the environment ·
**Acceptance:** UNPROVEN (AC1, AC2, AC3) · AC4 PASS. Reviewed at `27b10d0`.

| AC  | Kind | Exists | Faithful | Passes  | Coupled           | Frozen    | Probe      | Verdict  |
| --- | ---- | ------ | -------- | ------- | ----------------- | --------- | ---------- | -------- |
| AC1 | unit | yes    | yes      | not run | not run           | unchanged | n/a (unit) | UNPROVEN |
| AC2 | unit | yes    | yes      | not run | not run           | unchanged | n/a (unit) | UNPROVEN |
| AC3 | unit | yes    | yes      | not run | not run           | unchanged | n/a (unit) | UNPROVEN |
| AC4 | unit | yes    | yes      | yes     | yes, fails at RED | unchanged | n/a (unit) | PASS     |

The cause is the same as round 1: the guard refused `npx supabase db start`.
The validator restored `scripts` and `.github` to RED for AC4's coupling check.

Findings: 0 Critical, 0 High (beyond the round-1 acceptance item, still
open), 0 Medium, 3 Low.

- Not in this change: `scripts/delivery/executors/psql.mjs:86-101` spawns
  `psql` without `-w` and leaves stdin open as a pipe. With a URL that has no
  password, `PGPASSWORD=""` also clears any inherited one, so a server that
  asks for a password makes the run hang instead of failing. That can't
  happen with the CI URL. Fold it into the deliver ticket that reuses the
  executor, with the round-1 `PG*` item.
- Not in this change: `psql.mjs:105-106` builds stdout and stderr with
  `+= chunk`, so a UTF-8 character split across chunks turns into U+FFFD. It
  doesn't happen at the audit's output size. Fix with `setEncoding("utf8")`
  in the same follow-up.
- Not in this change: `test/schemaHarness.db.test.js:53-54` passes the URL,
  password included, as `-d url` to its own `psql` helper. It's harmless with
  the CLI's fixed local password. The file is a frozen acceptance test, so
  changing it would need an amendment. Fold it in if the test is ever amended
  for another reason.
- The reviewer confirmed the round-1 fix with throwaway configs. The scripts
  config reports type errors in the `.mjs` modules (TS2322) and has no DOM
  (TS2584). `src/js` still rejects `process` and `Buffer` (TS2591).

## Execution report

**Files:** +13 ~6 −0 · **Lines:** +1357 −1 (the plan alone is about 560) ·
**Review rounds:** 2 (one fix round) · **Outcome:** draft. AC1–AC3 are
UNPROVEN by the independent validator because the guard refused database
access in this session's permission mode.

### Validation summary

format ✅ · lint ✅ · types ✅ (two configs) · unit ✅ (507; one pre-existing
Node 22/ICU failure that also fails on `main` here) · build ✅ · e2e ✅ (119,
local Chromium config) · acceptance validator: AC4 PASS, AC1–AC3 UNPROVEN
(not run). The author ran AC1–AC3 red at `6ca0b41` and green at HEAD.

### What went well

- **Running the S1 spike before writing the plan.** The bare-image failure
  (`auth.uid()` reads only `request.jwt.claim.sub`) showed up in minutes, and
  the decision rule picked `supabase db start` without debate. Gate 1 had
  evidence instead of a guess.
- **Checking both fixtures by hand on a real clone before the red commit.** It
  showed that unlocking `guardians` leaves the audit green. That is the case
  only the per-table proof catches, and it is why the fixture avoids `rooms`
  and `attendance`, which the audit uses to detect the lock.
- **Cloning a template per test.** Isolation came for free, AC1–AC3 run in
  about 1 s each, and the server's own `postgres` database is never touched.
- **The fresh-context reviewer.** It caught the `types: ["node"]` leak that
  the author's own probe had passed: the probe checked that `src/js` still
  compiled, not that Node globals were still rejected.

### Divergences from the plan

- **Typecheck config.** Planned: add `scripts/delivery/**/*.mjs` and `"node"`
  to the root `tsconfig.json`, as the ticket said. Actual: a separate
  `tsconfig.scripts.json`, with `typecheck` running both. Why: the root change
  let `src/js` type-check `process` and `Buffer`. Type: plan assumption wrong.
  The ticket's wording ("add to tsconfig.json include, with Node types")
  became a plan task with no check that browser code still rejects Node
  globals.
- **Task 6 validation.** Planned: restart the CLI database from the committed
  workdir. Actual: a byte-for-byte diff against the config the running server
  used. Why: partway through, the guard began refusing `psql` and
  `supabase db` command lines in this permission mode. Type: missing context.
- **An extra unit test file** (`test/deliveryProofs.test.js`, 7 tests). Not
  planned. It covers the "no summary line means fail" rule and the stderr
  parsing, which the db-only ACs don't. Type: better approach found.

### Challenges

- **The guard against a local container.** `.claude/hooks/guard.mjs` matches
  `psql` and `supabase db` by command text. That also catches a filename
  (`executors/psql.mjs` inside a `node -e` script) and a throwaway local
  database the ticket itself prescribes. Early in the session the same
  commands ran without a prompt; later, outside Default mode, they were
  denied. The independent validator then couldn't run AC1–AC3 in either
  round. That is what keeps this PR a draft.
- **Container restarts.** Each worker restart stopped `dockerd`. The CLI
  container has a restart policy, so restarting the daemon brought it back,
  but every resume needed that step first.
- **A template from `postgres`.** The pg_net and pg_cron workers stay
  connected to `postgres`, so `create database … template postgres` fails
  unless a superuser ends their sessions first. The test does that once, with
  the CLI's local `supabase_admin`, and marks the copy `is_template`.
- **Environment noise in the ladder.** One i18n case fails under Node 22 /
  ICU 77 (CI runs Node 24). Playwright's bundled Chromium build was missing.
  Full e2e runs hit random `page.goto` timeouts that pass on re-run. Each one
  needed proving to be unrelated.

### Skipped

- Restarting the CLI database from the committed workdir (task 6). The guard
  refused it; CI's `schema` job is the first run from that path.
- Independent proof of AC1–AC3 (passes and coupled). Waiting on the owner.

### Recommendations

- **References (validation ladder, acceptance validator):** a ticket whose
  checks need a local database (here `supabase db start`) can't be
  independently validated outside Default mode. Either let the guard allow
  `supabase db start` / `stop` and `psql` aimed at `127.0.0.1:54322`, or tell
  the loop up front, at A1, that such a ticket must run in a Default-mode
  session, the same warning `Supabase: yes` already gets. Today it fails late,
  at B3.
- **Validation ladder:** the coupling recipe restores only `src`, `public` and
  the HTML entry points. Tooling tickets live in `scripts/` and `.github/`.
  The validator worked that out each time, but the ladder should say "restore
  every path the change touches" (or list `scripts/` and `.github/`).
- **piv-validate:** the entry-point-order check uses `head -20`, and
  `src/js/admin.js`'s header comment pushes `import "./errorHandler.js"` to
  line 22, so it reports a false failure on every branch. Use the first
  `^import ` line wherever it is, for example
  `grep -m1 -E '^import ' "$f" | grep -q errorHandler`.
- **Plan skill:** when a ticket says to widen `tsconfig` types or lib, add a
  task check that the browser config still rejects what it should (a
  `process` probe in `src/js`), not only that it still compiles.
- **Ticket slicing:** size and checks were right for an M ticket. AC4 guards
  the one silent failure, skipped db tests showing green. The Postgres major of
  the projects is still unrecorded; the deliver or fingerprint tickets should
  capture it.
