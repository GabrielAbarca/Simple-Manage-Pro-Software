# Delivery pipeline — Architecture

**Status:** Decided 2026-10-08 · **PRD:** ./prd.md

## Problem and goals

Database changes (schema, access rules, the demo lock, the `admin-users` Edge
Function, Auth settings) reach SMP's Supabase projects by hand, in an order
that exists only in prose, with no proof and no record. Meanwhile every merge
to `main` deploys both sites at once, whether or not their databases are
ready. Before G3 adds a role, its access rules and four to six database
changes, delivery has to be repeatable, checked and recorded, and the owner
has to approve every change that touches Supabase. The lens for every
decision below:

- nothing reaches Supabase without the owner's approval;
- an app version never runs ahead of its database on any site;
- each project's state can be read from a record and proved live;
- zero extra cost, and nothing sensitive in a public log.

## Approaches considered

**Where a Supabase delivery runs, and what enforces approval**

| Option                                                                                                  | For                                                                                                                                       | Against                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. A command the owner runs** (chosen)                                                                | Credentials exist only on the owner's machine, so neither a session nor CI can complete a delivery. No new service. Can move to CI later. | The owner must be at a terminal for each delivery. Approval lives in the record, not in a platform audit log.                                                                                                                            |
| B. GitHub Actions with one protected Environment per project                                            | One click to approve. GitHub records the approval and the deployment.                                                                     | An org-wide Supabase token sits in the CI of a public repo. Public logs can carry Postgres error details (key values) from a school project. Anything holding the owner's GitHub token can approve a pending deployment through the API. |
| C. Supabase migrations (`supabase/migrations/`, a baseline, `migration repair`, the GitHub integration) | The standard Supabase route, with a history the platform tracks.                                                                          | One-way. It clashes with the demo's out-of-band objects. A merge applies the change with no approval per project. The integration reaches only the linked demo project.                                                                  |

**How an app deploy is held until its database change is proved**

| Option                                                                 | For                                                                                                                                                                              | Against                                                                                                                                       |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **Release workflow, a `production` branch, and a build gate** (chosen) | Every production deploy is a tag. Merging no longer deploys (evidence 6). The gate runs twice: in the release workflow, then in each site's build. Uses no external credentials. | Each release costs one dispatch and one approval.                                                                                             |
| `main` stays the production branch, with only the build gate           | The leanest option, with no release step.                                                                                                                                        | Versions are commit SHAs. Tags would exist only at milestones, so not every deploy maps to a tag, which the PRD's MVP asks for.               |
| Staged production with `vercel promote` per site                       | Each site moves on its own.                                                                                                                                                      | A Vercel token on the owner's machine, a gate that runs per site by hand, and a feature whose availability on the current plan is unverified. |

**Where the project's state is recorded**

| Option                                                    | For                                                                                                                                                                | Against                                                                             |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| **A record in the repo plus a live fingerprint** (chosen) | Readable without credentials in under 10 minutes. Edits fall under the existing guard. The fingerprint proves what _is_ on the project, not just what was applied. | A forged record is caught by review and by the next live probe, not mechanically.   |
| The record plus a ledger table in each database           | The ledger is authoritative and survives a restore.                                                                                                                | A schema change on every project, school projects included, for little extra proof. |
| Supabase migration history                                | Native to the platform.                                                                                                                                            | Only makes sense with option C, which was rejected.                                 |

## Recommended approach

The delivery path has four parts. Each plugs into something that already
exists:

```
PR merges ─► CI proved the SQL on a throwaway database (no credentials)
         │
owner runs `npm run deliver -- <project>` ─► precondition: live = last record
         │       plan shown · owner types the project ref
         │       apply units in manifest order (+ demo lock on the demo)
         │       prove: audit · lock · fingerprint · unit checks · function · Auth
         ▼
record committed (supabase/delivery/records/<project>.json) through a normal PR
         │
release workflow (owner approves) ─► CI green · npm audit · gate per site
         │       tag vX.Y.Z · GitHub Release notes · move `production`
         ▼
each Vercel site builds `production` ─► the ignored build step re-runs the gate
         │
release workflow reads each site's /version.json ─► "live on demo / pilot"
```

