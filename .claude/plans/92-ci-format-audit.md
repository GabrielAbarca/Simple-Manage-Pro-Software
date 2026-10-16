# Plan — Check formatting and dependency health on every pull request

**Implements:** #92 · **Epic:** #86 · **Branch:** chore/ci-format-audit
**Status:** Approved 2026-10-16
**Red commit:** 574b2bf
**Confidence:** 9/10 that one unattended pass reaches a green PR

> Validate every pattern and path below against the code before acting on it.
> Import from the files named here; don't recreate helpers that already exist.

## Ticket

**Concern:** Every pull request checks formatting and reports dependency
advisories. Dependabot keeps npm and GitHub Actions dependencies current, and
`package.json` pins Node 24.x so CI and both Vercel sites build on the same
Node. The advisory report never fails a pull request; blocking a release on a
high or critical runtime advisory is #100's job.

**User story:** As the owner, I want every pull request to prove formatting
and show its dependency advisories, with dependencies kept current and one Node
version everywhere, so that a formatting slip or a vulnerable package is seen
before merge and the two sites stop building on different Node versions.

**Type:** Enhancement · **Complexity:** Low
**Portals:** none (CI and repository config) · **Supabase:** no

## Inherited decisions

- `npm run format:check` joins the `quality` job.
  `architecture.md#validation-strategy`
- `npm audit` is **reported** on PRs; only the release blocks, on a high or
  critical runtime advisory (`npm audit --omit=dev --audit-level=high`, #100).
  Dev-only findings are reported but don't block.
  `architecture.md#security-and-privacy` (Supply chain)
- Dependabot covers npm and GitHub Actions. Dependabot alerts, security
  updates, CodeQL and secret-scanning push protection are owner settings, not
  files. `architecture.md#security-and-privacy`,
  `architecture.md#architecture_map-rows-to-add`
- Both sites build with `engines.node` 24.x in `package.json`, honoured by
  Vercel and read by CI. `architecture.md#versions-and-releases`
- No new npm dependency. `architecture.md#other-build-vs-buy`

## Out of scope

- Not included: blocking a release on advisories (#100); GitHub and Vercel
  settings (the owner's checklist on the epic #86: Dependabot alerts and
  security updates, CodeQL, push protection, Node 24 and the Vite preset on
  both Vercel projects).
- Not included: widening `format:check` beyond its current globs
  (`src/**/*.{js,css}` and root `*.{js,json}`). `test/`, `e2e/`, `scripts/`,
  Markdown and YAML stay outside it (Not in this change).
- Not changing: the `schema` job's steps other than its `setup-node` input
  (Open question 1); the `e2e` job's steps other than the same input.
- Not fixing: today's advisories (`npm audit`: 51, all dev-only;
  `npm audit --omit=dev`: 0). Dependabot's first run proposes the fixes.

## Context references — read before implementing

- `.github/workflows/ci.yml` lines 16–29 — the `quality` job; lines 20–23,
  35–38, 57–60 — the three `actions/setup-node@v6` steps with
  `node-version: 24`.
- `test/ciWorkflow.test.js` — #87's test plus this ticket's four checks. It
  reads the YAML as text: `block(from, key, indent)` slices a mapping by
  indent, `items(lines)` splits a list into entries, `steps(job)` returns a
  job's steps, `command(step)` its `run:`.
- `test/securityHeaders.test.js` lines 1–11 — the pattern: assert a committed
  config file, read with `readFileSync(new URL(…, import.meta.url))`.
- `package.json` lines 1–21 — where `engines` goes (after `license`, before
  `lint-staged`); `format:check` script on line 11.
- `package-lock.json` lines 6–10 — the root `packages[""]` entry, which npm
  fills with `engines` when `package.json` has it.
- `.claude/ARCHITECTURE_MAP.md` lines 275–287 — the Delivery table (sorted by
  path).
- `CLAUDE.md` line 70, `.claude/references/validation-ladder.md` line 21,
  `README.md` line 98 — the three lines that describe CI's steps or the Node
  prerequisite and go stale with this change (Open question 3).

### Patterns to follow

`.github/workflows/ci.yml:20-25` (the shape every `setup-node` step keeps,
with only the version input swapped):

```yaml
- uses: actions/setup-node@v6
  with:
    node-version: 24 # becomes: node-version-file: package.json
    cache: npm
```

With `node-version-file: package.json`, `actions/setup-node` takes the version
from `engines.node` (a `volta.node` would win, but none is set); `24.x`
resolves to the latest 24 release.

## Phase R — acceptance checks, red before any `src/` change

| AC  | Behaviour                                                             | Kind | Where (file › test name)                                                                          | Command                                                                                                           | Expected red                                      |
| --- | --------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| AC1 | The `quality` job runs `npm run format:check` before lint             | unit | `test/ciWorkflow.test.js` › "checks formatting in the quality job"                                | `npx vitest run test/ciWorkflow.test.js -t "checks formatting in the quality job"`                                | no format step: `expected -1 > -1`                |
| AC2 | PRs run `npm audit` and report what it finds without failing the job  | unit | `test/ciWorkflow.test.js` › "reports dependency advisories on pull requests without failing them" | `npx vitest run test/ciWorkflow.test.js -t "reports dependency advisories on pull requests without failing them"` | no audit step: `expected undefined to be defined` |
| AC3 | `.github/dependabot.yml` updates npm and GitHub Actions weekly        | unit | `test/ciWorkflow.test.js` › "keeps npm and GitHub Actions dependencies updated weekly"            | `npx vitest run test/ciWorkflow.test.js -t "keeps npm and GitHub Actions dependencies updated weekly"`            | no file: `expected false to be true`              |
| AC4 | `engines.node` is `24.x`, and CI's Node setup reads that same version | unit | `test/ciWorkflow.test.js` › "builds on Node 24.x everywhere"                                      | `npx vitest run test/ciWorkflow.test.js -t "builds on Node 24.x everywhere"`                                      | `expected undefined to be '24.x'`                 |
| G0  | #87's schema-job check still holds                                    | unit | `test/ciWorkflow.test.js` › "runs the schema job on every pull request without any secret"        | `npx vitest run test/ciWorkflow.test.js -t "runs the schema job on every pull request without any secret"`        | green from the start                              |

What each check pins beyond the AC's headline:

- **AC1:** the format step is a plain gate: no `if:` and no
  `continue-on-error:` on it.
- **AC2:** the workflow triggers on `pull_request`; the `quality` job has no
  job-level `if:`; the audit step's `if:` (if any) mentions `pull_request`;
  the step can't fail the job (`continue-on-error: true`, or a run ending in
  `|| true`); and it reports everything (no `--omit`, `--production` or
  `--only`, so dev findings are reported as the architecture requires).
