---
name: piv-review-pr
description: Independent review of an open Simple Manage Pro pull request in a fresh session — fetches the PR and its ticket, runs the full validation, dispatches the code-reviewer and acceptance-validator agents, and reports a severity-ranked verdict in the session only (nothing is posted to GitHub). Use before merging a PR the loop opened, or to review any PR a person wrote.
argument-hint: "<PR number | PR URL | branch>"
---

# Review PR: the last check before a human merges

**Input**: $ARGUMENTS.

Run this in a **new session**, not the one that wrote the code. A fresh context
is the whole point: it reviews what the PR does, not the reasoning behind it.
The verdict stays in this session (`.claude/references/conventions.md`,
section github). The human reads it, then reviews and merges on GitHub.

## 1. Fetch the PR

Resolve the input to a PR number. For a branch, use
`mcp__github__list_pull_requests` with `head: "GabrielAbarca:<branch>"` and
check `head.ref`. Then call
`mcp__github__pull_request_read` (owner `GabrielAbarca`, repo
`Simple-Manage-Pro-Software`) for the details (title, body, state, base, head,
changed files), the diff, and the check runs.

- `MERGED` / `CLOSED`: stop, there's nothing to review.
- Draft: review it, and read its "Needs your decision" section first. That's
  why it's a draft.

Check out the head locally:

```bash
git fetch origin <head> main
git checkout <head>
git status --porcelain     # must be clean
```

## 2. Load the bar

- `CLAUDE.md`, `.claude/references/review-rubric.md`,
  `.claude/references/validation-ladder.md`.
- The ticket from `Fixes #N` in the body (`mcp__github__issue_read`, method `get`),
  plus its epic docs sections.
- The plan (`.claude/plans/<N>-*.md`), **only** its AMENDMENTS and Validation
  sections. Documented amendments are intentional and aren't findings.
- A PR without a plan (written by a person): review it against the ticket, or
  against the PR's own description if there's no ticket.

## 3. Validate

Run `/piv-validate #N`. A red suite is itself a finding. Also note what the
CI check runs on the PR say.

## 4. Fresh-eyes review

Send one message that dispatches both agents in parallel:

- `code-reviewer`: "Review `origin/main...HEAD` (PR #<pr>, ticket #N). Plan
  amendments: `<plan path>`, AMENDMENTS section only."
- `acceptance-validator`: "Validate ticket #N against `origin/main...HEAD`."
  Pass only the ticket number. If there's no ticket, pass the PR's stated
  acceptance criteria verbatim.

Confirm each finding at `file:line` before keeping it, and drop what you can't
confirm. Cross-check every frozen-test change the validator reports against the
amendments.

## 5. Decide

| Recommendation | When                                                                                                                                      |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Merge**      | Validation PASS, acceptance PASS, no Critical or High finding                                                                             |
| **Fix first**  | Any High finding, a fixable validation failure, or an undocumented deviation                                                              |
| **Block**      | Any Critical finding (demo-write leak, XSS, unapproved Supabase change, secret), an acceptance FAIL, or the wrong approach for the ticket |

## Output (session only)

```markdown
# PR #<pr> — <title>

**Recommendation:** Merge | Fix first | Block
**Validation:** PASS/FAIL (table) · **CI:** <state> · **Acceptance:** PASS/FAIL/UNPROVEN

## Findings

| Severity | File:line | Issue | Fix |

## Acceptance

<the validator's table>

## Done well

- …
```

If there are findings, offer `/piv-fix-review-findings` with this report. Fixes
land as new commits on the PR branch (`/piv-commit`, then `git push`), and the PR
updates itself.
