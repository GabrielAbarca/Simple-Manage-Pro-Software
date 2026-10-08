---
name: piv-run-epic
description: Dispatches the ready tickets of a Simple Manage Pro epic — reads the epic's sub-issues, works out which are done, in flight, ready or blocked from their Depends-on lines and merged PRs, confirms the wave, claims each ready ticket and starts one cloud session per ticket running /piv-run-full-loop on its own branch. Re-run after merges to dispatch the next wave. Use after /piv-slice-epic.
argument-hint: "<#epic> [--max N] (default max 3 sessions)"
---

# Run an epic: one cloud session per ready ticket

**Input**: $ARGUMENTS, the epic issue number and optional `--max N` (default 3).

Independent tickets run at the same time, each in its own Claude Code cloud
session, on its own branch, with its own PR. Each session stops once, at its
plan gate, for the owner. This skill only dispatches; it never implements.

## 1. Read the epic

1. `mcp__github__issue_read` (owner `GabrielAbarca`, repo
   `Simple-Manage-Pro-Software`) with `get` on the epic: open, labelled `epic`.
   Read the docs links in its body.
2. Confirm the docs are on `main`:
   `git fetch origin main && git cat-file -e origin/main:docs/epics/<slug>/architecture.md`.
3. `get_sub_issues` on the epic (page through all of them). For each ticket,
   call `get` to read its body (the field lines from
   `.claude/references/ticket-template.md`), labels, state, and
   `closed_by_pull_requests`.

## 2. Classify every ticket

| Class         | Rule                                                                                            |
| ------------- | ----------------------------------------------------------------------------------------------- |
| **Done**      | Closed                                                                                          |
| **In flight** | Open with the `in-progress` label, or with an open PR from its branch                           |
| **Ready**     | Open, labelled `ticket`, not in flight, and every `**Depends on:**` issue closed by a merged PR |
| **Attended**  | Ready and `**Supabase:** yes`. It isn't dispatched unattended                                   |
| **Blocked**   | Anything else (name the open dependency)                                                        |

A dependency counts only once it's **merged**: tickets branch from `main`, so
unmerged work isn't there to build on.

## 3. Confirm the wave

Show the table (# · title · class · branch · waits on), how many sessions will
start (Ready, capped at `--max`), and the Attended list. Ask with
AskUserQuestion: **Dispatch these / Pick a subset / Cancel.**

## 4. Claim, then dispatch

For each ticket to dispatch, **in this order**:

1. **Claim it.** `mcp__github__issue_write` (`method: update`) adds `in-progress`
   to its existing labels. A ticket claimed before its session starts can never
   be dispatched twice.
2. **Start its session** with `mcp__claude-code-remote__create_session`:
   - `prompt`: `/piv-run-full-loop #<N>`
   - `title`: `#<N> <ticket title>`
   - `source_url`: `https://github.com/GabrielAbarca/Simple-Manage-Pro-Software`
   - `source_revision`: `main`
   - `outcome_branch`: the ticket's `**Branch:**`
   - `tags`: `["epic-<E>"]`
   - never `permission_mode: plan`, which would freeze the session waiting for an
     approval outside the loop's own gate.
3. Record the session id.

If a session fails to start, remove the claim (drop `in-progress`) and report
it. If `create_session` isn't available (a local CLI session), don't claim
anything. Print, for each ticket, the prompt to start in a new cloud session
(`claude --cloud "/piv-run-full-loop #<N>"`, or paste into claude.ai/code).

## 5. Report

```
Epic #<E> — <title>
Dispatched: #12 → session <id> (feat/students-csv-export), #14 → …
Attended (run yourself): #15 (Supabase: yes) → /piv-run-full-loop #15
Blocked: #13 waits on #12
Done: 3/8
```

Each dispatched session will stop at its **plan gate** and wait for the owner.
Open it in the Claude app, approve or revise, and it runs on to a PR.

**Next wave:** after merging PRs, run `/piv-run-epic #<E>` again.
**Epic complete** (every ticket done): run `/system-evolution-review epic #<E>`
to feed what this epic taught back into the skills.