- **AC3:** `version: 2`; one `updates` entry each for `npm` and
  `github-actions`, each with `directory: /`, `interval: weekly` and no
  `open-pull-requests-limit: 0` (which would switch version updates off).
- **AC4:** every `actions/setup-node` step in every job of `ci.yml` reads
  `node-version-file: package.json` and none keeps a `node-version:` of its
  own (Open question 1).

**STUB tasks:** none. No test imports a module that doesn't exist; AC3 checks
the file's existence with `existsSync` before reading it, so a missing file is
an assertion failure, not an `ENOENT`.

**Red evidence** (Phase R run on 2026-10-16, Node 22.22.0):

- AC1: `npx vitest run test/ciWorkflow.test.js -t "checks formatting in the quality job"` → `AssertionError: expected -1 to be greater than -1` ✅ valid red
- AC2: `npx vitest run test/ciWorkflow.test.js -t "reports dependency advisories on pull requests without failing them"` → `AssertionError: expected undefined to be defined` ✅ valid red
- AC3: `npx vitest run test/ciWorkflow.test.js -t "keeps npm and GitHub Actions dependencies updated weekly"` → `AssertionError: expected false to be true // Object.is equality` ✅ valid red
- AC4: `npx vitest run test/ciWorkflow.test.js -t "builds on Node 24.x everywhere"` → `AssertionError: expected undefined to be '24.x' // Object.is equality` ✅ valid red
- G0: `npx vitest run test/ciWorkflow.test.js -t "runs the schema job on every pull request without any secret"` → `1 passed` ✅ green
- `npx vitest run`: 534 passed, 5 failed: the four checks above plus
  `test/i18n.test.js` › "formats 24h time strings to the locale's 12h form",
  the known Node 22 ICU failure that passes on Node 24 (CI's version).
- Dry run: the implementation below, applied in a throwaway worktree, turns
  `test/ciWorkflow.test.js` 5/5 green.

## Implementation tasks

Run top to bottom. Each task is atomic and has its own VALIDATE, and it isn't done
until that passes. Actions: CREATE · UPDATE · ADD · REMOVE · REFACTOR · MIRROR.

### 1. UPDATE `.github/workflows/ci.yml` (`quality` job)

- **Implement:** after `- run: npm ci`, add, in this order:
  ```yaml
  - name: Report dependency advisories
    continue-on-error: true
    run: npm audit
  - run: npm run format:check
  ```
  then the existing `npm run lint` … `npm run build` steps, unchanged. Rename the
  job to `name: format · lint · typecheck · unit · build`.
- **Pattern:** the existing `- run:` steps, `ci.yml:24-28`.
- **Gotcha:** `npm audit` exits 1 on any advisory (51 today, all dev-only).
  `continue-on-error: true` keeps the job green while the step shows as failed
  with its annotation, which is the report. No `--omit=dev`: dev findings must
  show. The step sits right after `npm ci` so a later failure (lint, tests)
  never skips the report. Renaming the job changes the check's display name;
  if `main`'s ruleset requires the check by its old name, the owner updates
  the required check (Open question 4).
- **Validate:** `npx vitest run test/ciWorkflow.test.js -t "checks formatting in the quality job"` and `npx vitest run test/ciWorkflow.test.js -t "reports dependency advisories on pull requests without failing them"`
- **Satisfies:** AC1, AC2

### 2. UPDATE `package.json` and `package-lock.json`

- **Implement:** add `"engines": { "node": "24.x" }` after `"license"`. Then
  regenerate the lockfile's root entry with npm, never by hand:
  `npm install --package-lock-only --ignore-scripts`.
- **Gotcha:** the lockfile diff must be only the three added `engines` lines
  at the end of `packages[""]` (dry-run on 2026-10-16: exactly that). If npm
  re-resolves anything else, revert and stop. On the local Node 22, npm prints
  an `EBADENGINE` warning; that's expected (no `engine-strict`).
- **Validate:** `node -e "process.exit(require('./package.json').engines.node === '24.x' ? 0 : 1)"`, `git diff package-lock.json | grep -c '^[+-] '` prints 3, and `npx prettier --check package.json`
- **Satisfies:** AC4 (first half)

### 3. UPDATE `.github/workflows/ci.yml` (every `setup-node` step)

- **Implement:** in the `quality`, `e2e` and `schema` jobs, replace
  `node-version: 24` with `node-version-file: package.json`; `cache: npm`
  stays.
- **Gotcha:** this touches one line in the `e2e` and `schema` jobs, outside the
  ticket's "`quality` job's steps only" seam (Open question 1). No open branch
  edits those jobs today (`feat/delivery-manifest` doesn't touch `ci.yml`;
  #97 and #103 have no branch yet).
- **Validate:** `npx vitest run test/ciWorkflow.test.js -t "builds on Node 24.x everywhere"`
- **Satisfies:** AC4 (second half)

### 4. CREATE `.github/dependabot.yml`

- **Implement:**
  ```yaml
  version: 2
  updates:
    - package-ecosystem: npm
      directory: /
      schedule:
        interval: weekly
    - package-ecosystem: github-actions
      directory: /
      schedule:
        interval: weekly
  ```
- **Gotcha:** Dependabot's own defaults apply: up to 5 open PRs per ecosystem,
  one PR per dependency, no grouping (Open question 2). Its PRs run the full CI,
  including the `schema` job, which needs no secret, so they work without
  Dependabot secrets.
- **Validate:** `npx vitest run test/ciWorkflow.test.js -t "keeps npm and GitHub Actions dependencies updated weekly"`
- **Satisfies:** AC3

### 5. UPDATE the three stale lines (Open question 3)

- **Implement:**
  - `CLAUDE.md:70`: "mirrors `lint` → `typecheck` → `test` → `build`" becomes
    "mirrors `format:check` → `lint` → `typecheck` → `test` → `build`", and
    "Run `lint`, `typecheck`, `test`, and `build` locally" becomes "Run
    `format:check`, `lint`, `typecheck`, `test`, and `build` locally".
  - `.claude/references/validation-ladder.md:21`: "CI runs rungs 2–6" becomes
    "CI runs rungs 1–6".
  - `README.md:98`: "Node.js 22+" becomes "Node.js 24.x".
- **Validate:** `grep -n 'format:check' CLAUDE.md && grep -n 'rungs 1–6' .claude/references/validation-ladder.md && grep -n 'Node.js 24.x' README.md`

### 6. UPDATE `.claude/ARCHITECTURE_MAP.md` (Delivery table)

- **Implement:**
  - Insert a `.github/dependabot.yml` row above the `ci.yml` row (path
    order): "Weekly Dependabot version updates for npm and GitHub Actions.
    Alerts and security updates are repository settings."
  - Rename that row's path to `.github/workflows/ci.yml` and lead its text
    with the `quality` job: "`quality` runs `format:check` before lint,
    typecheck, unit and build, and reports `npm audit` without failing. Every
    job's Node comes from `engines.node`." The existing `schema` sentence stays
    as is.
  - Re-run Prettier on the file so the table stays aligned.
- **Validate:** `npx prettier --check .claude/ARCHITECTURE_MAP.md` and `test -f .github/dependabot.yml`

### 7. Turn Phase R green

- **Validate:** `npx vitest run test/ciWorkflow.test.js` (5 passed) and
  `npm run format:check`

## Validation commands

```bash
npm run format:check && npm run lint && npm run typecheck
npm test
npm run build
npm run test:e2e
```

Plus each Phase R command above. No `verify` AC (nothing user-facing).

## Open questions / assumptions

Each has a default the loop uses if the reviewer approves without overriding it.

1. **Which `setup-node` steps read `engines.node`?** The ticket's seam says the
   `quality` job's steps only, and keeps the `schema` job for #87, #97 and
   #103. But AC4 says "CI's Node setup reads that same version", and a
   hard-coded `24` left in `e2e` and `schema` is a second source of truth that
   drifts on the next bump. — **Default:** all three jobs read
   `node-version-file: package.json` (one line each in `e2e` and `schema`; no
   open branch edits them). AC4's test checks every `setup-node` step. The
   override "quality only" narrows the test to the `quality` job and re-runs
   Phase R for AC4. Resolved: the default (approved 2026-10-16).
2. **Group Dependabot updates?** — **Default:** no. Dependabot's defaults (one
   PR per dependency, at most 5 open per ecosystem) stand; grouping minor and
   patch bumps can come later if the PR volume is a nuisance. Resolved: the
   default (approved 2026-10-16).
3. **Update the lines that go stale?** `CLAUDE.md:70` lists CI's steps without
   `format:check`, `validation-ladder.md:21` says CI runs rungs 2–6, and
   `README.md:98` says Node.js 22+. — **Default:** yes, the one-line edits in
   task 5. Resolved: the default (approved 2026-10-16).
4. **Rename the `quality` job's display name** to
   `format · lint · typecheck · unit · build`? If `main`'s ruleset requires the
   check by its current name, the owner has to update the required check. —
   **Default:** yes, rename (the name lists what the job runs). Override: keep
   the old name. Resolved: the default (approved 2026-10-16).

## Notes

- **Why `continue-on-error` and not `|| true`:** with `|| true` the step is
  always green and a finding is visible only by opening the log. With
  `continue-on-error: true` the job and the PR check stay green, while the
  step is marked failed and its annotation shows on the run summary, so the
  report is visible. A broken `npm audit` (registry down) also shows there
  instead of passing silently. The test accepts either mechanism; the plan
  picks this one.
- **Why the audit step runs on pushes too:** no `if:` on the step. AC2 asks
  for pull requests and the step runs there; on a push to `main` it adds a
  report at no cost. The test only rejects an `if:` that would skip pull
  requests.
- **Today's advisories:** `npm audit` finds 51 (1 low, 7 moderate, 42 high, 1
  critical), all in dev dependencies (`npm audit --omit=dev`: 0). Every PR
  shows the audit step as failed until Dependabot's updates clear them. That's
  the intended report, not a red check.