1. **CI proves the SQL before any project sees it.** A new `schema` job starts
   a disposable Supabase Postgres in GitHub Actions (free for public repos)
   and, using only synthetic data:
   - applies `school_schema.sql` and runs `rls_audit.sql` (school shape);
   - applies `demo_lockdown.sql` and runs the audit again (demo shape);
   - builds the database `origin/main` describes, applies this PR's new
     manifest units, and checks that the fingerprint equals a fresh install of
     this PR's baseline ("upgrade ≡ fresh", which catches evidence 1, 2
     and 4);
   - applies every unit a second time and checks that nothing changes
     (re-run safety, evidence 3);
   - checks that the committed expected fingerprints are current;
   - runs the deliver command's provisioning path end to end against the same
     database.
2. **The owner runs the deliver command.** `scripts/delivery/deliver.mjs`
   (Node 24, no new dependencies) reads the manifest and the project list. It
   refuses to start if the project's live fingerprint differs from its last
   record, since that difference means an unrecorded change. It shows the
   ordered plan and requires the owner to type the project ref at a TTY. It
   then applies the pending units (on the demo, each is followed by
   `demo_lockdown.sql`), runs every proof and writes the record. A read-only
   `--probe` mode answers "is this project still what the record says?"
3. **The record reaches `main` through a normal PR.** The command prepares the
   branch and the commit, and the owner opens and merges the PR. Merging is
   what makes the delivery visible to the gate.
4. **The release is gated.** Both Vercel projects deploy from a `production`
   branch, which only the release workflow moves. Once the owner approves it
   through a GitHub Environment, the workflow requires green CI on the commit,
   the dependency bar, and a passing gate for every site. It then tags,
   publishes the GitHub Release and moves `production`. Each site's Vercel
   build runs the same gate as its Ignored Build Step, so a site whose
   project isn't proved stays on its previous deployment. The workflow then
   reads each site's `/version.json` to record what is live.

The **schema-version marker** ties the two sides together at runtime, and it
is also the change that demonstrates MVP step 6. After each proved unit,
deliver writes the manifest's sequence number to `app_config.schema_version`.
Each build embeds the sequence it requires. After sign-in, the app compares
the two and, when the database is behind, shows "database update pending"
(EN/ES) instead of failing with 42P10. The first release that ships the check
can't reach a site until the unit that sets the marker is proved on that
site's project.

## Key decisions

### Portals and roles

- No new role. No guard changes in `role.js` or any portal.
- The schema-version check runs in the three signed-in portals (student,
  teacher, admin) after the session resolves. It does not run on
  `login.html`, because `app_config` is readable only by `authenticated`.
- The **operator** of the path is the owner alone. Sessions prepare a
  delivery (SQL, manifest units, expected fingerprints, the record PR's
  description) and may dispatch a release, which waits for the owner's
  approval. A session cannot complete a delivery, for three reasons: the
  Supabase token is never where a session can reach it, the command needs a
  TTY confirmation, and the guard treats the command as a database-changing
  command.
- Per the owner's call, sessions **keep** the per-call Supabase MCP prompt in
  Default mode. A write approved that way is a **bypass**: the next
  `deliver` or `--probe` sees drift from the record and refuses until the
  owner records the bypass with a reason (`deliver --record-bypass`) or
  reconciles it. Bypasses are therefore counted, not hidden.

### Data shape (model level)

All new files live under `supabase/delivery/`, so every edit falls under the
existing guard (hard rule 5). None of them is a migration.

- **Projects:** one entry per Supabase project, with its name, ref, type
  (`demo` | `school`), the Vercel site and origin it backs, `holdsRealData`,
  its delivery window (required once `holdsRealData` is true), and its
  expected Edge Function and Auth state. Refs are already public in the
  runbook, `.mcp.json` and the built bundle.
