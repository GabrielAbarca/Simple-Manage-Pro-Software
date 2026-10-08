---
name: piv-review-changes
description: Pre-PR review of a Simple Manage Pro ticket branch in fresh contexts — dispatches the code-reviewer agent and the acceptance-validator agent in parallel on the committed diff, cross-checks frozen-test changes against the plan's amendments, verifies findings, and writes one severity-ranked review. Use after /piv-implement and /piv-validate, before /piv-commit of fixes and /piv-create-pr.
argument-hint: "[#ticket] [base ref, default origin/main]"
---

# Review changes: two fresh pairs of eyes before the PR

**Input**: $ARGUMENTS, a ticket `#N` (inferred from the plan for this branch if
blank) and an optional base ref (default `origin/main`).

The author's context explains away its own mistakes. So the review is done by
two agents that start clean: `code-reviewer` judges the code against the
project's standards, and `acceptance-validator` judges each acceptance
criterion from the ticket and the code alone.

## 1. Preconditions

```bash
git fetch origin main
git status --porcelain     # must be empty: the review is of committed work
git log --oneline origin/main..HEAD
```

Uncommitted work: commit it first (`/piv-commit`). The validator's coupling
proof needs a clean tree.

## 2. Dispatch both agents in parallel

Send one message with two Agent calls:

- **`code-reviewer`**, prompt: "Review `origin/main...HEAD` on branch
  `<branch>` for ticket #N. The plan is `<plan path>`; read only its
  AMENDMENTS section. Return findings in the rubric format." For a
  `**Supabase:** yes` ticket, add: "Supabase: yes. Owner-approved items:
  <the plan's owner-approval tasks and its Manual Supabase steps>." Changes
  under `supabase/` beyond those items are still Critical.
- **`acceptance-validator`**, prompt: "Validate ticket #N against
  `origin/main...HEAD`." Nothing else: **don't** describe the plan, the
  approach, the files touched, or what you expect. If there's no ticket, or
  the ticket has no `## Acceptance checks` lines, pass the plan's Phase R
  lines verbatim instead, written in the ticket format
  (`- ACn · behaviour · kind · where`), and only those.

## 3. Merge and verify

- **Validator verdicts:** every FAIL and UNPROVEN becomes a finding, Critical
  if the AC's behaviour is missing and High if the evidence is missing.
- **Frozen tests:** for each AC the validator reports as `changed`, find a
  matching entry in the plan's AMENDMENTS. No match means a High finding
  ("acceptance test changed without an amendment").
- **Reviewer findings:** before keeping one, confirm it yourself at
  `file:line` (or with a narrow command). Drop anything you can't confirm.
  Downgrade anything that's a documented amendment.
- Deduplicate.

## 4. Write the review

Save to `.claude/code-reviews/<N>-<slug>.md` (gitignored):

```markdown
# Review — #<N> <title> (<branch> @ <sha>)

**Verdict:** clean | fix before PR | blocked
**Acceptance:** PASS | FAIL (<ids>) | UNPROVEN (<ids>)

## Findings

| #   | Severity | File:line | Issue | Fix |
| --- | -------- | --------- | ----- | --- |

## Acceptance table

<the validator's table, verbatim>

## Done well

- …
```

## 5. Record the round in the plan

The review file is gitignored and the container won't last, so the evidence
goes into the committed plan. Append to the plan's `## Validation` section:

```markdown
### Review (round <n>)

**Verdict:** … · **Acceptance:** …
<the validator's table, verbatim>
Findings: <count by severity, one line each with file:line>
```

Then `/piv-commit` (`Record review round <n> for <title>`). The tree is
clean again for the next step.

## Output

Print the verdict, the counts by severity, the acceptance line, and the file
path. Next:

- findings exist → `/piv-fix-review-findings .claude/code-reviews/<N>-<slug>.md`
  (rounds and halts: `.claude/references/conventions.md`, section loop);
- clean → `/system-execution-report`, `/piv-commit`, then `/piv-create-pr`.

Nothing is posted to GitHub (`.claude/references/conventions.md`, section github).
