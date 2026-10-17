# Plan — Run delivery SQL on a real project through the Management API

**Implements:** #91 · **Epic:** #86 · **Branch:** feat/management-api-executor
**Status:** Approved 2026-10-16
**Red commit:** 37490bc
**Confidence:** 8/10 that one unattended pass reaches a green PR

> Validate every pattern and path below against the code before acting on it.
> Import from the files named here; don't recreate helpers that already exist.

## Ticket

**Concern:** Spike S2, run with the owner, then the executor it picks. Using
only read-only and rolled-back calls against the pilot, find out whether the
Management API's `POST /v1/projects/{ref}/database/query` runs
`rls_audit.sql` end to end and returns a readable result, and whether the
functions and `config/auth` endpoints return what #101 needs. Record the
decision, then ship the real-project executor behind the psql executor's
interface. The owner's credential comes from a hidden prompt or the OS
keychain, nowhere else.

**User story:** As the owner, I want delivery SQL to reach a real project
through one personal access token typed at a hidden prompt, so that no
database password or token ever sits in an environment variable, a log or the
repo.

**Type:** New capability · **Complexity:** Medium
**Portals:** none (delivery tooling) · **Supabase:** yes (one owner-approved
edit to `supabase/schema/rls_audit.sql`; AC4 is owner-run against the pilot)

## Spike S2 — result (run 2026-10-16, owner-attended)

The pilot was paused (`INACTIVE`). With the owner's approval it was restored
through the session's Supabase connector (`restore_project`), and became
`ACTIVE_HEALTHY` with its 30 public tables back. The connector's
`execute_sql` sends its query to the same
`POST /v1/projects/{ref}/database/query` endpoint the executor will call.
Every call was approved by the owner at the guard prompt.

| #   | Call (pilot `wklxkntdnzshyrijvnjj`)                                                        | Answer                                                                                                                                 |
| --- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Read-only count of the audit's fixture rows, plus `current_user`                           | `run_as: postgres`, every count `0`. Counts come back as JSON numbers.                                                                 |
| 2   | `rls_audit.sql` unchanged, as one query                                                    | `[]`. No error, no `NOTICE`s returned: the whole file ran (begin, `auth.users` insert, `set local role`, every check, rollback).       |
| 3   | The same file plus `select 'RLS AUDIT: ALL CHECKS PASSED' as rls_audit;` after `rollback;` | `[{"rls_audit":"RLS AUDIT: ALL CHECKS PASSED"}]`: only the last statement's rows come back.                                            |
| 4   | Call 1 again                                                                               | every count `0`: nothing left behind by two full runs.                                                                                 |
| 5   | `begin; do $$ … raise exception 'FAIL [spike probe]: …' $$; rollback; select …;`           | error `Failed to run sql query: ERROR:  P0001: FAIL [spike probe]: expected 1 row(s), got 0\nCONTEXT: …`; nothing after the error ran. |
| 6   | `GET /v1/projects/{ref}/functions` (connector `list_edge_functions`)                       | `admin-users`: `status ACTIVE`, `version 2`, `verify_jwt false`, `ezbr_sha256` present. Enough for #101's metadata proof.              |
| 7   | `GET /v1/projects/{ref}/config/auth`                                                       | Not exposed by the connector. The owner runs one read-only command (Open question 1).                                                  |

An earlier probe, made while the restore was still loading the data, failed
with `ERROR:  42P01: relation "public.profiles" does not exist`. That showed
the SQLSTATE format early, and that nothing should run before
`ACTIVE_HEALTHY`.

**Decision (rule from `architecture.md#spikes`): yes.** The token is the only
credential. `rls_audit.sql` ends in a result row, because the endpoint returns
neither `NOTICE`s nor any statement's rows but the last, so without the row a
pass is only the absence of an error. Token storage, per the owner (asked
2026-10-16): **hidden prompt only**, nothing stored, on every OS.

## Inherited decisions

- The deliver command reaches a project through an executor interface: the
  Management API for real projects, `psql` against the CI container, with the
  same command code in both. `architecture.md#data-seams-and-demo-mode-behaviour`
