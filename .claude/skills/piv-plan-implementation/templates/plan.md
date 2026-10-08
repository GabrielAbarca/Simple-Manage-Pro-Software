# Plan — <ticket title>

**Implements:** #<N> · **Epic:** #<E> · **Branch:** <type>/<two-or-three-words>
**Status:** Draft
**Red commit:** <short sha of the newest `Add failing checks for` commit, filled at approval>
**Confidence:** <n>/10 that one unattended pass reaches a green PR

> Validate every pattern and path below against the code before acting on it.
> Import from the files named here; don't recreate helpers that already exist.

## Ticket

**Concern:** <the ticket's concern, verbatim or tightened>

**User story:** As a <admin | teacher | student | guardian>, I want to <action>,
so that <outcome>.

**Type:** New capability | Enhancement | Refactor | Bug fix · **Complexity:** Low | Medium | High
**Portals:** <admin | teacher | student | login> · **Supabase:** no | yes (owner-approved items below)

## Inherited decisions

Calls already made in `docs/epics/<slug>/architecture.md` that this plan follows
and doesn't reopen (stack, data shape, seams, demo behaviour, Supabase
impact). If the ticket truly has to break one, it's listed under Open questions,
not changed silently.

- <decision> — `architecture.md#<section>`

## Out of scope

- Not included: <thing> (left for <ticket / later>)
- Not changing: <existing behaviour to leave alone>

## Context references — read before implementing

- `src/js/<file>.js` (lines <a–b>) — why: <pattern to mirror / seam to change>
- `test/<module>.test.js` — why: test pattern for this area
- `e2e/<feature>.spec.js`, `e2e/fixtures.js` (<fixture set>) — why: e2e pattern
- `src/js/i18n/en/<area>.js`, `src/js/i18n/es/<area>.js` — why: where the strings go

### Patterns to follow

<short excerpts from this codebase, with file:line, showing the shapes to copy:
module wiring, a dialog or table, gateway call and error handling, demo-overlay
registration, i18n usage, JSDoc style>

## Phase R — acceptance checks, red before any `src/` change

| AC  | Behaviour                      | Kind  | Where (file › test name)      | Command                                           | Expected red               |
| --- | ------------------------------ | ----- | ----------------------------- | ------------------------------------------------- | -------------------------- |
| AC1 | <…>                            | e2e   | `e2e/<f>.spec.js` › "<name>"  | `npx playwright test e2e/<f>.spec.js -g "<name>"` | locator `<…>` not found    |
| AC2 | <…>                            | unit  | `test/<m>.test.js` › "<name>" | `npx vitest run test/<m>.test.js -t "<name>"`     | expected <x>, received <y> |
| G1  | No demo write reaches Supabase | guard | AC1 spec                      | (runs with AC1)                                   | green from the start       |

**STUB tasks** (only when a test imports something that doesn't exist yet):

- STUB `src/js/<new>.js`: export `<fn>(<params>)` returning <neutral value>, so AC2 fails on its assertion.

**Verify scenarios** (only for `verify` ACs):

- AC3: portal <…> · role <…> · lang <en | es> · viewport <desktop | Pixel 7> · steps <…> · must see <…>

**Red evidence** (filled when Phase R runs):

- AC1: `<command>` → `<the assertion or locator failure line>` ✅ valid red
- AC2: `<command>` → `<…>` ✅ valid red

## Implementation tasks

Run top to bottom. Each task is atomic and has its own VALIDATE, and it isn't done
until that passes. Actions: CREATE · UPDATE · ADD · REMOVE · REFACTOR · MIRROR.

### 1. <ACTION> `<path>`

- **Implement:** <exactly what>
- **Pattern:** `<file>:<line>`
- **Gotcha:** <the trap: demo overlay, async re-render, IS_ADMIN lock, import cycle, …>
- **Validate:** `<non-interactive command>`
- **Satisfies:** AC<n>

### n-2. ADD i18n keys

- **Implement:** keys in `src/js/i18n/en/<area>.js` and `src/js/i18n/es/<area>.js` (Spanish in _usted_)
- **Validate:** `npx vitest run test/i18n.test.js`

### n-1. UPDATE `.claude/ARCHITECTURE_MAP.md` (only if a module was added or a responsibility moved)

- **Validate:** the row names a file that exists

### n. Turn Phase R green

- **Validate:** every Phase R command passes

## Validation commands

```bash
npm run format:check && npm run lint && npm run typecheck
npm test
npm run build
npm run test:e2e
```

Plus each Phase R command above, and `/verify` for verify ACs.

## Open questions / assumptions

Each has a default the loop uses if the reviewer approves without overriding it.

1. <question> — **Default:** <what the plan assumes>

## Notes

<free-form reasoning: alternatives rejected and why, risks, sequencing>

## AMENDMENTS

Append-only. Every change to this plan or to a frozen acceptance test after the
red commit goes here: date — what changed — why.

- (none)

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

## Execution report

Filled by `/system-execution-report`.