- **Manifest:** an ordered list of **units**. Each unit has a sequence number,
  an id, the `supabase/schema/*.sql` files it applies (in order), the project
  types it applies to, any function deploys or Auth changes, and read-only
  **checks** that return pass or fail (for example the runbook's conducta
  check). Every unit blocks the app: a build requires the highest sequence
  number in the manifest at its commit.
- **Records:** append-only, one file per project. Each delivery entry carries
  the unit ids and the SHA-256 of each file, start and end times, the
  approver, the fingerprint before and after, and pass or fail for each
  proof. Bypass and exception entries carry a reason. The schema is fixed and
  unit-tested: ids, hashes, booleans, timestamps and owner-written reasons
  only, never values read from rows.
- **Expected fingerprints:** `expected/school.json` and `expected/demo.json`,
  generated by CI from the baseline (plus the lock for the demo). They are
  committed so the owner's machine needs neither Docker nor Postgres.
- **Fingerprint:** a read-only catalog probe of the `public` schema covering
  tables, columns, constraints and indexes (compared by definition, not by
  name, which is the root of evidence 2), policies, views, functions and
  triggers. Each object is hashed. Recorded **exceptions** (named, with a
  reason) are subtracted before comparing.
- **Schema-version marker:** one row in the existing `app_config` key/value
  table. No new table.

### Data seams and demo-mode behaviour

- The deliver command reaches a project through an **executor** interface:
  the Supabase Management API for real projects (pending spike S2) and
  `psql` against the CI container. The same command code runs in both, which
  is how CI proves provisioning at no cost.
- The app's only new read is `app_config` (`key = schema_version`), through a
  new logic-layer module (`src/js/schemaVersion.js`, typed with JSDoc). It is
  a read, so in demo mode it passes through `demoDb.js` to the demo project,
  and no write path is added. **No demo-mode write can reach Supabase**,
  because there is no new write.
- The demo lock is reapplied after every unit on the demo, then proved: three
  `demo_deny_*` policies on every public table. On every school project the
  proof is zero such policies. Both are asserted by the deliver command and by
  the CI `schema` job.
- `admin-users` is delivered by a unit that names it (`supabase functions
deploy … --no-verify-jwt`, with the token passed to that child process
  only). The proof reads its metadata (present, `verify_jwt` off, version and
  hash recorded) and probes it (preflight 200, unauthenticated POST refused).
  On the demo, the proof is that it is absent.
- Auth settings (Site URL, redirect allow-list, leaked-password protection,
  the token-hash reset template) are compared with the project's expected
  state and changed only by an approved unit. The record stores conformance
  flags, not the values.

### Supabase impact (owner approval)

Every ticket that edits `supabase/`, or whose proof runs against a project, is
`**Supabase:** yes` and runs attended.

- **No schema, RLS or Auth-policy change in the MVP**, no
  `supabase/migrations/` and no `config.toml` under `supabase/`. If the CI
  harness needs a `config.toml`, it lives outside `supabase/` (spike S1), so
  the GitHub integration never sees it.
- **Data write, on each project, by deliver after each proved unit:**

  ```sql
  insert into public.app_config (key, value) values ('schema_version', '<n>')
  on conflict (key) do update set value = excluded.value;
  ```

- **`rls_audit.sql`** may need to end in a result row rather than a `NOTICE`,
  if spike S2 picks the Management API. That is an edit under `supabase/`,
  with no database change.
- **Reconciliation from spike S3:** per-project `incremental_reconcile_*.sql`
  files and recorded exceptions, or a rebuild of the pilot from
  `school_schema.sql` (owner-approved; the pilot holds 0 school records). The
  demo is always reconciled and never rebuilt.
- **Auth settings on each project** are brought to the expected state through
  the path, one approved unit at a time.
- **`incremental_conducta.sql`** is re-delivered to both projects (MVP). It
  must leave both unchanged.
