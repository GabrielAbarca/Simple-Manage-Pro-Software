# Plan — Deliver pending units to a project only after the owner confirms it

**Implements:** #94 · **Epic:** #86 · **Branch:** feat/deliver-command
**Status:** Approved 2026-10-28
**Red commit:** 2b1924e
**Confidence:** 8/10 that one unattended pass reaches a green PR

> Validate every pattern and path below against the code before acting on it.
> Import from the files named here; don't recreate helpers that already exist.

## Ticket

**Concern:** `npm run deliver -- <project>` shows the ordered plan of the
project's pending units and continues only when the owner types the project's
ref at a TTY. It applies each unit's files in manifest order, re-applying
`demo_lockdown.sql` after every unit on the demo. Then it proves the result:
the audit passes; the demo lock covers every table on the demo and is absent
from a school project; the unit's own checks pass. Only then does it write
`app_config.schema_version`, append a passing record, and prepare the record
commit for the owner's PR. A project holding real data is refused outside its
delivery window, and nothing overrides that.

**User story:** As the owner, I want one command that applies a project's
pending database units only after I confirm the project by its ref, proves
them, and records the result, so that every Supabase change is approved,
proved and recorded.

**Type:** New capability · **Complexity:** High
**Portals:** none (delivery tooling) · **Supabase:** no (the command is never
run in a session; tests use a fake executor and a temp records dir; nothing
under `supabase/` is created or edited)

## Inherited decisions

- The owner runs the command; it shows the ordered plan, requires the project
  ref typed at a TTY, applies pending units (each followed by
  `demo_lockdown.sql` on the demo), proves and records.
  `architecture.md#recommended-approach`
- After each proved unit, deliver writes the unit's sequence to
  `app_config.schema_version` with exactly
  `insert into public.app_config (key, value) values ('schema_version', '<n>') on conflict (key) do update set value = excluded.value;`
  It is the only data write. `architecture.md#supabase-impact-owner-approval`
- The demo lock is three `demo_deny_*` policies on every public table; a
  school project carries zero. `architecture.md#data-seams-and-demo-mode-behaviour`
  (proved by `proveDemoLock`, `scripts/delivery/proofs.mjs:124-137`).
- Real projects run through the Management API executor, the token read at
  the hidden prompt only (spike S2, `architecture.md#spikes`;
  `scripts/delivery/executors/managementApi.mjs`, `scripts/delivery/credential.mjs`).
- On a `holdsRealData` project deliver refuses outside the delivery window,
  with no override. `architecture.md#security-and-privacy`
- Records are append-only, fixed-schema, written only by
  `scripts/delivery/record.mjs`; a failure keeps only its SQLSTATE.
  `architecture.md#data-shape-model-level`
- The record reaches `main` through a normal PR the owner opens; the command
  prepares the branch and the commit. `architecture.md#recommended-approach`
- No new npm dependency; `scripts/delivery/**/*.mjs` is JSDoc-typed and
  checked by `tsconfig.scripts.json`. `architecture.md#other-build-vs-buy`