- **Vercel:** `engines.node: 24.x` takes precedence over each Vercel project's
  Node setting, so the demo site (Node 22.x in its settings, PRD evidence 9)
  builds on 24 from the next deploy, with a warning in its build log until the
  owner changes the setting too. That setting stays on the owner's checklist.
- **Lockfile:** npm copies `engines` into `packages[""]`. Leaving it out
  doesn't break `npm ci`, but a later `npm install` would add it in an
  unrelated diff, so task 2 regenerates it now.
- **Coupling check:** the implementation lives in `.github/workflows/ci.yml`,
  `.github/dependabot.yml` (new) and `package.json`, not `src/`. The acceptance
  validator's revert step should restore `.github`, `package.json` and
  `package-lock.json` to the red commit and delete `.github/dependabot.yml`.
- **Branch names:** Dependabot's PRs come from `dependabot/…` branches, outside
  the `<type>/<words>` rule, which is for people and agents. Their commit
  subjects ("Bump vite from 5.2.11 to 5.4.0") already match the history's
  plain imperative style; no `commit-message` prefix is configured.
- **Not in this change:** `format:check` doesn't cover `test/`, `e2e/`,
  `scripts/`, Markdown or YAML; lint-staged formats most of them on commit,
  but CI doesn't prove it.

## AMENDMENTS