- **Guard (`.claude/hooks/guard.mjs`):** add `npm run deliver` and
  `node scripts/delivery/deliver.mjs` to the database-changing commands (ask
  in Default mode, deny in every other mode). The MCP rules stay as they are,
  per the owner's call.

### i18n areas

- One string pair, the "database update pending" banner, in the **`errors`**
  area (`src/js/i18n/{en,es}/errors.js`), with Spanish in _usted_.
- The deliver command, the release workflow and CI output are tooling the
  owner reads. They are English only and outside i18n.

### Security and privacy

- **Credentials.** One Supabase personal access token, on the owner's
  machine only. It is read from a hidden prompt or the OS keychain, never
  from an environment variable in a shell that runs an agent, never
  committed, never in CI. The release workflow uses only `GITHUB_TOKEN`. The
  Vercel gate needs no credential.
- **Public logs.** CI runs only on synthetic fixtures. The deliver command's
  output stays on the owner's terminal. The only thing that reaches the
  public repo from a live project is the record, whose fixed schema holds no
  row values. Unit checks return pass or fail, never rows. A Postgres error on
  a project with `holdsRealData` is stored as its SQLSTATE, never as its
  message, because messages can echo key values.
- **Minors' data (Ley 8968).** On a project with `holdsRealData`, deliver
  refuses to run outside the delivery window, with no override, and the
  pre-delivery safety net is settled by spike S5 before the first school's
  first delivery.
- **Previews.** `main` becomes a preview branch, so unreleased code builds on
  every merge. Vercel Authentication (free on every plan) must protect
  preview deployments on any Vercel project that points at a project with
  `holdsRealData`. Today's pilot previews are public and run in real mode
  against the pilot database, which holds test data only.
- **Release integrity.** Only the release workflow can push `production`
  (branch ruleset), and the workflow runs only after the owner approves the
  `release` GitHub Environment.
- **Supply chain**, per the owner's bar: the release fails on any high or
  critical advisory in a runtime dependency
  (`npm audit --omit=dev --audit-level=high`). Dev-only findings are reported
  but don't block. Dependabot alerts and security updates, CodeQL default
  setup and secret-scanning push protection are switched on (free on public
  repos).

### Versions and releases

- A **version** is a tag `vX.Y.Z` on a `main` commit that passed CI. Its
  changelog is the GitHub Release, with notes generated from the squash-merged
  PR titles. No commit to `main` is needed to cut a release.
- Every build emits `/version.json` with the commit SHA and the schema
  sequence it requires. "Which version is each site running?" becomes a
  public fetch, and the release workflow records the answer.
- Both sites build with the same settings: `engines.node` 24.x in
  `package.json` (honoured by Vercel and read by CI) and the Vite preset on
  both projects (post-MVP).

### Other (build vs buy)

- **No new npm dependency.** The command uses Node 24's `fetch`. `psql` is
  preinstalled on GitHub's Ubuntu runners. The Supabase CLI is already a
  devDependency.
- **Rejected:** Sqitch, Flyway and Atlas (a new tool, plus a history table in
  every project); release-please (it needs Conventional Commit prefixes, which
  the commit convention forbids); Vercel staged-production promote (it needs a
  token).

## ARCHITECTURE_MAP rows to add

