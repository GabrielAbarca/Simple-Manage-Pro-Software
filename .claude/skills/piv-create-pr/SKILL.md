---
name: piv-create-pr
description: "Pushes the ticket branch and opens a pull request to main whose body is filled from the plan (suite results, per-acceptance-criterion table, deviations, follow-ups, manual Supabase steps, Fixes #N), then reads it back and strips any appended attribution. Use after /piv-commit when a ticket's work is complete, or with --draft when the loop halted."
argument-hint: "[--draft] [#ticket]"
---

# Create PR: push, open, verify the body

**Input**: $ARGUMENTS. `--draft` opens a draft (the loop halted); `#N` names the
ticket if it can't be inferred.

This is the ship step. The loop ends at an open PR, and **the human reviews and
merges**. Read the `## pr` and `## github` sections of
`.claude/references/conventions.md` first. They override this file.

## 1. Check the git state

```bash
git fetch origin main
git branch --show-current
git status --short
git log origin/main..HEAD --oneline
```

| State                                                                                                                                                            | Action                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| On `main` / `development`                                                                                                                                        | STOP: the work must be on a ticket branch.                                                                                    |
| Uncommitted changes                                                                                                                                              | STOP: run `/piv-commit` first.                                                                                                |
| No commits ahead of `origin/main`                                                                                                                                | STOP: nothing to open.                                                                                                        |
| Branch name breaks the rule in conventions (section branch)                                                                                                      | STOP and report. Never open a PR from a misnamed branch.                                                                      |
| Author of any commit is not Gabriel Zelaya, or any commit has a trailer (`git log origin/main..HEAD --format='%an <%ae>%n%b'`)                                   | STOP. Unpushed: fix with `--reset-author`. Already pushed: halt and ask the owner (needs a force-push).                       |
| An open PR already exists for this branch (`mcp__github__list_pull_requests`, `head: "GabrielAbarca:<branch>"`, `state: open`, and `head.ref` equals the branch) | Resuming a halted run: update that PR's body (and set `draft: false` when no halt remains). Otherwise STOP and print its URL. |

## 2. Gather the body

- **Ticket:** `#N` from the argument, the plan filename
  (`.claude/plans/<N>-<slug>.md`), or the plan's `**Implements:**` line.
- **Plan:** its `## Validation` section (the suite table, the per-AC table, and
  every `### Review (round n)` subsection with the acceptance validator's table
  and the Fixed / Not in this change / Needs your decision / Won't fix lines),
  `## AMENDMENTS` (the Deviations section), `## Manual Supabase steps`, and the
  `## Execution report`. The "Independent probe" column comes from the last
  round's validator table.
- **Template:** `.github/pull_request_template.md`. Fill every section; write
  "None." rather than deleting one.
- **Commits and files:** `git log origin/main..HEAD --format='- %s'`,
  `git diff --stat origin/main...HEAD`.
- **Epic docs PR** (no ticket, no plan: the branch only adds
  `docs/epics/<slug>/`): Summary = the PRD's hypothesis plus the chosen approach,
  Changes = the two docs, every other section "None.", and no `Fixes` line.

Title: the ticket's title in imperative history style (it becomes the squash
commit, and GitHub appends `(#NN)`). No prefix, no issue number.

The body never mentions Claude, AI, agents or sessions. Describe what the code
does and how it was validated.

## 3. Push and open

```bash
git push -u origin "$(git branch --show-current)"
```

Retry a network failure up to 4 times with backoff (2s, 4s, 8s, 16s). Then open
the PR with `mcp__github__create_pull_request` (owner `GabrielAbarca`, repo
`Simple-Manage-Pro-Software`, base `main`, head = branch, `draft` when `--draft`).
Locally without the MCP tools: `gh pr create --base main --title … --body-file …`.

## 4. Read it back

Fetch the PR (`mcp__github__pull_request_read`, method `get`). If the body
gained anything you didn't write (an attribution line, a session link, a robot
emoji), rewrite it without them with `mcp__github__update_pull_request`. Confirm
`Fixes #N` is present for a ticket PR (an epic docs PR has none).

In a cloud session, subscribe to the PR with
`mcp__claude-code-remote__subscribe_pr_activity` (when that tool exists), so CI
results and review comments wake the session.

## Output

PR number and URL, base ← head, draft or ready, and:

> Ready for review. Run `/piv-review-pr <number>` in a fresh session for an
> independent pass, then review and merge.

Don't poll CI or wait for reviews. Handle CI results and review comments when
they arrive as events.
