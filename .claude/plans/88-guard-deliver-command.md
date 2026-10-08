# Plan — Ask the owner before the deliver command runs

**Implements:** #88 · **Epic:** #86 · **Branch:** feat/guard-deliver-command
**Status:** Approved 2026-10-08
**Red commit:** dd410b0
**Confidence:** 9/10 that one unattended pass reaches a green PR

> Validate every pattern and path below against the code before acting on it.
> Import from the files named here; don't recreate helpers that already exist.

## Ticket

**Concern:** The deliver command will change live Supabase projects. The
PreToolUse guard treats `npm run deliver` and `node scripts/delivery/deliver.mjs`
like the Supabase and Postgres CLIs: ask in a Default-mode session, refuse in
every other mode. Tests and reads of the command stay allowed.

**User story:** As the repository owner, I want every session attempt to run
the deliver command to be shown to me or refused, so that no session changes a
live project without my approval.

**Type:** Enhancement · **Complexity:** Low
**Portals:** none (AI layer) · **Supabase:** no

## Inherited decisions

- The guard adds `npm run deliver` and `node scripts/delivery/deliver.mjs` to the
  database-changing commands: ask in Default mode, deny in every other mode —
  `architecture.md#supabase-impact-owner-approval`.
- The Supabase MCP rules stay as they are (owner's call) —
  `architecture.md#supabase-impact-owner-approval`.
- The guard matches the command line, so it lands before the command (#94)
  exists.

## Out of scope

- Not changing: the Supabase MCP rules, or how the Supabase and Postgres CLIs
  are matched.
- Not included: the deliver command itself (#94).

## Context references — read before implementing

- `.claude/hooks/guard.mjs:7-9` — `SUPABASE_CLI` and `POSTGRES_CLI`, whose
  command-position anchor `(?:^|[;&|(\n]\s*)` the new rule mirrors.
- `.claude/hooks/guard.mjs:33-37` — `supabaseDecision(payload)`, which picks
  ask or deny, and the reason, from `permission_mode`.
- `.claude/hooks/guard.mjs:140-145` — the Bash branch of `decide()` the new
  rule joins.
- `test/claudeHooks.test.js` — the `call()` helper, `inDefault`, and the new
  describe "guard hook: the deliver command needs the owner's approval".
- `.claude/references/conventions.md` (section supabase) — the guard's
  documented coverage.

### Patterns to follow

```js
// .claude/hooks/guard.mjs:141
if (SUPABASE_CLI.test(command) || POSTGRES_CLI.test(command))
  return supabaseDecision(payload);
```

## Phase R — acceptance checks, red before any change to the guard

| AC  | Behaviour                                                                                                                                   | Kind | Where (file › test name)                                                               | Command                                                                                        | Expected red                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| AC1 | In Default mode the three deliver command lines are asked, with the rule-5 reason                                                           | unit | `test/claudeHooks.test.js` › "asks before the deliver command in Default mode"         | `npx vitest run test/claudeHooks.test.js -t "asks before the deliver command in Default mode"` | expected undefined to be 'ask'                 |
| AC2 | In `acceptEdits`, `bypassPermissions` and `plan`, the same commands are denied with the no-prompt reason                                    | unit | `test/claudeHooks.test.js` › "refuses the deliver command when no prompt can be shown" | `npx vitest run test/claudeHooks.test.js -t "refuses the deliver command when no prompt"`      | expected undefined to be 'deny'                |
| AC3 | The vitest run, the `cat`, the `grep` and the read-only `gate.mjs --status` lines from the ticket pass through, in Default and bypass modes | unit | `test/claudeHooks.test.js` › "lets tests, reads and the read-only gate through"        | `npx vitest run test/claudeHooks.test.js -t "lets tests, reads and the read-only gate"`        | **green from the start** (see Open question 1) |

Both reasons are compared with the guard's own answer for `npx supabase db push`
in the same mode, so the tests pin "the same rule-5 reason" without copying the
string.

**STUB tasks:** none (the tests import the existing `decide`).

**Red evidence:**

- AC1: → 3 failed, `AssertionError: expected undefined to be 'ask' // Object.is equality` ✅ valid red
- AC2: → 9 failed, `AssertionError: expected undefined to be 'deny'` ✅ valid red
- AC3: → 4 passed. Not a red: it's a negative check, and nothing is blocked
  before the rule exists. It guards task 1 against an over-broad matcher.

## Implementation tasks

### 1. UPDATE `.claude/hooks/guard.mjs`

- **Implement:** a `DELIVER_CLI` constant next to `POSTGRES_CLI`, anchored at
  command position like it, matching `npm run deliver` (and `npm run-script
deliver`) and `node scripts/delivery/deliver.mjs` (optional `./`), each
  ending on a word boundary. Add `|| DELIVER_CLI.test(command)` to the Bash
  condition that returns `supabaseDecision(payload)`.
- **Pattern:** `.claude/hooks/guard.mjs:141`.
- **Gotcha:** the command-position anchor is what keeps `cat …/deliver.mjs` and
  `grep -rn deliver …` allowed (AC3); `gate.mjs` must not match at all.
- **Validate:** `npx vitest run test/claudeHooks.test.js`
- **Satisfies:** AC1, AC2, AC3

### 2. UPDATE `.claude/references/conventions.md` (section supabase)

- **Implement:** name the deliver command among the database-changing commands
  the guard covers (one phrase).
- **Validate:** `npx vitest run test/claudeSkills.test.js && npm run format:check`
- **Satisfies:** documented contract

### 3. Turn Phase R green

- **Validate:** every Phase R command passes; `npm run lint && npm test`.

## Validation commands

```bash
npm run format:check && npm run lint && npm run typecheck
npm test
npm run build
```

No app code changes, so `npm run test:e2e` runs once at the end as a
regression check.

## Open questions / assumptions

1. AC3 can't be red before the change: it says what must _not_ be blocked, and
   nothing is blocked yet. **Default:** keep it as written, as a guard against
   over-matching (it goes red if task 1's matcher is too broad). Resolved: default
   accepted at the gate.
2. Also catch `npm run-script deliver`? **Default:** yes, it's the same command
   and costs one optional group. Resolved: default accepted at the gate.
3. The ticket names auto-accept, bypass and plan for AC2. `auto`, `dontAsk` and
   a missing mode already fall to deny through `supabaseDecision`.
   **Default:** test the three named modes only. Resolved: default
   accepted at the gate.

## Notes

The rule reuses `supabaseDecision`, so the reasons and the mode logic stay in
one place. Rejected: matching any `deliver` word in a command, which would block
reads and greps (AC3).

Phase R tripped the guard once: a shell heredoc writing this plan quoted the
Postgres-CLI regex, and its alternation read as a database command. The plan
was written with the Write tool instead. A follow-up for the guard's
false-positive rate on quoted text, not for this ticket.

## AMENDMENTS

Append-only.

- (none)

## Manual Supabase steps

- None.

## Validation

| Check                 | Result                                                                                                                                                                                                                                         |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| format:check          | ✅                                                                                                                                                                                                                                             |
| lint                  | ✅                                                                                                                                                                                                                                             |
| typecheck             | ✅                                                                                                                                                                                                                                             |
| unit                  | ✅ 514 passed. 1 failure is the known Node-22 ICU case in `test/i18n.test.js` (es-CR 12h time), untouched by this branch; it passes in CI (Node 24)                                                                                            |
| build                 | ✅                                                                                                                                                                                                                                             |
| e2e                   | ✅ 116 passed (local browser fallback config). 3 `e2e/classExports.spec.js` cases fail on the download filename (`"download"`) with the container's Chromium 1194, identically without this branch's changes; no `src/` or `e2e/` file changed |
| skip/only scan        | ✅ clean                                                                                                                                                                                                                                       |
| entry-point order     | ✅ (`src/js/admin.js:22` imports `errorHandler.js` first; the `head -20` probe misses it behind the header comment)                                                                                                                            |
| `supabase/` untouched | ✅                                                                                                                                                                                                                                             |

| AC  | Kind | Red before (Phase R)                           | Green after |
| --- | ---- | ---------------------------------------------- | ----------- |
| AC1 | unit | `expected undefined to be 'ask'` (3 cases)     | ✅ 3 passed |
| AC2 | unit | `expected undefined to be 'deny'` (9 cases)    | ✅ 9 passed |
| AC3 | unit | green from the start (negative check, by plan) | ✅ 4 passed |

## Execution report