- One Supabase personal access token, on the owner's machine only, read from a
  hidden prompt or the OS keychain, never from an environment variable, never
  committed, never in CI. `architecture.md#security-and-privacy`
- A Postgres error on a `holdsRealData` project is kept as its SQLSTATE, never
  its message. `architecture.md#security-and-privacy`
- If S2 says yes, `rls_audit.sql` ends in a result row: an edit under
  `supabase/`, with no database change. `architecture.md#supabase-impact-owner-approval`
- No new npm dependency: Node's `fetch`. `scripts/delivery/**/*.mjs` are
  JSDoc-typed and checked by `tsconfig.scripts.json`. `architecture.md#other-build-vs-buy`
- `proofs.mjs` owns how the audit's success is read; later tickets import it
  and never copy it. (#87)

## Out of scope

- Comparing Edge Function and Auth settings (#101). Probing drift (#98, #102).
  The projects list and its `holdsRealData` field (the deliver tickets).
- Any write to the pilot; no delivery, no marker write.
- Not changing: `scripts/delivery/executors/psql.mjs`, `record.mjs`,
  `schemaHarness.mjs`, `.claude/hooks/guard.mjs`, the runbook (process docs are
  missing piece 7).

## Context references — read before implementing

- `scripts/delivery/executors/psql.mjs` (lines 3–16, 48–72, 79–140) — the
  `ExecResult` / `Executor` typedefs to implement, `parseMessages` to reuse for
  the error text, and the factory shape (`createPsqlExecutor` returning
  `{ runFile, runStatement }` over one private `run`).
- `scripts/delivery/proofs.mjs` (lines 21–56) — `AUDIT_SUMMARY`, `FAIL_LABEL`
  and `proveAudit`, which reads success from notices today.
- `scripts/delivery/schemaHarness.mjs` (line 33) — `SCHEMA_DIR`, for the CLI's
  path to `rls_audit.sql`.
- `scripts/delivery/record.mjs` (lines 4–8, 350–352) — the `Project` typedef
  (`holdsRealData: boolean`) and the style of a boolean guard.
- `test/deliveryProofs.test.js` (lines 12–23) — the fake-executor helper to
  extend for the result-row and leftover tests.
- `test/deliveryRecordFile.test.js` (lines 1–17) — temp-dir test style.
- `supabase/schema/rls_audit.sql` (lines 31–35 header, 637–649 summary and
  rollback) — where the result row and its header line go.
- `docs/epics/delivery-pipeline/architecture.md` (lines 381–390) — S2, where
  the result is recorded.
- `.claude/ARCHITECTURE_MAP.md` (lines 275–287) — the `## Delivery` table,
  sorted by path.
- `eslint.config.js` (lines 34–44) — `scripts/**` get Node globals; no
  `_`-prefix exemption there, so unused parameters fail lint.

### Patterns to follow

```js
// scripts/delivery/executors/psql.mjs:79-84 — one private run, two methods
export function createPsqlExecutor({ databaseUrl, psql = "psql" }) {
  const run = (args) => new Promise((resolve) => { … });
  return {
    runFile: (file) => run(["-f", file]),
    runStatement: (sql) => run(["-c", sql]),
  };
}
```

```js
// scripts/delivery/executors/psql.mjs:117-126 — the result shape on failure
const { notices, error } = parseMessages(stderr);
resolve({ ok: code === 0 && !error, sqlstate: error?.sqlstate ?? null,
          error: error?.message ?? …, notices, rows: … });
```

```js
// test/deliveryProofs.test.js:12-23 — fake executor for proof tests
const executor = (result) => {
  const full = {
    ok: true,
    sqlstate: null,
    error: null,
    notices: [],
    rows: [],
    ...result,
  };
  return { runFile: async () => full, runStatement: async () => full };
};
```

## Design

### `scripts/delivery/executors/managementApi.mjs`

`createManagementApiExecutor({ projectRef, token, holdsRealData, fetch = globalThis.fetch })`
returns an `Executor` (the psql typedefs, imported).

- Guards, before any call: `projectRef` matches `^[a-z]{20}$`, `token` is a
  non-empty string, `holdsRealData` is a boolean. Otherwise throw a
  `TypeError` whose message never includes the token.
- `runFile(file)` reads the file (`node:fs/promises` `readFile`, utf8) and
  sends its whole text as **one** request. `runStatement(sql)` sends `sql`.
- The request: `POST https://api.supabase.com/v1/projects/<ref>/database/query`,
  headers `Authorization: Bearer <token>` and
  `Content-Type: application/json`, body `JSON.stringify({ query })`. The token
  lives only in the factory's closure and in that header: never in the URL,
  the body, the result, `process.env`, or anything printed.
- 2xx: the body is a JSON array of row objects →
  `{ ok: true, sqlstate: null, error: null, notices: [], rows }`, where each
  row is `Object.values(row)` mapped to text the way `psql -A -t` prints it:
  `null` → `""`, `true`/`false` → `"t"`/`"f"`, an object → `JSON.stringify`,
  anything else → `String(value)`. A non-array body → `rows: []`.
- Non-2xx: read the text, take `.message` when it parses as JSON, strip a
  leading `Failed to run sql query: `, then reuse `parseMessages` from
  `psql.mjs`. Its first `ERROR` gives `sqlstate` and the message, and drops
  `DETAIL`/`CONTEXT`/`LINE` lines exactly as for psql. With no Postgres error
  in it (401, 404, 5xx): `sqlstate: null`, error `HTTP <status>: <message>`.
- `fetch` throwing → `ok: false, sqlstate: null`, error = the thrown message.
- **`holdsRealData: true`:** every failure keeps its `sqlstate` and replaces
  the error with the fixed text `message withheld (the project holds real data)`,
  plus ` · HTTP <status>` when there was a response. No server text survives.
- `notices` is always `[]`: the endpoint doesn't return them.

### `scripts/delivery/credential.mjs`

`promptSecret(question, { input = process.stdin, output = process.stderr } = {})`:

- Rejects with `Error("a hidden prompt needs a terminal")` when
  `input.isTTY` isn't true. Never falls back to anything else.
- Writes `question` to `output`. Calls `input.setRawMode(true)`, then reads
  `data` chunks character by character: Enter (`\r`/`\n`) ends it; Ctrl-C
  (`\u0003`) rejects `Error("cancelled")`; Backspace (`\u007f`/`\b`) drops one
  character; anything else is appended. Nothing typed is echoed.
- On the end either way: remove the listener, `setRawMode(false)`,
  `input.pause()`, write `"\n"` to `output`. An empty answer rejects with
  `Error("no token entered")`. Resolves the trimmed answer.
- Reads nothing from `process.env`.

### `scripts/delivery/proofs.mjs`

- `proveAudit` passes when the run is ok **and** the summary arrives either as
  a notice (psql) or as a result row whose first cell equals `AUDIT_SUMMARY`
  (the Management API). Failure handling is unchanged.
- New `AUDIT_LEFTOVERS_SQL`: one statement, one row, one integer. It sums the
  counts of the audit's fixture markers: `auth.users` by the five persona ids
  or `@rls-audit.invalid`, `profiles` by the five ids, `school_years` named
  `RLS Audit Year`, `grade_levels` named `RLS Audit Grade`, `subjects` coded
  `RLSA`/`RLSA2`, `teachers` with `@rls-audit.invalid`, `students` whose
  enrollment number starts `RLS-`, `rooms` named `RLS Audit Room%`,
  `grade_component_templates` named `RLS Audit Scheme`/`Audit Scheme 2`. These
  are the spike's call 1, summed.
- New `proveNoAuditLeftovers(executor)` → `{ ok, count, error }`, ok only when
  the statement ran and the count is 0.

### `supabase/schema/rls_audit.sql` (owner approval)

- After the final `rollback;`, add a blank line and
  `select 'RLS AUDIT: ALL CHECKS PASSED' as rls_audit;`. It runs only if every
  statement before it did: psql's `ON_ERROR_STOP` and the endpoint both stop
  at the first error (spike call 5).
- Header "READING THE OUTPUT": the success sentence also says the same line
  is the final result row, which is what the Dashboard SQL Editor and the
  Management API show.

### `scripts/delivery/audit.mjs` (the AC4 entry point)

`node scripts/delivery/audit.mjs <project-ref> [--test-data]`

- `runAudit({ projectRef, holdsRealData, prompt, fetch, out })`, exported for
  the test. It refuses a ref that doesn't match `^[a-z]{20}$`, reads the token
  through `prompt` (`promptSecret` by default), builds the Management API
  executor, runs `proveAudit` on `SCHEMA_DIR/rls_audit.sql`, then
  `proveNoAuditLeftovers`. It writes two lines to `out` (stdout by default):
  - `RLS audit on <ref>: PASS` or `RLS audit on <ref>: FAIL [<check>] (SQLSTATE <s>) <error>`
  - `Audit fixture rows left behind: <n>` (or the error)

  It returns `true` only when both pass. The CLI wrapper sets
  `process.exitCode` to 0 or 1.

- `holdsRealData` is `true` unless `--test-data` is given (Open question 2).
- The token is never written, and nothing is read from the environment.

## Phase R — acceptance checks, red before any `scripts/` change

| AC  | Behaviour                                                                                            | Kind   | Where (file › test name)                                                                                     | Command                                                                            | Expected red                                               |
| --- | ---------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| AC1 | Each SQL file runs as one unit through the chosen executor; the credential reaches only that request | unit   | `test/deliveryExecutor.test.js` › "runs each SQL file as one unit with the credential confined to that call" | `npx vitest run test/deliveryExecutor.test.js -t "runs each SQL file as one unit"` | `expected "vi.fn()" to be called 1 times, but got 0 times` |
| AC2 | A failure on a `holdsRealData` project returns its SQLSTATE and no message                           | unit   | `test/deliveryExecutor.test.js` › "returns only the SQLSTATE for a failure on a real-data project"           | `npx vitest run test/deliveryExecutor.test.js -t "returns only the SQLSTATE"`      | `expected null to be '23505'`                              |
| AC3 | The credential is never read from an environment variable and never written to output                | unit   | `test/deliveryExecutor.test.js` › "never reads the credential from the environment or prints it"             | `npx vitest run test/deliveryExecutor.test.js -t "never reads the credential"`     | `expected '' to be 'fake-access-token-for-unit-tests'`     |
| AC4 | The owner runs the audit on the pilot through the executor; it passes and leaves nothing behind      | verify | Owner's terminal · pilot                                                                                     | `node scripts/delivery/audit.mjs wklxkntdnzshyrijvnjj --test-data`                 | n/a (owner-run after implementation)                       |

**STUB tasks** (done in Phase R):

- STUB `scripts/delivery/executors/managementApi.mjs`: export
  `createManagementApiExecutor(options)` returning an executor whose methods
  resolve a neutral failed `ExecResult` and never call `fetch`.
- STUB `scripts/delivery/credential.mjs`: export `promptSecret(question, streams)`
  resolving `""`.

**Verify scenarios:**

- AC4: owner's terminal on a checkout of this branch (Node 24) · pilot
  `wklxkntdnzshyrijvnjj`, `ACTIVE_HEALTHY` (restore it first if it has paused
  again) · run `node scripts/delivery/audit.mjs wklxkntdnzshyrijvnjj --test-data`,
  paste the token at the hidden prompt · must see
  `RLS audit on wklxkntdnzshyrijvnjj: PASS`, then
  `Audit fixture rows left behind: 0`, and the exit code `0`
  (`echo $?`). Nothing typed appears on screen.

**Red evidence:**

- AC1: `npx vitest run test/deliveryExecutor.test.js -t "runs each SQL file as one unit"` →
  `AssertionError: expected "vi.fn()" to be called 1 times, but got 0 times` ✅ valid red
- AC2: `npx vitest run test/deliveryExecutor.test.js -t "returns only the SQLSTATE"` →
  `AssertionError: expected null to be '23505' // Object.is equality` ✅ valid red
- AC3: `npx vitest run test/deliveryExecutor.test.js -t "never reads the credential"` →
  `AssertionError: expected '' to be 'fake-access-token-for-unit-tests' // Object.is equality` ✅ valid red
- Rest of the suite with the stubs: 534 passed, 19 skipped. The one other
  failure, `test/i18n.test.js` › "formats 24h time strings to the locale's
  12h form" (`'2:30 p. m.'` vs `'2:30 p. m.'`), fails identically on `main`
  in this container. It comes from Node 22's ICU spacing; CI runs Node 24.
  Not touched.

## Implementation tasks

Run top to bottom. Each task is atomic and has its own VALIDATE, and it isn't
done until that passes.

### 1. UPDATE `supabase/schema/rls_audit.sql` — owner approval

- **Implement:** the result row after `rollback;` and the header sentence,
  per Design. Nothing else in the file changes.
- **Gotcha:** the guard asks the owner before this edit (Default mode). A
  denied prompt halts the loop (conventions, loop). The row goes **after**
  `rollback;`: before it, the endpoint would return the rollback's empty
  result instead.
- **Validate:** `tail -n 2 supabase/schema/rls_audit.sql` prints `rollback;`
  context and the select;
  `npx vitest run test/deliveryProofs.test.js test/schemaHarness.db.test.js`
  (the db test skips without `SMP_SCHEMA_DB_URL`; CI's `schema` job runs it
  for real).
- **Satisfies:** AC4

### 2. CREATE `scripts/delivery/executors/managementApi.mjs`

- **Implement:** replace the stub per Design. JSDoc typedef imports from
  `./psql.mjs`. Named export only, plus `export const API_URL = "https://api.supabase.com"`.
- **Pattern:** `scripts/delivery/executors/psql.mjs:79-140`; reuse
  `parseMessages` (`psql.mjs:48`).
- **Gotcha:** read the response body once (`text()`), then `JSON.parse` in a
  try. Never build an error from `init.headers`, and never put the token in a
  thrown message.
- **Validate:** `npx vitest run test/deliveryExecutor.test.js -t "runs each SQL file as one unit"` and
  `npx vitest run test/deliveryExecutor.test.js -t "returns only the SQLSTATE"`
- **Satisfies:** AC1, AC2

### 3. CREATE `scripts/delivery/credential.mjs`

- **Implement:** replace the stub per Design.
- **Gotcha:** the test's input is a `PassThrough` with `isTTY` and a
  `setRawMode` spy; data written before the listener attaches is buffered,
  so attach `on("data")` and `resume()` after writing the question. Handle a
  whole token arriving in one chunk (a paste).
- **Validate:** `npx vitest run test/deliveryExecutor.test.js -t "never reads the credential"`
- **Satisfies:** AC3

### 4. ADD credential and executor edge tests (non-AC) in `test/deliveryExecutor.test.js`

- **Implement:** a second `describe` block (the three AC tests stay byte for
  byte as committed) covering: the prompt refuses a non-TTY input; Ctrl-C
  rejects; Backspace edits; `setRawMode` is turned back off; the executor
  throws on a bad ref / empty token / non-boolean `holdsRealData` without the
  token in the message; HTTP 401 on a test project →
  `HTTP 401: …`, `sqlstate null`; a `FAIL [label]` error on a test project
  keeps the label at the start of `error`; booleans and nulls map to
  `t`/`f`/`""`.
- **Validate:** `npx vitest run test/deliveryExecutor.test.js`

### 5. UPDATE `scripts/delivery/proofs.mjs` + `test/deliveryProofs.test.js`

- **Implement:** the result-row branch in `proveAudit`, `AUDIT_LEFTOVERS_SQL`,
  `proveNoAuditLeftovers` (JSDoc, a `LeftoverProof` typedef). Tests:
  "passes when the summary arrives as the final result row", "fails on a
  result row that isn't the summary", leftovers 0 → ok, 3 → not ok with
  `count: 3`, a failed statement → not ok with its error.
- **Pattern:** `scripts/delivery/proofs.mjs:44-72`
- **Validate:** `npx vitest run test/deliveryProofs.test.js`

### 6. CREATE `scripts/delivery/audit.mjs` + `test/deliveryAudit.test.js`

- **Implement:** `runAudit` and the CLI wrapper per Design. The wrapper runs
  only when the file is the entry point
  (`fileURLToPath(import.meta.url) === resolve(process.argv[1])`, as
  `.claude/hooks/guard.mjs:183-186`). Tests with a fake prompt and a fake
  `fetch`: a pass prints both lines and returns true; a FAIL prints the check
  name on a test project and only the SQLSTATE without `--test-data`;
  leftovers > 0 returns false; a bad ref is refused before the prompt; the
  token never appears in what was written.
- **Validate:** `npx vitest run test/deliveryAudit.test.js`

### 7. UPDATE `docs/epics/delivery-pipeline/architecture.md` (S2)

- **Implement:** a `Result (2026-10-16, #91): **yes**.` paragraph under S2,
  in the style of S1's: the endpoint ran the whole file as one request as
  `postgres`; it returns only the last statement's rows and no notices, so
  the file now ends in the result row; failures come back as
  `ERROR:  <SQLSTATE>: …`; functions metadata is enough for #101;
  `config/auth` (Open question 1); hidden prompt only; executor path.
- **Validate:** `npx prettier --check docs/epics/delivery-pipeline/architecture.md`

### 8. UPDATE `.claude/ARCHITECTURE_MAP.md` (Delivery table)

- **Implement:** rows for `scripts/delivery/audit.mjs`,
  `scripts/delivery/credential.mjs` and
  `scripts/delivery/executors/managementApi.mjs` in path order (all three go
  before `executors/psql.mjs`), and the `proofs.mjs` row extended (summary as
  a notice or the result row; the leftover count).
- **Validate:** each row names a file that exists; `npx prettier --check .claude/ARCHITECTURE_MAP.md`

### 9. Turn Phase R green

- **Validate:** every Phase R command passes; `npm run lint`,
  `npm run typecheck`, `npm test`, `npm run build`. AC4 is the owner's run,
  reported in the PR.

## Validation commands

```bash
npm run format:check && npm run lint && npm run typecheck
npm test
npm run build
npm run test:e2e
```

Plus each Phase R command above, and the owner's AC4 run.

## Open questions / assumptions

Each has a default the loop uses if the reviewer approves without overriding it.

1. `config/auth` wasn't reachable through the connector. The owner can run
   this read-only command on their machine. It prints only key names and
   value types, never values, and the token goes to curl on stdin, not argv:

   ```bash
   read -rsp "Token: " T && echo && printf 'Authorization: Bearer %s\n' "$T" | curl -sS -H @- https://api.supabase.com/v1/projects/wklxkntdnzshyrijvnjj/config/auth | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const c=JSON.parse(s);for(const k of ["site_url","uri_allow_list","password_hibp_enabled","mailer_templates_recovery_content"])console.log(k,k in c?typeof c[k]:"MISSING")})'; unset T
   ```

   **Default:** if no answer comes back by approval, S2 records `config/auth`
   as "not probed in S2; #101 confirms it", which doesn't change the
   decision.

2. With no projects list yet, how does `audit.mjs` know `holdsRealData`?
   **Default:** it treats every project as holding real data (SQLSTATE only)
   unless `--test-data` is passed. AC4 passes it for the pilot.
3. Should the guard cover `node scripts/delivery/audit.mjs`? It needs a TTY
   token and rolls back. **Default:** no guard change in this ticket. It's
   listed under "Not in this change" for the deliver tickets, which touch the
   guard anyway.

## Notes

- **Why not the psql executor for real projects:** the spike's "yes" makes the
  token the only credential, so no database password is ever typed or stored.
  The psql executor stays the CI executor (#87).
- **Parity with psql:** rows are text the way `psql -A -t` prints them
  (`t`/`f`, `""` for null). Numeric and JSON columns can still format
  differently between the two executors. Proofs that compare across
  executors (the fingerprint, #93) should return text built in SQL. Noted for
  #93.
- **The pilot pauses after 7 days idle** (free plan). AC4 needs it
  `ACTIVE_HEALTHY`. If it has paused again, the owner restores it from the
  dashboard and waits for the tables to come back before running.
- **`--test-data` on the pilot:** the pilot holds test data only (PRD
  evidence 12), so messages and check names are safe to show there.
- **Attended:** task 1 hits the guard's owner prompt. This ticket says
  `**Supabase:** yes`, so B1 runs with the owner present.

## AMENDMENTS

Append-only. Every change to this plan or to a frozen acceptance test after the
red commit goes here: date — what changed — why.

- 2026-10-16 — Task 1 (`rls_audit.sql`) moved after tasks 2–8 — after a
  worker restart the session came back in Accept Edits mode, and the guard
  refuses `supabase/` edits outside Default mode. Tasks 2–8 don't depend on
  it, because `proveAudit` accepts the notice and the row. The loop halts on
  task 1 until the owner switches back to Default mode.
- 2026-10-16 — `audit.mjs` prints a failure as
  `RLS audit on <ref>: FAIL (SQLSTATE <s>): <error>` instead of
  `FAIL [<check>] (SQLSTATE <s>) <error>` — on a test project the error
  already starts with `FAIL [<check>]`, so the plan's format printed the label
  twice. No acceptance check is affected.

## Manual Supabase steps

The SQL the owner applies by hand for `owner approval` tasks
(`supabase/schema/incremental_<name>.sql`, in order, with what each does).
Filled by `/piv-implement`. Otherwise "None."

- None. The `rls_audit.sql` edit changes no database: the file is run on
  demand and rolls back.

## Validation

Filled by `/piv-implement` and `/piv-validate`: the suite table and the per-AC
table (red before · green after). `/piv-review-changes` appends one
`### Review (round n)` subsection per round (verdict, the acceptance
validator's table verbatim, findings), and `/piv-fix-review-findings` adds what
was fixed, left out, or needs a decision under that same subsection.

Run 2026-10-17 at `ec912b7`:

| Check             | Result                  | Notes                                                                                                                                                             |
| ----------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| format:check      | ✅                      |                                                                                                                                                                   |
| lint              | ✅                      |                                                                                                                                                                   |
| typecheck         | ✅                      |                                                                                                                                                                   |
| unit              | ⚠️ 554 passed, 1 failed | `test/i18n.test.js` › "formats 24h time strings to the locale's 12h form" fails identically on a clean `origin/main` worktree here (Node 22 ICU); CI runs Node 24 |
| build             | ✅                      |                                                                                                                                                                   |
| e2e               | ✅ 119 passed           | `playwright.local.config.js` (untracked): the pinned `chromium_headless_shell-1228` isn't in the container, so `-1194` is used                                    |
| skip/only         | ✅ clean                |                                                                                                                                                                   |
| entry-point order | ✅                      | the quick check flags `src/js/admin.js` only because its header comment is 21 lines; `errorHandler.js` is its first import (line 22). No `src/` change            |
| `supabase/`       | ✅                      | only `supabase/schema/rls_audit.sql`, owner-approved at the guard prompt (2026-10-17)                                                                             |
| frozen AC tests   | ✅                      | `git diff 37490bc HEAD -- test/deliveryExecutor.test.js` removes no line; the edge tests are appended                                                             |

| AC  | Kind   | Red before (Phase R)                                       | Green after                   |
| --- | ------ | ---------------------------------------------------------- | ----------------------------- |
| AC1 | unit   | `expected "vi.fn()" to be called 1 times, but got 0 times` | ✅                            |
| AC2 | unit   | `expected null to be '23505'`                              | ✅                            |
| AC3 | unit   | `expected '' to be 'fake-access-token-for-unit-tests'`     | ✅                            |
| AC4 | verify | n/a                                                        | pending the owner's pilot run |

## Execution report

Filled by `/system-execution-report`.