Append-only. Every change to this plan or to a frozen acceptance test after the
red commit goes here: date — what changed — why.

- 2026-10-16 — Task 6: the `ci.yml` row's `schema` sentence now starts
  "`schema`, on every PR, starts…" instead of staying word for word — once the
  path lost its `(schema)` suffix, the sentence needed the job named to say
  which job it describes. No test or AC affected.

## Manual Supabase steps

The SQL the owner applies by hand for `owner approval` tasks
(`supabase/schema/incremental_<name>.sql`, in order, with what each does).
Filled by `/piv-implement`. Otherwise "None."

- None.

## Validation

Filled by `/piv-implement` and `/piv-validate`: the suite table and the per-AC
table (red before · green after). `/piv-review-changes` appends one
`### Review (round n)` subsection per round (verdict, the acceptance
validator's table verbatim, findings), and `/piv-fix-review-findings` adds what
was fixed, left out, or needs a decision under that same subsection.

Run on 2026-10-16, before the implementation commit.

| Check             | Result                                                                                                                                                                                          |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| format:check      | ✅                                                                                                                                                                                              |
| lint              | ✅                                                                                                                                                                                              |
| typecheck         | ✅                                                                                                                                                                                              |
| unit              | ✅ 539 passed, 19 skipped on Node 24.22.0. On the container's Node 22.22.0: 538 passed, plus the known ICU failure in `test/i18n.test.js` › "formats 24h time strings to the locale's 12h form" |
| build             | ✅                                                                                                                                                                                              |
| e2e               | ✅ 119 passed (local config: `playwright.local.config.js` with `/opt/pw-browsers/chromium-1194`, because the bundled headless shell is missing)                                                 |
| YAML parse        | ✅ `ci.yml` and `dependabot.yml` load with PyYAML; all three `setup-node` steps read `node-version-file: package.json`                                                                          |
| skip/only         | ✅ clean                                                                                                                                                                                        |
| entry order       | ✅                                                                                                                                                                                              |
| i18n, `supabase/` | ✅ untouched                                                                                                                                                                                    |

| AC  | Kind | Red before (from Phase R)           | Green after |
| --- | ---- | ----------------------------------- | ----------- |
| AC1 | unit | `expected -1 to be greater than -1` | ✅          |
| AC2 | unit | `expected undefined to be defined`  | ✅          |
| AC3 | unit | `expected false to be true`         | ✅          |
| AC4 | unit | `expected undefined to be '24.x'`   | ✅          |
| G0  | unit | green from the start                | ✅          |

### Review (round 1)

**Verdict:** fix before PR (Low only) · **Acceptance:** PASS · reviewed at
`374cea3`

| AC  | Kind | Exists | Faithful | Passes | Coupled           | Frozen    | Probe      | Verdict |
| --- | ---- | ------ | -------- | ------ | ----------------- | --------- | ---------- | ------- |
| AC1 | unit | yes    | yes      | yes    | yes, fails at RED | unchanged | n/a (unit) | PASS    |
| AC2 | unit | yes    | yes      | yes    | yes, fails at RED | unchanged | n/a (unit) | PASS    |
| AC3 | unit | yes    | yes      | yes    | yes, fails at RED | unchanged | n/a (unit) | PASS    |
| AC4 | unit | yes    | yes      | yes    | yes, fails at RED | unchanged | n/a (unit) | PASS    |

The validator proved coupling by reverting `.github/workflows/ci.yml`,
`package.json` and `package-lock.json` to RED and deleting
`.github/dependabot.yml`; the literal recipe (`src`, `public`, `*.html`)
touches nothing this ticket changed.

Findings: 0 Critical · 0 High · 0 Medium · 3 Low.

- Low · `.github/dependabot.yml:3` — no major-version ignore for
  `@types/node`; Dependabot would propose `^26` (latest 26.6.5) against
  `engines.node` 24.x.
- Low · `test/ciWorkflow.test.js:83` — AC1 doesn't reject a job-level
  `continue-on-error:` on `quality` (frozen test).
- Low · `package.json:12` — `format:check` globs narrower than `format`'s
  (pre-existing).

Outcome (`/piv-fix-review-findings --unattended`, fixed policy: Low findings
are listed, not fixed):

- Not in this change: `@types/node` major bumps from Dependabot. The first
  run will propose `@types/node` `^26` against `engines.node` 24.x; decline
  that PR, or add
  `ignore: [{ dependency-name: "@types/node", update-types: ["version-update:semver-major"] }]`
  to the npm entry (AC3 still passes with it).
- Not in this change: AC1 doesn't reject a job-level `continue-on-error:` on
  `quality`. Tightening it changes a frozen acceptance test, which needs the
  owner's agreement and an amendment.
- Not in this change: `format:check` covers only `src/**/*.{js,css}` and root
  `*.{js,json}` (pre-existing; `test/`, `e2e/` and `scripts/` are
  Prettier-clean today, so widening it would cost nothing).
- No code changed in this round, so round 1 is the final review: acceptance
  PASS, no Critical or High finding open.

## Execution report

**Files:** +2 ~8 −0 · **Lines:** +527 −16 (config and tests: +122 −5) ·
**Review rounds:** 1 · **Outcome:** ready PR

### Validation summary

format ✅ · lint ✅ · types ✅ · unit ✅ (539 on Node 24.22.0; 538 plus the
known ICU failure on the container's Node 22) · build ✅ · e2e ✅ (119, local
Chromium config) · acceptance validator: PASS (AC1–AC4)

### What went well

- The ticket named the pattern (`test/securityHeaders.test.js`) and the seam
  (#87's `block()` helper), so the four checks were a small extension of an
  existing file: two helpers (`items`, `steps`) and no YAML dependency.
- Dry-running the planned implementation in a throwaway worktree before the
  red commit proved the frozen tests could go green with the intended change,
  and the lockfile dry-run fixed the exact `git diff` count the task validates.
- Writing the plan's Notes with the coupling paths (`.github`, `package.json`,
  `package-lock.json`) let the validator prove coupling on the first pass
  instead of reporting UNPROVEN.

### Divergences from the plan

- **ARCHITECTURE_MAP `ci.yml` row wording** — planned: the `schema` sentence
  stays word for word · actual: it starts "`schema`, on every PR, starts…" ·
  why: once the path lost its `(schema)` suffix the sentence no longer said
  which job it describes · type: plan assumption wrong.
- **Prettier re-aligned the whole Delivery table** — planned: two rows · actual:
  every row of the table was rewritten, because the longer `ci.yml` row is
  now the widest cell and the Responsibility column widened · why: Prettier
  pads Markdown tables to the widest cell · type: missing context. `feat/delivery-manifest` also
  edits this table, so whichever merges second re-runs Prettier on it.

### Challenges

- The worker restarted between implementation and commit. The working tree
  survived, and the plan's task-by-task Validate lines made it clear where to
  resume.
- The container runs Node 22, so the unit rung shows the known ICU failure.
  Downloading the Node 24 binary into the scratchpad and running Vitest under
  it gave a clean 539/539 that matches CI.
- The bundled Playwright headless shell (`chromium_headless_shell-1228`) is
  missing; e2e ran through `playwright.local.config.js` pointed at
  `/opt/pw-browsers/chromium-1194`.

### Skipped

- None. The three Low review findings are listed under Review (round 1) and in
  the PR body.

### Recommendations

- **Plan skill:** when a ticket adds Dependabot (or any updater) next to a
  version pin, have the plan check each pinned toolchain's type package
  against the registry (`npm view @types/node version`) and decide the
  major-update policy at the gate, not in review.
- **References (validation ladder, acceptance validator):** this is the third
  tooling ticket (#87, #90, #92) whose coupling proof needed paths outside
  `src`, `public` and `*.html`. Make the recipe "restore every path the
  branch's non-test diff touches" (`git diff --name-only RED HEAD -- . ':!test' ':!e2e' ':!.claude'`).
- **piv-validate:** add "run the unit rung on CI's Node when the container's
  differs" with the scratchpad-download recipe, so the ICU failure stops being
  reported as a known exception on every ticket.
- **CLAUDE.md / ARCHITECTURE_MAP:** none beyond this change's own edits.
- **Ticket slicing:** size S was right (+122 −5 in config and tests). The seam
  note "the `quality` job's steps only" conflicted with AC4's "CI's Node setup";
  the gate resolved it, but the ticket could have said "every `setup-node`
  step" up front.
