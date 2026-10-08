---
name: system-evolution-review
description: Finds the bugs in Simple Manage Pro's development process rather than its code — reads the committed plans and execution reports of recent tickets (or one epic) plus their merged PR bodies, scores plan adherence, classifies divergence patterns, and proposes exact edits to the skills, references, ticket template and CLAUDE.md, applied through a chore PR once the owner approves. Run after each epic or every ~5 merged tickets.
argument-hint: "[epic #E | last N | since YYYY-MM-DD] (default: since the last review)"
---

# Evolution review: improve the system that builds the code

**Scope**: $ARGUMENTS. With no scope, it covers everything merged since the newest
review in `.claude/system-reviews/`.

**This isn't a code review.** It looks for repeated causes in how work was
planned, built, validated and reviewed, and changes the process so they stop
recurring:

- a **good divergence** (the plan was wrong, the implementer found better)
  means improve planning;
- a **bad divergence** (a constraint ignored, a pattern reinvented) means improve
  context or rules;
- a **repeated manual step** means a new check, hook or skill.

## 1. Collect

- **The tickets in scope.** For an epic, `mcp__github__issue_read` with
  `get_sub_issues` on #E, filtered to closed ones. Otherwise use merged PRs (`mcp__github__list_pull_requests`,
  state closed, base `main`), filtered by date or count.
- **For each ticket:** its plan on `main` (`.claude/plans/<N>-*.md`), which
  includes Phase R, AMENDMENTS, Validation, Review and the Execution report,
  and the merged PR's body (`mcp__github__pull_request_read`). Note anything the
  human changed after the PR opened (extra commits, review comments): those are
  the gaps the loop didn't catch.
- **The current process:** the skills under `.claude/skills/` (piv-_, plan-_,
  prime-*), `.claude/references/*.md`, `.claude/agents/*.md`, `CLAUDE.md`.

## 2. Analyse

For each ticket, score plan adherence from 1 to 10 (10 = every divergence
justified). Across tickets, look for:

- **Divergence patterns:** the same kind of amendment more than once (for example
  "plan named a helper that doesn't exist", "fixture missing a filter").
- **Validation gaps:** bugs the human or CI found after the PR opened, which the
  ladder or the validator should have caught. Which rung would have caught it?
- **Acceptance-check quality:** checks that were invalid red, rewritten under
  amendment, or UNPROVEN, which points to ticket-slicing or Phase R guidance.
- **Gate friction:** plans revised at the gate (what was missing?) and halts
  (what blocked?).
- **Stale rules:** CLAUDE.md, ARCHITECTURE_MAP or reference statements that
  proved false.
- **Repeated manual steps:** candidates for a script, a hook or a new skill.

One-off issues aren't actionable. Report patterns, each with its evidence
(ticket numbers).

## 3. Propose exact edits

For each pattern, the smallest edit that would have prevented it, written out in
full: file, section, the text to add or replace. Prefer sharpening an existing
instruction to adding a new one; the AI layer should stay lean. A wrong rule is
worse than a missing one.

## 4. Report, then apply with approval

Write `.claude/system-reviews/<YYYY-MM-DD>.md`:

```markdown
# Evolution review — <date> (<scope>)

## Tickets reviewed

| # | Title | Adherence | Rounds | Outcome | Notes |

## Patterns

### <pattern> — seen in #a, #b, #c

Root cause: unclear plan | missing context | missing validation | stale rule | manual repetition
Evidence: …
Proposed edit: `<file>` § <section> — <exact text>

## What worked (keep doing)

## Proposed edits — summary
```

Show the patterns and proposed edits, then ask with AskUserQuestion which to
apply. On approval: create a branch `chore/<two-or-three-words>` off
`origin/main`, apply the approved edits plus the review file, run `npm test`
(the AI-layer structure suite in `test/claudeSkills.test.js` must stay green),
then `/piv-commit` and `/piv-create-pr`. The owner merges, and the next
tickets run on the improved process.

## Output

Tickets reviewed, average adherence, the top 3 patterns with their proposed
edits, and the PR link if any were applied.
