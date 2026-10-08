---
name: piv-fix-review-findings
description: Triages review findings on a Simple Manage Pro branch and fixes the ones that belong in this change, each with a test, then re-validates and commits. Interactive by default; with --unattended (used by /piv-run-full-loop) it applies a fixed policy and routes the rest to the PR body. Use after /piv-review-changes or /piv-review-pr produced findings.
argument-hint: "[review file or pasted findings] [--unattended] [scope notes]"
arguments: [review, mode]
---

# Fix review findings: triage first, then fix what belongs here

**Review**: $review · **Mode/scope**: $mode

A review is input, not a work order. Read the whole review first, every
finding and the acceptance table, before changing anything.

## 1. Triage

Sort every finding into exactly one bucket:

| Bucket                  | Interactive mode                                         | `--unattended` policy                                                                                                 |
| ----------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Fix now**             | Ask the user, grouped by severity, with a recommendation | Every acceptance FAIL/UNPROVEN, every Critical and High, and Medium findings that are in the ticket's scope and small |
| **Not in this change**  | Ask                                                      | Low findings and anything outside the ticket's scope. Listed in the PR body, not fixed here                           |
| **Needs your decision** | Ask                                                      | Anything that needs a product call, a change to a frozen acceptance test, or anything under `supabase/`               |
| **Won't fix**           | Say why                                                  | A finding that doesn't reproduce or is already handled. Say why in the report                                         |

Don't let the reviewer widen the PR. "Real, but later" is a valid outcome.

## 2. Fix the "fix now" set, one at a time

For each finding:

1. State what's wrong, in one line.
2. Write or extend a test that fails because of it (a valid red, per
   `.claude/references/validation-ladder.md`) and run it.
3. Make the smallest fix that turns it green, following the plan's patterns and
   the conventions (no code comments, i18n in both languages, demo overlay).
4. Run the test again, then the task-level check (`npx vitest run …` or
   `npx playwright test … -g …`).

An acceptance UNPROVEN that's about missing evidence (a probe couldn't run, a
check wasn't coupled) is fixed by making the check prove it, not by
loosening anything. Frozen acceptance tests change only through an AMENDMENTS
entry in the plan, and in `--unattended` mode that's a "Needs your decision"
item, not a fix.

## 3. Record what the PR must carry

Add the outcome under the current round's `### Review (round n)` subsection in
the plan's `## Validation` (written by `/piv-review-changes`):

```
- Fixed: <finding> → <test that proves it>
- Not in this change: <finding> — <why it's out of scope>
- Needs your decision: <finding> — <the decision needed, with a recommendation>
- Won't fix: <finding> — <why>
```

`/piv-create-pr` copies these into the PR body. Nothing is posted to GitHub and
no issues are created. Follow-ups are for the owner to file.

## 4. Validate, then commit

Run `/piv-validate <plan path>`. It must be PASS. Then `/piv-commit` with a
subject that says what was fixed (for example
`Escape imported names before rendering the preview`), including the plan
update, so the tree is clean for the next review.

## 5. Rounds

`--unattended` follows the one definition in
`.claude/references/conventions.md` (section loop): every round's fixes are
re-reviewed, there are at most two fix rounds, and anything still open after
the final review (an acceptance FAIL or UNPROVEN, a Critical or High finding, or
a "Needs your decision" item) means the PR opens as a draft.

## Output

Fixed (each with its test), not in this change, needs your decision, won't fix,
the validation verdict, and the commit sha.
