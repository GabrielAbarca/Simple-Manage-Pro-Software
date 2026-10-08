---
name: piv-plan-implementation
description: Turns a Simple Manage Pro ticket (or a free-form request) into a one-pass implementation plan — inherits the epic's architecture, maps every acceptance criterion to a named test, writes those tests and proves them red, then commits plan and failing checks together for approval. Use when a ticket is ready to plan, before any code is written. The plan approval gate follows.
argument-hint: "[#ticket | free-form description]"
---

# Plan a ticket: context, then failing checks, then approval

**Input**: $ARGUMENTS, a ticket `#N` (or an issue URL), or a free-form
description.

**No `src/` code is written in this phase**, except STUBs (see Phase R). The
output is a plan rich enough that an unattended implementation succeeds on the
first pass, plus acceptance tests that already fail for the right reason. The
human approves both together.

## 1. Resolve the input

- **A ticket:** read it with `mcp__github__issue_read` (method `get`, owner
  `GabrielAbarca`, repo `Simple-Manage-Pro-Software`). Parse the field lines and
  acceptance checks (`.claude/references/ticket-template.md`). Read the parent
  (`get_parent`) and the epic docs the `**Docs:**` line names. Never plan from
  the bare number.
- **Free-form:** plan from the description. You write the acceptance checks
  yourself, in the ticket format, and they go in the plan's Phase R table.

**Inherit, don't re-decide.** The epic's `architecture.md` has already made the
cross-cutting calls: data shape, seams, demo behaviour, Supabase impact,
validation strategy. Treat them as settled. Plan only what's left at ticket
level. If the ticket truly has to break an epic decision, put it under Open
questions; don't diverge silently.

## 2. Be on the ticket branch

The plan commit has to land on the ticket's branch, so it rides into the PR.
If you're on `main` with a clean tree, create the branch now from the ticket's
`**Branch:**` field (or a derived name that passes the regex in
`.claude/references/conventions.md`, section branch):
`git fetch origin main && git checkout -b <branch> origin/main`.
Dirty tree on `main`: stop and ask.

## 3. Gather context

If the session isn't primed for this ticket, run the prime its `**Prime:**`
line names (`/prime-frontend`, `/prime-backend`, or `/prime-codebase` for
`both`). Then fill the gaps, using parallel Explore subagents for wide searches
so the noise stays out of this context:

- **Patterns to mirror:** the closest existing implementation. Extract real
  excerpts with `file:line`: module wiring, dialogs and tables, gateway calls and
  error handling, demo-overlay registration, i18n usage, JSDoc style.
- **Tests:** the nearest `test/*.test.js` and `e2e/*.spec.js`, the fixture set,
  and any `routeSupabase` filter the new screen will need.
- **Integration points:** files to update, files to create, nav and registration
  points, i18n areas, and `ARCHITECTURE_MAP.md` rows.
- **Constraints:** `.claude/references/conventions.md` (code, supabase) and the
  standing invariants in `.claude/references/validation-ladder.md`.

External research is rarely needed: no framework, few dependencies. Adding a
dependency is itself a decision for the owner, so it goes under Open
questions.

## 4. Clarify only what blocks

Analysis done, list what's genuinely open: scope edge, a choice between two
existing patterns, an unstated contract, failure behaviour, an AC that can't be
checked.

- **Blocking** (no sensible default, or the answer changes the ACs): ask now with
  AskUserQuestion. Keep it to 3–4 questions, each with a recommended option. Wait for
  the answers.
- **Everything else** goes to the plan's Open questions, **each with a stated
  default**, and the approval gate settles it. Never guess silently, and never
  invent questions to fill the list.

## 5. Write the plan

Copy `.claude/skills/piv-plan-implementation/templates/plan.md` to
`.claude/plans/<N>-<kebab-slug>.md` (free-form: `.claude/plans/<kebab-slug>.md`)
and fill every section. Status stays `Draft`. Requirements:

- Every task has an executable, non-interactive **Validate** command from the
  ladder (`npx vitest run …`, `npx playwright test … -g …`, `npx eslint <files>`,
  `npm run typecheck`) and a **Satisfies** line naming its AC.
- i18n keys (EN and ES, _usted_), JSDoc for logic-layer code, and the
  `ARCHITECTURE_MAP.md` row are explicit tasks, not afterthoughts.
- No task adds code comments (hard rule 6) or touches `supabase/` unless the
  ticket says `**Supabase:** yes` (then those tasks are marked "owner approval").
- Pattern references are specific (`file:line`), never "follow existing patterns".

## 6. Phase R: write the acceptance tests and prove them red

Follow "Phase R: proving red" in `.claude/references/validation-ladder.md`:

1. Write the STUBs the table lists (signature plus neutral return, nothing more).
2. Write each `unit` and `e2e` acceptance test exactly where the table says,
   with the exact test name. E2E write paths end with
   `expect(writes).toEqual([])` and a no-`pageerror` assertion (the guard line).
3. Run each AC's command. Classify every failure: **valid red** (an assertion
   or locator failure on the AC's element) or **invalid red** (import, syntax,
   reference or fixture error). Fix invalid reds in the _test or stub_, never by
   writing the feature, until every check is a valid red.
4. A check that passes before any implementation is wrong: either the behaviour
   already exists (tell the user; the ticket may be moot) or the test doesn't
   test it. Fix the test.
5. Record the red evidence lines in the plan.
6. If any AC's file, test name, kind or wording now differs from the ticket
   (or the ACs were written here for a hand-filed issue), update the ticket's
   `## Acceptance checks` lines to match
   (`.claude/references/conventions.md`, section github). The acceptance validator
   reads only the ticket.
7. Make sure existing tests still pass (`npm test`). The stubs must not break
   anything.

## 7. Commit and push

Run `/piv-commit` with the subject `Add failing checks for <ticket title>`,
staging the plan, the acceptance tests and the stubs only. That subject is how
every later step (and the acceptance validator) finds the red commit, so use it
exactly. Push with `git push -u origin <branch>`. The branch now holds the
frozen checks, so a lost container loses nothing. The commit's short sha goes
into the plan's `**Red commit:**` line when the plan is approved, in the same
commit as the status change.

## 8. Hand off to the gate

Report:

- plan path, branch, red commit;
- a 3–5 line summary of the approach and the inherited decisions it relies on;
- the Phase R table with each red line;
- Open questions with their defaults;
- complexity, key risks, and the confidence score.

When `/piv-run-full-loop` called this skill, it runs the approval gate. Run
standalone, end with: "Approve to implement (`/piv-run-full-loop #N` resumes
from here), or tell me what to change."

## Quality bar

- Someone new to the codebase could implement it from the plan alone.
- Every AC has a valid red recorded, and no check passed before the change.
- Tasks are in dependency order, each atomic and independently checkable.
- No reinvented helpers; every new pattern is justified.
- The confidence score is honest. Below 7, say what would raise it.