| Path                            | Responsibility                                                                                                                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `supabase/delivery/`            | Manifest, projects, per-project records, expected fingerprints, the read-only fingerprint probe, the Auth email template. Guarded.                                                   |
| `scripts/delivery/`             | The deliver command, the gate (shared by the release workflow and Vercel's Ignored Build Step), fingerprint compare, executors, record writer. JSDoc-typed and added to `typecheck`. |
| `.github/workflows/release.yml` | Approved release: checks, tag, GitHub Release, move `production`, read each site's `version.json`.                                                                                   |
| `.github/workflows/ci.yml`      | Gains `format:check` and the `schema` job; `npm audit` reported on PRs.                                                                                                              |
| `.github/dependabot.yml`        | npm and GitHub Actions updates.                                                                                                                                                      |
| `src/js/schemaVersion.js`       | Shared by the student, teacher and admin portals: compares `app_config.schema_version` with the build's required sequence (a Vite `define`).                                         |
| Backend (`supabase/`) section   | "Apply by hand" becomes "deliver through `npm run deliver`"; the runbook's §2 and §3 point to the delivery doc.                                                                      |

## Validation strategy

- **Unit (Vitest, `test/`, red first):**
  - `test/deliveryManifest.test.js`: manifest and project validation.
  - `test/deliveryGate.test.js`: the gate decision (manifest, records, site →
    allow, or skip with reasons).
  - `test/deliveryRecord.test.js`: the record writer accepts only the fixed
    schema and rejects any row value.
  - `test/deliveryFingerprint.test.js`: compare by definition, not by name;
    exceptions are subtracted.
  - `test/deliveryWindow.test.js`: delivery-window refusal.
  - `test/deliver.test.js`: command flow against a fake executor (refuses
    without a TTY, on drift, or on a wrong typed ref; locks the demo after
    each unit; never locks a school project).
  - `test/schemaVersion.test.js`: behind, equal, missing row.
  - `test/claudeHooks.test.js`: extended so the deliver command asks or
    denies by permission mode.
- **CI integration:** the `schema` job described above, which counts as the
  rung-6-equivalent proof for SQL. `npm run format:check` joins the
  `quality` job.
- **E2E:** `e2e/schema-version.spec.js` covers the banner in EN and ES when
  the fixture's `app_config.schema_version` is behind, no banner when it
  matches, `expect(writes).toEqual([])` and no `pageerror`. `routeSupabase`
  fixtures (`studentFix`, `teacherFix`, `consoleFix`) gain a default
  `app_config` row at the current sequence, so no existing spec shows the
  banner. Only fixture data is added; `rowMatches` already handles `eq`.
- **verify:** the banner at 375 px in ES, on the teacher console.
- **Live MVP evidence**, owner-run, in the PRs:
  - the conducta re-delivery output for demo and pilot, with both records;
  - "what state is each project in?" timed from the record;
  - a release refused while the pilot lacks the schema-version unit, then
    accepted once it's proved;
  - the Vercel production deploy list matching the tags;
  - `version.json` from both sites.

## Missing pieces

1. **Known state first (spike S3).** No record means anything until both
   projects match an expected fingerprint or have named exceptions. This is
   the real work of the MVP's step 1.
2. **The CI harness (spike S1)** and the expected fingerprints it produces.
   The deliver command's postcondition depends on them.
3. **Owner-side setup:** a Supabase personal access token and where it's
   stored.
4. **GitHub settings:** the `release` Environment with the owner as reviewer,
   the `production` branch with a ruleset only the release workflow bypasses,
   CodeQL, secret scanning and Dependabot.
5. **Vercel settings on both projects:** production branch `production`, the
   Ignored Build Step, `VITE_EXPECTED_PROJECT_REF`, Node 24 and the Vite
   preset, and preview protection.
6. **Answers to the PRD's open questions:** each project's Supabase plan
   (backups, and whether leaked-password protection is available, which
   decides that expected value) and `main`'s ruleset (the release workflow
   checks CI itself either way).
