# Plan — Deny Supabase changes when the session cannot show an approval prompt

**Implements:** free-form (pilot finding 1) · **Epic:** none · **Branch:** fix/guard-permission-mode
**Status:** Approved 2026-10-08
**Red commit:** 995a910
**Confidence:** 9/10 that one unattended pass reaches a green PR

> Validate every pattern and path below against the code before acting on it.

## Ticket

**Concern:**

- The PreToolUse guard answers `ask` for Supabase changes (hard rule 5).
- Some permission modes never show that prompt. In the pilot, a write to `supabase/GUARD_PROBE.md` went straight through.
- The guard must **deny** whenever a prompt can't be relied on, and keep asking only in Default mode, where the owner actually sees the prompt.

**User story:** As the repository owner, I want every Supabase change attempt to be either shown to me for approval or refused, so that hard rule 5 holds whichever permission mode a session runs in.

**Type:** Bug fix · **Complexity:** Low · **Portals:** none (AI layer) · **Supabase:** no

## Inherited decisions

None, since there's no epic. The guard's contract stays as `.claude/references/conventions.md` (section supabase) defines it. This change only makes it hold in every permission mode.

## Out of scope

- Not changing the env-file deny or the acceptance-validator holdout rules.
- Not adding an override mechanism. An approved Supabase change happens in a Default-mode session, or by hand.

## Context references

- `.claude/hooks/guard.mjs` (lines 120–141): the three Supabase branches that return `{ decision: "ask", reason: RULE_5 }`.
- `test/claudeHooks.test.js` (lines 38–80, 160–180): the `call()` helper (it passes no `permission_mode`), the "asks before …" cases, and the CLI contract test.
- Claude Code hook input: every PreToolUse payload carries `permission_mode` (`default`, `plan`, `acceptEdits`, `auto`, `dontAsk`, `bypassPermissions`).

## Phase R — acceptance checks, red before any change to the guard

| AC  | Behaviour                                                                                                                                                                                      | Kind  | Where (file › test name)                                                                               | Command                                                                 | Expected red                   |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- | ------------------------------ |
| AC1 | In a mode that can skip the prompt (`bypassPermissions`, `acceptEdits`, `auto`, `dontAsk`, `plan`) or with no mode, a Supabase edit, a database command or a Supabase MCP write tool is denied | unit  | `test/claudeHooks.test.js` › "denies Supabase changes when the permission mode would skip the prompt"  | `npx vitest run test/claudeHooks.test.js -t "would skip the prompt"`    | expected 'ask' to be 'deny'    |
| AC2 | The deny reason tells the agent to stop and have the owner switch the session to Default mode or apply the change by hand                                                                      | unit  | `test/claudeHooks.test.js` › "explains how an approved Supabase change gets through"                   | `npx vitest run test/claudeHooks.test.js -t "approved Supabase change"` | reason doesn't match /Default/ |
| G1  | In Default mode, every Supabase change still asks the owner                                                                                                                                    | guard | the existing "asks before …" cases and the CLI contract test, now passing `permission_mode: "default"` | `npx vitest run test/claudeHooks.test.js -t "asks before"`              | green from the start           |
| G2  | Non-Supabase calls stay allowed in every mode                                                                                                                                                  | guard | "lets non-Supabase calls through in every permission mode"                                             | `npx vitest run test/claudeHooks.test.js -t "every permission mode"`    | green from the start           |

**Red evidence** (filled when Phase R runs):

- AC1: `npx vitest run test/claudeHooks.test.js -t "would skip the prompt"` → 18 failing, `AssertionError: expected 'ask' to be 'deny'` ✅ valid red
- AC2: `npx vitest run test/claudeHooks.test.js -t "approved Supabase change"` → `AssertionError: expected 'Hard rule 5: Supabase schema, RLS, Au…' to match /Default/` ✅ valid red
- G1: 13 passing · G2: 6 passing (green from the start, as guards should be)

## Implementation tasks

### 1. UPDATE `.claude/hooks/guard.mjs`

- **Implement:**
  - A `supabaseDecision(payload)` helper returns `{ decision: "ask", reason: RULE_5 }` only when `payload.permission_mode === "default"`, and otherwise `{ decision: "deny", reason: RULE_5_NO_PROMPT }`.
  - `RULE_5_NO_PROMPT` explains that this session's permission mode can't show the owner an approval prompt, so the change is refused. The owner can switch the session to Default mode and retry, or apply the change by hand.
  - Use the helper in all three Supabase branches.
- **Pattern:** the existing reason constants and early returns in `decide()`.
- **Gotcha:** keep the env-file deny and validator rules ahead of the Supabase checks; their order is unchanged.
- **Validate:** `npx vitest run test/claudeHooks.test.js`
- **Satisfies:** AC1, AC2, G1, G2

### 2. UPDATE the docs that describe the guard

- **Implement:**
  - `.claude/references/conventions.md` (section supabase): the guard asks only in Default mode and denies in every other mode. A `Supabase: yes` ticket runs attended in a Default-mode session.
  - `docs/DEVELOPMENT_PROCESS.md`: the guardrail row and the "A Supabase prompt appeared" troubleshooting line.
  - `.claude/skills/piv-implement/SKILL.md` step 4, `.claude/skills/piv-implement-issue/SKILL.md` section 3, the A1 warning in `.claude/skills/piv-run-full-loop/SKILL.md`, and section 0 of `.claude/skills/prime-backend/SKILL.md`: one phrase each saying "in a Default-mode session".
- **Validate:** `npx vitest run test/claudeSkills.test.js`
- **Satisfies:** AC2 (documented contract)

### 3. Turn Phase R green

- **Validate:** every Phase R command passes; `npm run lint && npm test`.

## Validation commands

```bash
npm run format:check && npm run lint && npm run typecheck
npm test
npm run build
```

E2E is untouched (no app code), so `npm run test:e2e` runs once at the end as a regression check.

## Open questions / assumptions

1. Which modes keep `ask`? **Default:** only `default`. `plan` also denies: nothing should touch the database while planning. Resolved: default accepted at the gate.
2. A payload without `permission_mode`? **Default:** deny, which fails safe. Resolved: default accepted at the gate.

## Notes

Rejected alternative: deny always and never ask. Simpler, but a `Supabase: yes` ticket could then never add its own `incremental_*.sql` file, even with the owner watching in Default mode.

## Manual Supabase steps

- None.

## AMENDMENTS

- (none)

## Validation

Filled by `/piv-implement` and `/piv-validate`.

## Execution report

Filled by `/system-execution-report`.