- The guard already asks before `npm run deliver` and
  `node scripts/delivery/deliver.mjs` (#88, `.claude/hooks/guard.mjs:12-13`).

## Out of scope

- Not included: the drift precondition, `--probe`, `--record-bypass` and the
  fingerprint after a delivery (#98). The record's `fingerprint.after` is
  `null`; `fingerprint.before` is the read-only probe's digest taken before
  each unit, because the record schema requires it.
- Not included: Edge Function and Auth units (#101), `--provision` and the
  psql path in CI (#103), printing state (#96), docs (#105).
- Not included: running checks inside a read-only transaction (see Open
  questions 4).
- Not changing: `manifest.mjs`, `record.mjs`, `proofs.mjs`,
  `fingerprint.mjs`, both executors, `credential.mjs`, the guard, anything
  under `supabase/`.

## Context references — read before implementing

- `.claude/hooks/guard.mjs` (lines 182-192) — the exported-decision + thin CLI
  pattern the ticket names: `if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]))`.
- `scripts/delivery/audit.mjs` (whole file, 72 lines) — the closest sibling:
  options object with injectable `prompt`, `fetch`, `out`; the CLI block at
  lines 57-72; `createManagementApiExecutor` built after the token prompt.
- `scripts/delivery/manifest.mjs` — `loadManifest`, `loadProjects`,
  `unitsFor(manifest, type, afterSeq)` (lines 408-416), the `Project`,
  `Unit`, `DeliveryWindow` typedefs (lines 5-50); window days are 1–7 with
  1 = Monday, `from`/`to` are `HH:MM` with `from < to` (lines 214-260).
- `scripts/delivery/record.mjs` — `appendEntry(dir, project, entry)`,
  `readProjectState(dir, name)` → `provedSequence`, `validateEntry`,
  `RECORDS_DIR`; proof names and unit ids must match
  `/^[a-z0-9][a-z0-9._-]{0,63}$/` (line 79); `proofs` must be non-empty
  (line 282); file paths must start `supabase/` (line 82).
- `scripts/delivery/proofs.mjs` — `proveAudit(executor, auditFile)`,
  `proveNoAuditLeftovers(executor)`, `proveDemoLock(executor, shape)`,
  `AUDIT_SUMMARY`, `AUDIT_LEFTOVERS_SQL`.
- `scripts/delivery/fingerprint.mjs` — `probeFingerprint(executor)` →
  `{ digest }` (lines 128-138).
- `scripts/delivery/schemaHarness.mjs` — `SCHEMA_DIR` (line 37).
- `test/deliveryAudit.test.js`, `test/deliveryRecord.test.js` — temp-dir and
  injected-dependency test style for this directory.
- `.claude/ARCHITECTURE_MAP.md` (lines 275-297) — the `## Delivery` table,
  sorted by path.

### Patterns to follow

```js
// scripts/delivery/audit.mjs:19-33 — options object, injected boundaries
export async function runAudit({
  projectRef,
  holdsRealData,
  prompt = promptSecret,
  fetch = globalThis.fetch,
  out = (line) => process.stdout.write(`${line}\n`),
  auditFile = join(SCHEMA_DIR, "rls_audit.sql"),
}) {
  ...
  const token = await prompt("Supabase personal access token: ");
  const executor = createManagementApiExecutor({ projectRef, token, holdsRealData, fetch });
```

```js
// scripts/delivery/audit.mjs:57-72 — thin CLI
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  runAudit({ ... }).then(
    (ok) => { process.exitCode = ok ? 0 : 1; },
    (error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; },
  );
}
```

## Design

`scripts/delivery/deliver.mjs` exports:

- `deliver(options)` → `Promise<DeliveryResult>` where
  `DeliveryResult = { ok, reason, delivered: string[], failure: { unit, proof, sqlstate } | null, branch: string | null }`.
  Options (all but `project` defaulted for the CLI):
  `project` (name from `projects.json`), `input`/`output` (the TTY streams for
  the typed ref; default `process.stdin`/`process.stderr`), `connect(project)`
  (→ `Executor`; default prompts the token with `promptSecret` and builds the
  Management API executor), `approver` (default from `git config user.name` /
  `user.email`), `now` (→ `Date`), `manifest`, `projects`, `recordsDir`,
  `schemaDir`, `prepareCommit({ project, file, units })` (→ `{ branch }`;
  default runs git), `out(line)`.
- `main(argv, deps)` → `Promise<boolean>`: accepts exactly one argument, the
  project name; anything else (any flag) prints the usage and returns `false`
  without touching anything. Calls `deliver({ ...deps, project })`.

Flow of `deliver`, each refusal returning before the next step:

1. Find the project by name; unknown → refused.
2. `windowRefusal(project, now())` → refused when it returns a reason.
3. Check the approver with the record writer's own rules (`validateEntry` on a
   throwaway delivery entry) so a bad identity is refused before anything runs.
4. Read `readProjectState(recordsDir, name).provedSequence` and take
   `unitsFor(manifest, project.type, provedSequence)`. None → "nothing
   pending", `ok: true`, no connection.
5. Print the plan: one line per unit (seq, id, files in order, and
   `then demo_lockdown.sql` on the demo).
6. Confirm: `input.isTTY` must be true, else refused ("needs a terminal");
   read one line; it must equal `project.ref` after trimming, else refused
   ("does not match"). Nothing has connected yet.
7. `windowRefusal` again (the owner may have waited at the prompt).
8. `connect(project)`.
9. For each pending unit, in order:
   1. `probeFingerprint(executor)` → `before` digest (read-only).
   2. Run each of `unit.files` from `schemaDir`, in order; on the demo then
      `demo_lockdown.sql`. This is proof `apply`: it passes when every file
      ran, and the first failure fails it with that file's SQLSTATE.
   3. Proofs, in order, stopping at the first that fails: `demo-lock`
      (`proveDemoLock(executor, project.type)`), `audit`
      (`proveAudit(executor, join(schemaDir, "rls_audit.sql"))`),
      `audit-leftovers` (`proveNoAuditLeftovers`), then one
      `check.<check-id>` per unit check (`runStatement(check.sql)`, passes
      when `Number(rows[0][0]) === check.expect`).
   4. All passed → the marker statement with `unit.seq`, recorded as proof
      `marker` (a failed write fails it). So a passing entry's proofs are, in
      order, `apply`, `demo-lock`, `audit`, `audit-leftovers`,
      `check.<id>`…, `marker`.
   5. `appendEntry` one delivery entry for this unit: `units: [{ id, sequence,
files: [{ path: "supabase/schema/<file>", sha256 }] }]` (the lockdown
      file included on the demo), `startedAt`/`endedAt` (ISO), `approver`,
      `fingerprint: { before, after: null }`, `proofs` (each run, with its
      `ok`), and on failure `failure: { unit: id, sqlstate }`.
   6. On failure stop: no later unit runs.
10. If any entry was appended, `prepareCommit` with the record path: the
    default creates branch `chore/record-<project>` (refused with the manual
    git steps printed when it doesn't match the branch regex or exists),
    stages only `supabase/delivery/records/<project>.json`, commits
    `Record the delivery of <ids> to <project>`, and prints the push and PR
    next steps. It never pushes.

`scripts/delivery/window.mjs` exports `windowOpen(window, at)` → boolean (the
local weekday 1–7 and `HH:MM` in `window.timezone` via `Intl.DateTimeFormat`;
open when a slot lists the day and `from <= time < to`) and
`windowRefusal(project, at)` → `string | null` (`null` for a project without
`holdsRealData`; a reason when a real-data project has no window or is
outside it).

## Phase R — acceptance checks, red before any `src/` change

| AC  | Behaviour                                                                                                    | Kind | Where (file › test name)                                                                                   | Command                                                                                                                    | Expected red                                             |
| --- | ------------------------------------------------------------------------------------------------------------ | ---- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| AC1 | Without a TTY, or with a mismatched typed ref, nothing is applied or recorded                                | unit | `test/deliver.test.js` › "refuses without a TTY or a matching typed ref and applies nothing"               | `npx vitest run test/deliver.test.js -t "refuses without a TTY or a matching typed ref and applies nothing"`               | the refusal reason is `""` (stub), expected `/terminal/` |
| AC2 | Pending units' files run in manifest order; the demo is re-locked after each unit                            | unit | `test/deliver.test.js` › "applies pending units in order and re-locks the demo after each one"             | `npx vitest run test/deliver.test.js -t "applies pending units in order and re-locks the demo after each one"`             | `result.ok` false, expected true                         |
| AC3 | A school project never gets `demo_lockdown.sql`; its proof fails on any `demo_deny_*` policy                 | unit | `test/deliver.test.js` › "never locks a school project and fails if a demo lock is found there"            | `npx vitest run test/deliver.test.js -t "never locks a school project and fails if a demo lock is found there"`            | `result.ok` false, expected true                         |
| AC4 | Marker and passing record only after every proof; the first failing proof stops, no marker, failure recorded | unit | `test/deliver.test.js` › "writes the marker only after every proof passes and records a failure otherwise" | `npx vitest run test/deliver.test.js -t "writes the marker only after every proof passes and records a failure otherwise"` | `ok` false, expected true                                |
| AC5 | A `holdsRealData` project is refused outside its window, with no override                                    | unit | `test/deliveryWindow.test.js` › "refuses a real-data project outside its delivery window with no override" | `npx vitest run test/deliveryWindow.test.js -t "refuses a real-data project outside its delivery window with no override"` | `windowOpen` false inside the window, expected true      |

Each test carries a positive control (the same setup with the right typed ref,
or inside the window, does connect and apply), so a refusal can't pass by
doing nothing.

**STUB tasks:**

- STUB `scripts/delivery/deliver.mjs`: export `deliver()` resolving
  `{ ok: false, reason: "", delivered: [], failure: null, branch: null }` and
  `main()` resolving `false`.
- STUB `scripts/delivery/window.mjs`: export `windowOpen()` returning `false`
  and `windowRefusal()` returning `""`.

The stubs take no parameters because the scripts' lint config has no unused
argument pattern; the empty-string reason keeps every first failure an
assertion, not a matcher type error.

Shared test fakes: `test/fixtures/delivery/fakes.js` (a fake executor that
records every file and statement and answers the probe, the audit, the
leftover count, the lock counts and the checks; TTY and piped inputs; a sink
output; a temp schema dir with the unit files, `demo_lockdown.sql` and
`rls_audit.sql`).

**Red evidence** (filled when Phase R runs):

- AC1: `npx vitest run test/deliver.test.js -t "refuses without a TTY or a matching typed ref and applies nothing"` → `AssertionError: expected '' to match /terminal/` at `test/deliver.test.js:109:33` ✅ valid red
- AC2: `npx vitest run test/deliver.test.js -t "applies pending units in order and re-locks the demo after each one"` → `AssertionError: expected false to be true` (`run.result.ok`) at `test/deliver.test.js:166:27` ✅ valid red
- AC3: `npx vitest run test/deliver.test.js -t "never locks a school project and fails if a demo lock is found there"` → `AssertionError: expected false to be true` (`clean.result.ok`) at `test/deliver.test.js:223:29` ✅ valid red
- AC4: `npx vitest run test/deliver.test.js -t "writes the marker only after every proof passes and records a failure otherwise"` → `AssertionError: expected false to be true` (`good.result.ok`) at `test/deliver.test.js:255:28` ✅ valid red
- AC5: `npx vitest run test/deliveryWindow.test.js -t "refuses a real-data project outside its delivery window with no override"` → `AssertionError: expected false to be true` (`windowOpen` inside the window) at `test/deliveryWindow.test.js:67:48` ✅ valid red

`npm test`: the 5 above fail, plus `test/i18n.test.js` › "formats 24h time
strings to the locale's 12h form", the known Node-22 ICU case (this container
runs Node 22.22; `engines.node` is 24.x; it fails the same on `main`). Every
other test passes; lint and typecheck are clean.

## Implementation tasks

### 1. CREATE `scripts/delivery/window.mjs`

- **Implement:** `windowOpen` and `windowRefusal` as in Design. Weekday from
  `Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts`,
  mapped Mon→1 … Sun→7. JSDoc with `import("./manifest.mjs").Project` and
  `DeliveryWindow`.
- **Pattern:** `scripts/delivery/manifest.mjs:214-260` (the window shape).
- **Gotcha:** `to` is exclusive; compare `HH:MM` strings (zero-padded, so
  string order is time order). A day that crosses UTC midnight must use the
  local date, never `getUTCDay`.
- **Validate:** `npx vitest run test/deliveryWindow.test.js`
- **Satisfies:** AC5

### 2. CREATE `scripts/delivery/deliver.mjs`

- **Implement:** `deliver` and `main` as in Design, plus the CLI block and the
  default `connect`, `approver` and `prepareCommit` (git through
  `execFileSync("git", [...])`, no shell). Typedefs for `DeliveryResult` and
  the options. The confirmation reads one line from `input` with its own
  small reader (`data` until a newline, or `end`), which resolves `""` on an
  input that ends without a line; `readline/promises` `question` can stay
  pending when the input closes first.
- **Pattern:** `scripts/delivery/audit.mjs:19-72`; `.claude/hooks/guard.mjs:182-192`.
- **Gotcha:** `connect` is called only after the confirmation, so the token
  prompt never appears for a refused run. The approver is validated before
  the plan is shown. A proof failure stops the unit and the run. `sha256` from
  `node:crypto` over the file bytes. Proof names must fit the record's id
  pattern, so checks are `check.<id>`. The default `prepareCommit` must stage
  only the record file.
- **Validate:** `npx vitest run test/deliver.test.js test/deliveryWindow.test.js && npx eslint scripts/delivery/deliver.mjs scripts/delivery/window.mjs && npm run typecheck`
- **Satisfies:** AC1, AC2, AC3, AC4, AC5

### 3. UPDATE `package.json`

- **Implement:** `"deliver": "node scripts/delivery/deliver.mjs"` in
  `scripts`.
- **Validate:** `node -e "const s=require('./package.json').scripts; if(s.deliver!=='node scripts/delivery/deliver.mjs') process.exit(1)"`
- **Satisfies:** the ticket's Context (`npm run deliver -- <project>`)

### 4. UPDATE `.claude/ARCHITECTURE_MAP.md`

- **Implement:** rows for `scripts/delivery/deliver.mjs` (after
  `credential.mjs`) and `scripts/delivery/window.mjs` (after
  `schemaHarness.mjs`), in path order.
- **Validate:** `grep -n "scripts/delivery/deliver.mjs\|scripts/delivery/window.mjs" .claude/ARCHITECTURE_MAP.md`

### 5. Turn Phase R green

- **Validate:** every Phase R command passes; `npm test`.

## Validation commands

```bash
npm run format:check && npm run lint && npm run typecheck
npm test
npm run build
npm run test:e2e
```

Plus each Phase R command above. The command itself is never run in a
session (the guard asks for it, and it would reach a live project).

## Open questions / assumptions

1. Proofs and the marker are per unit, not once after all units — **Default:**
   per unit. Each unit is applied, locked (demo), proved, marked and recorded
   as its own delivery entry before the next starts, matching "after each
   proved unit" in the architecture. With today's one-unit manifest the two
   readings are the same.
2. Audit leftovers — **Default:** the audit proof is followed by
   `proveNoAuditLeftovers` as its own proof (`audit-leftovers`), since the
   audit inserts fixture rows on a live project.
3. Record branch — **Default:** `chore/record-<project>`. When that doesn't
   fit the branch rule (a project name of three or more words) or already
   exists, the command prints the git steps instead of committing; the
   delivery itself still counts.
4. Read-only checks — **Default:** a check runs as its own statement. The
   manifest already limits it to one `select` without `into`; wrapping it in
   `begin read only … rollback` would hide its row from the Management API,
   which returns only the last statement's rows. Listed under "Not in this
   change".
5. A failed delivery's record — **Default:** the failure entry is committed on
   the record branch too, so the PR shows it.

## Notes

- `fingerprint.before` is required by `record.mjs`; the probe is read-only and
  cheap, so it runs before each unit. `after` stays `null` until #98.
- Rejected: one delivery entry for all units. `projectState` counts a unit as
  proved only when its entry has no failure, so a later unit's failure would
  hide an earlier proved one that the marker already reports.
- Risk: the typed ref and the token read by `promptSecret` share stdin. The
  line reader removes its listeners and pauses the input before
  `promptSecret` sets raw mode.

## AMENDMENTS

- 2026-10-28 — `deliver.mjs` also exports `markerStatement(seq)` and `recordBranch(name)`, and a new non-acceptance test file `test/deliverRefusals.test.js` covers them plus the unknown-project, bad-approver and nothing-pending refusals — so the paths the acceptance tests don't reach have a test; no frozen test changed.
- 2026-10-28 — review rounds 1–2: `deliver.mjs` also exports `prepareRecordCommit(change, run)` (the default `prepareCommit`, git runner injectable, branching from `origin/main`) and `checkoutProblem(project, run)`, and `deliver` takes `verifyCheckout(project)`. The checkout check runs by default whenever the manifest, project list, records or schema files come from the repository, and is skipped when a caller passes all four, as the frozen tests do — so a delivery never runs from a checkout that differs from the `origin/main` its record commit is cut from; no frozen test changed.

## Manual Supabase steps

- None.

## Validation

Implementation commit on `feat/deliver-command`, Node 22.22 container
(`engines.node` is 24.x; no Node 24 is installed here).

| Check        | Result                       | Notes                                                                                                                                                                                                     |
| ------------ | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| format:check | ✅                           |                                                                                                                                                                                                           |
| lint         | ✅                           |                                                                                                                                                                                                           |
| typecheck    | ✅                           | both configs, `scripts/delivery/**` included                                                                                                                                                              |
| unit         | ✅ 597 passed, 1 env failure | `test/i18n.test.js` › "formats 24h time strings to the locale's 12h form" fails on Node 22's ICU, as recorded in #88's plan; this branch changes nothing under `src/`                                     |
| build        | ✅                           |                                                                                                                                                                                                           |
| e2e          | ✅ 119 passed                | local config: yes (`executablePath` → `/opt/pw-browsers/chromium-1243`); the default `chromium_headless_shell-1228` isn't installed, so the default run failed at browser launch before any test body ran |
| AC1–AC5      | ✅                           | each command run on its own; `-t` matched exactly one test each                                                                                                                                           |
| skip/only    | ✅ clean                     |                                                                                                                                                                                                           |
| entry order  | ✅                           | the 20-line check flags `src/js/admin.js`, whose header comment runs past line 20; its first import is `./errorHandler.js` (line 22), unchanged from `main`                                               |
| supabase/    | ✅ untouched                 |                                                                                                                                                                                                           |
| frozen tests | ✅ unchanged since `2b1924e` | `git diff 2b1924e -- test/deliver.test.js test/deliveryWindow.test.js test/fixtures/delivery/fakes.js` is empty                                                                                           |

| AC  | Kind | Red before (Phase R)                                                         | Green after |
| --- | ---- | ---------------------------------------------------------------------------- | ----------- |
| AC1 | unit | `expected '' to match /terminal/` (`test/deliver.test.js:109`)               | ✅          |
| AC2 | unit | `expected false to be true` (`result.ok`, `test/deliver.test.js:166`)        | ✅          |
| AC3 | unit | `expected false to be true` (`result.ok`, `test/deliver.test.js:223`)        | ✅          |
| AC4 | unit | `expected false to be true` (`result.ok`, `test/deliver.test.js:255`)        | ✅          |
| AC5 | unit | `expected false to be true` (`windowOpen`, `test/deliveryWindow.test.js:67`) | ✅          |

Beyond the acceptance checks, `test/deliverRefusals.test.js` covers an
unknown project, an approver the record would refuse (both refused before
connecting), a re-run with nothing pending (no connection), the record
branch name and the marker statement. The default git step was smoke-tested
in a scratch repository: the commit holds only the record file, and a file
already staged elsewhere stays out of it.

### Review (round 1)

**Verdict:** fix before PR · **Acceptance:** PASS

| AC  | Kind | Exists | Faithful | Passes | Coupled            | Frozen    | Probe      | Verdict |
| --- | ---- | ------ | -------- | ------ | ------------------ | --------- | ---------- | ------- |
| AC1 | unit | yes    | yes      | yes    | yes — fails at RED | unchanged | n/a (unit) | PASS    |
| AC2 | unit | yes    | yes      | yes    | yes — fails at RED | unchanged | n/a (unit) | PASS    |
| AC3 | unit | yes    | yes      | yes    | yes — fails at RED | unchanged | n/a (unit) | PASS    |
| AC4 | unit | yes    | yes      | yes    | yes — fails at RED | unchanged | n/a (unit) | PASS    |
| AC5 | unit | yes    | yes      | yes    | yes — fails at RED | unchanged | n/a (unit) | PASS    |

Findings: 0 Critical · 0 High · 2 Medium · 2 Low

- Medium · `scripts/delivery/deliver.mjs:512` — the window isn't re-checked between units.
- Medium · `scripts/delivery/deliver.mjs:262` — the record branch is cut from HEAD, not `origin/main`.
- Low · `scripts/delivery/deliver.mjs:555` — the stopped message claims no marker even when the marker ran.
- Low · `scripts/delivery/deliver.mjs:357` — checks aren't run read-only (Open question 4's approved default; follow-up).

- Fixed: the window isn't re-checked between units → `windowRefusal` runs before every unit; a closed window stops the run, keeping the earlier units' record and commit · `test/deliverRefusals.test.js` › "stops before the next unit once the delivery window has closed".
- Fixed: the record branch is cut from HEAD → `prepareRecordCommit` (now exported, its git runner injectable) fetches `origin main` (a failed fetch is tolerated) and runs `git switch -c chore/record-<project> origin/main` · `test/deliverRefusals.test.js` › "cuts the record branch from origin/main and commits only the record".
- Fixed: the stopped message claims no marker when the marker ran → `deliverUnit` reports whether the marker step passed and a refused record entry, and the message says so · `test/deliverRefusals.test.js` › "says the marker was written when the record entry then fails". A Low, fixed because it is a wrong output in this change's own code.
- Not in this change: checks aren't run read-only. The approved default (Open question 4): the Management API returns only the last statement's rows, so a `begin read only … rollback` wrapper hides the check's row. A read-only path belongs in the executors (a `runReadOnly` method), with `manifest.mjs:80-81`'s comment made true there.

### Review (round 2)

**Verdict:** fix before PR · **Acceptance:** PASS

| AC  | Kind | Exists | Faithful | Passes | Coupled         | Frozen    | Probe      | Verdict |
| --- | ---- | ------ | -------- | ------ | --------------- | --------- | ---------- | ------- |
| AC1 | unit | ✅     | ✅       | ✅     | ✅ fails at RED | unchanged | n/a (unit) | PASS    |
| AC2 | unit | ✅     | ✅       | ✅     | ✅ fails at RED | unchanged | n/a (unit) | PASS    |
| AC3 | unit | ✅     | ✅       | ✅     | ✅ fails at RED | unchanged | n/a (unit) | PASS    |
| AC4 | unit | ✅     | ✅       | ✅     | ✅ fails at RED | unchanged | n/a (unit) | PASS    |
| AC5 | unit | ✅     | ✅       | ✅     | ✅ fails at RED | unchanged | n/a (unit) | PASS    |

Findings: 0 Critical · 0 High · 2 Medium · 4 Low

- Medium · `scripts/delivery/deliver.mjs:399` — a step that throws after `apply` leaves the unit applied with no record entry.
- Medium · `scripts/delivery/deliver.mjs:484` — the working tree's manifest, schema and record aren't checked against `origin/main`, where the record commit is cut.
- Low · `scripts/delivery/deliver.mjs:265` — record-branch problems surface only after the database changed.
- Low · `scripts/delivery/deliver.mjs:578` — the success line doesn't say the checkout moved.
- Low · `scripts/delivery/deliver.mjs:343` — a failed lock or leftover query records no SQLSTATE.
- Low · `scripts/delivery/deliver.mjs:517` — a repeated window check.

- Fixed: a thrown step leaves no record → a step that throws becomes a failed proof with its message on the terminal and is recorded like any other failure · `test/deliverRefusals.test.js` › "records a step that throws as a failed proof".
- Fixed: the checkout isn't checked against `origin/main` → `checkoutProblem` (fetch, then HEAD equals `origin/main` and `git status --porcelain -- supabase/` is empty) runs before the plan and the ref prompt · "refuses before the ref prompt when the checkout is not origin/main", "checks the checkout and the record branch before anything runs".
- Fixed: record-branch problems surface after the database changed → the same pre-connect check refuses a name the branch rule rejects and an existing local branch · "checks the checkout and the record branch before anything runs".
- Fixed: the success line says the checkout moved → "(now checked out)" · "tells the owner the checkout moved to the record branch".
- Not in this change: a failed lock-count or leftover query records `sqlstate: null` — `proofs.mjs` returns no SQLSTATE for those queries and the ticket composes it without editing it; a follow-up can add `sqlstate` to `LockProof` and `LeftoverProof`.
- Won't fix: the early window check after the prompt — it refuses before the token prompt, which the per-unit check can't.

## Execution report