7. **Process docs:** `conventions.md` (a SQL change ships as a manifest unit;
   the PR's "Manual Supabase steps" becomes "Delivery: unit <id>"), the
   runbook, `supabase/CLAUDE.md`, and a new `docs/DELIVERY.md` covering how to
   deliver, record a bypass, cut a release and read the state.

## Spikes

Each spike is timeboxed so the epic finishes before mid-November 2026.

- **S1 · CI database harness.**
  Question: can `school_schema.sql` and `rls_audit.sql` (both shapes) run on
  the `supabase/postgres` image, at the projects' Postgres major version, as a
  GitHub Actions service container? · Spike: one throwaway workflow, half a
  day · Decision rule: if they pass on the bare image, use a service
  container. If they need objects that GoTrue creates, use `supabase db start`
  with its `config.toml` outside `supabase/` (`--workdir`). If neither works
  in the timebox, run the audit only against live projects through deliver,
  and CI keeps the idempotency and "upgrade ≡ fresh" checks on plain Postgres
  with a stubbed `auth` schema.
  Result (2026-10-08, #87): **`supabase db start`**. On the bare
  `supabase/postgres:17.11.0.004` image the baseline applies, but the audit
  fails at its first student check: the image's `auth.uid()` and
  `auth.role()` read only the legacy `request.jwt.claim.*` settings, and
  GoTrue's migrations are what replace them. `npx supabase db start` (CLI
  2.104.0, which pulled `postgres:17.6.1.132` and `gotrue:v2.189.0`) runs those
  migrations, and both shapes pass: 30 tables, 90 demo locks.
  `major_version = 15` (`postgres:15.8.1.085`) passes too. The CI `schema`
  job starts it from `scripts/delivery/harness/supabase/config.toml`, outside
  `supabase/`. Each test copies a pristine template of the `postgres`
  database, so no run touches another's state.
- **S2 · Management API as the executor.**
  Question: does `POST /v1/projects/{ref}/database/query` run `rls_audit.sql`
  end to end (multi-statement, `begin`/`rollback`, `set local role`, the
  `auth.users` insert) and return a readable result? Do the functions and
  `config/auth` endpoints return what the comparison needs? · Spike:
  owner-attended, read-only and rolled-back calls against the pilot, two
  hours · Decision rule: if yes, the token is the only credential and
  `rls_audit.sql` ends in a result row. If not, real projects use the `psql`
  executor with each project's database URL (entered at the prompt), and the
  token is used only for functions and Auth.
- **S3 · Drift on the two projects (known state).**
  Question: how far are the demo and the pilot from the expected
  fingerprints? · Spike: the owner runs the read-only probe on both (an
  attended, approved session), and the differences are triaged in a doc, one
  evening · Decision rule: each difference is either fixed by a reconcile file
  or recorded as a named exception with a reason. If the pilot has more than
  10 unexplained differences, or any missing table or policy, rebuild it from
  the baseline. The demo is always reconciled.
- **S4 · Vercel gate on the current plan.**
  Question: with production branch `production`, does an Ignored Build Step
  that exits "skip" leave the live production deployment in place, and can
  it read the repo files and `VITE_SUPABASE_URL`? · Spike: a scratch branch
  set as a temporary production branch on the pilot project, one hour ·
  Decision rule: if yes, keep both gate layers. If not, the release workflow
  is the only gate, and the build-side layer is dropped and noted here.
- **S5 · First write into a project holding minors' data** (at onboarding,
  not in the MVP).
  Question: what has to happen before deliver writes to a project with
  `holdsRealData`? · Spike: rehearse the school's first delivery on a copy
  restored by the `BACKUP_RESTORE.md` drill, and time the pre-delivery dump ·
  Decision rule: if the dump and the rehearsal fit inside one evening window,
  both become mandatory deliver preconditions for `holdsRealData`. If not,
  the owner chooses between a Pro-plan backup taken just before the delivery
  and a narrower window.

## Open questions

- **Delivery window per school**, given Saturday classes (schedules support
  days 1–7). Settled with the first school, and needed before its project
  sets `holdsRealData`.
- **Each project's Supabase plan.** It decides whether leaked-password
  protection can be on (an expected value or a recorded exception) and
  whether backups exist (S5).
- **`main`'s ruleset.** If CI is not a required check today, it should
  become one. The release workflow checks CI on the commit regardless.
- **The Vercel plan for school sites.** Hobby is for non-commercial use. Not
  this epic's to fix, but it has to be answered before the first school's
  site goes live.
- **The pilot's record when a school signs.** Archived with the pilot project
  or removed, decided with that change.
- **Whether `test/rls.live.test.js`** (the PostgREST-level audit, which needs
  persona logins) joins the proof for school projects after G3 adds the
  guardian persona.
