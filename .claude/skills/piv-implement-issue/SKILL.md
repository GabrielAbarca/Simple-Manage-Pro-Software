---
name: piv-implement-issue
description: Implements the approved fix for a Simple Manage Pro bug from its RCA plan — checks the code hasn't drifted from the analysis, makes the minimal fix that turns the committed regression test green, guards sibling occurrences, validates and commits. The bug lane's implement step; the shared review and PR tail follows. Use after /piv-investigate-issue's plan is approved.
argument-hint: "<#issue>"
---

# Implement an issue fix: minimal change, regression test green

**Input**: $ARGUMENTS, the bug issue number. The plan is
`.claude/plans/<N>-*.md` on the current branch.

## Preconditions (stop if any fail)

- The plan exists, has `**Status:** Approved …`, and its `**Branch:**` is the
  current branch.
- `git status --short` is clean, and the `Add failing checks for` commit exists
  on this branch.

## 1. Read the RCA plan in full

Issue, assessment, root cause chain, fix strategy, Phase R, the approved Open
questions and overrides, AMENDMENTS.

## 2. Drift check

For each `file:line` the root cause cites, read the code now and compare it
to the evidence snippets. If the code changed materially (refactored, moved,
already fixed on `main`), **stop** and report the drift. The plan needs
re-approval, so suggest re-running `/piv-investigate-issue #N`. Never implement
a stale diagnosis.

## 3. Fix

- Implement the fix strategy: the **smallest** change that removes the root
  cause, in the surrounding code's style. No code comments (hard rule 6) and
  no unrelated refactors (hard rule 8).
- The same pattern elsewhere (siblings the RCA found): fix them only if the
  plan lists them. Otherwise note them for the PR's "Not in this change".
- Anything under `supabase/` is an owner-approval item. The guard hook asks in a
  Default-mode session and refuses in every other mode; if it refuses or the owner
  declines, stop. Once it's approved, list the SQL file and what it
  does under the plan's `## Manual Supabase steps`.
- A deviation from the strategy gets an AMENDMENTS entry (date, what, why).

## 4. Turn the regression test green

Run every Phase R command. All must pass. The regression test is frozen like
any acceptance test (`.claude/references/validation-ladder.md`): if it truly needs
to change, stop and let the owner decide (a halt), never edit it to pass.

Then run `/piv-validate <plan path>`. It must be PASS. Re-walk the issue's
reported steps (the reproduction from the RCA) and confirm the symptom is gone.

## 5. Record and commit

Fill the plan's `## Validation` section (the suite table, plus the regression
check: red before, green after). Then `/piv-commit` with a subject naming the
fix in history style (for example `Keep the today tab loading on first paint`).

## Output

Root cause (one line); files changed; the regression check red → green; the
validation verdict; amendments if any; siblings left for later. Next, the shared
tail: `/piv-review-changes #N`.
