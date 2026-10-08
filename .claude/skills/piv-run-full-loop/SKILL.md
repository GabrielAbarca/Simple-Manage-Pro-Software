---
name: piv-run-full-loop
description: Runs one Simple Manage Pro ticket through the whole inner loop — preflight, branch, prime, plan with failing checks, the human approval gate, then unattended implement, validate, fresh-context review, fixes, execution report, and PR. Resumable from any point; bugs route through the investigate lane. Use with a ticket number (or a free-form request) to take it from idea to an open PR; this is what /piv-run-epic starts in each session.
argument-hint: "[#ticket | free-form description] (blank = resume the current branch)"
---

# Run the full loop for one ticket

**Input**: $ARGUMENTS

```
A  preflight → branch → prime → plan + Phase R (red, committed, pushed)
   ══ GATE 1: the human approves the plan and its red evidence ══
B  implement → validate → review (fresh contexts) → fix (≤2 rounds) → execution report → PR
   ══ GATE 2: the human reviews and merges ══
```

The human is needed exactly twice. Everything else runs unattended, and a
blocker halts the loop with a clear report rather than guessing.

Rules that apply at every step: `CLAUDE.md` and
`.claude/references/conventions.md`. GitHub calls use owner `GabrielAbarca`,
repo `Simple-Manage-Pro-Software`.

## 0. Work out where we are (always first)

This loop is a state machine, so it can be re-invoked after a gate, a restart
or a context compaction. Determine the state before doing anything:

1. Identify the ticket: from `$ARGUMENTS`; else from the plan whose
   `**Branch:**` matches the current branch (`grep -l "**Branch:** $(git branch --show-current)" .claude/plans/*.md`);
   else ask.
2. Fetch the ticket's branch if it exists remotely
   (`git fetch origin <Branch>`) and check it out.
3. Read the state:

| Evidence                                                     | State        | Go to                                                         |
| ------------------------------------------------------------ | ------------ | ------------------------------------------------------------- |
| No plan file for the ticket on its branch                    | **New**      | A1                                                            |
| Plan `Status: Draft`, red commit present                     | **At gate**  | A5                                                            |
| Plan `Status: Approved`, no commit after the approval commit | **Approved** | B1                                                            |
| Implementation commits after approval, no PR                 | **Built**    | B2 (re-validate, then continue)                               |
| Open PR for the branch                                       | **Shipped**  | Report its URL; handle any CI or review event per the harness |
| Ticket closed                                                | **Done**     | Report and stop                                               |

Say which state you found and why, in one line, then continue.

## A1. Preflight

- Identity: `git config user.name && git config user.email` must print the
  owner's (see `.claude/references/conventions.md`, section commit). Fix it if
  not.
- `git fetch origin main`; working tree clean.
- Ticket (`mcp__github__issue_read`, method `get`): open; parse the field lines
  (`.claude/references/ticket-template.md`).
  - Labelled `bug` → this is the **bug lane**: A4 uses
    `/piv-investigate-issue #N` instead of the plan skill.
  - `**Depends on:**`: every listed issue must be closed by a merged PR (the
    `get` result's `closed_by_pull_requests`). Otherwise **stop**: "#N waits
    on #X". Branches are cut from `main`, so a dependency has to be merged first.
  - Already has an open PR → state Shipped.
  - `**Supabase:** yes` → warn: this run will hit the owner-approval prompts
    and must be attended.
- Add the `in-progress` label (`mcp__github__issue_write`, method `update`,
  keeping the existing labels) if `/piv-run-epic` hasn't already.

Free-form input (no ticket): skip the issue steps. Derive a branch name and
slug from the description, and write the acceptance checks into the plan
yourself.

## A2. Branch

Use the ticket's `**Branch:**` (it must pass the regex in conventions, section
branch). If the session started on a different branch, including a
pre-assigned `claude/…` or hash-suffixed one, create the correct branch anyway
and never push the other:

```bash
git checkout <Branch> 2>/dev/null || git checkout -b <Branch> origin/main
```

## A3. Prime

Run the prime named in `**Prime:**`: `/prime-frontend`, `/prime-backend`, or
`/prime-codebase` for `both`. Pass `#N`.

## A4. Plan and prove red

Run `/piv-plan-implementation #N` (bug lane: `/piv-investigate-issue #N`). It
asks only blocking questions, writes the plan, writes the acceptance tests,
proves them red, commits `Add failing checks for <title>`, and pushes.

If Phase R can't reach a valid red for every check (a check passes before the
change, or a failure stays an import error), **halt here** and report it. The
ticket or its checks need a human.

## A5. GATE 1: plan approval

Present, briefly:

- plan path and branch; the approach in 3–5 lines; the inherited epic
  decisions it relies on;
- the Phase R table with each red line;
- Open questions with their defaults;
- confidence and the main risks;
- for the bug lane: root cause, its evidence chain, and the confidence level.

Then ask with AskUserQuestion: **"Approve the plan for #N?"**

- **Approve (Recommended)**: defaults stand.
- **Approve with overrides**: the user types the overrides.
- **Revise**: the user says what to change.
- **Stop**: park the ticket.

On **Approve** or **Approve with overrides**:

1. Record each override under Open questions as `Resolved: <answer>`.
2. An override that changes an acceptance criterion means re-running Phase R for
   that criterion before approving: update the test, prove it red, and commit
   it again with the same subject `Add failing checks for <title>`. The newest
   such commit is the freeze point.
3. Set `**Status:** Approved <YYYY-MM-DD>` and fill `**Red commit:**` with
   the short sha of the newest `Add failing checks for` commit.
4. `/piv-commit` with subject `Approve the plan for <title>`, then `git push`.

On **Revise**: apply the feedback to the plan (and Phase R if checks change),
commit, push, and return to A5.

On **Stop**: push what exists, remove the `in-progress` label, and report how
to resume (`/piv-run-full-loop #N`).

## B. Unattended, after approval

From here on, don't ask the human anything. Work through each step, and
**halt** (B7) only for the reasons listed there.

**B1. Implement.** `/piv-implement <plan>` (bug lane: `/piv-implement-issue #N`).
It walks the tasks, turns Phase R green, and commits.

**B2. Validate.** `/piv-validate <plan>` must be PASS. If it isn't, fix it
(within the plan, recording amendments) and validate again. If it can't
reach PASS, halt.

**B3. Review.** `/piv-review-changes #N`. That's code-reviewer and
acceptance-validator in parallel, in fresh contexts.

**B4. Fix.** If there are findings,
`/piv-fix-review-findings <review file> --unattended`, then B3 again. Two review
rounds at most.

**B5. Reflect.** `/system-execution-report <plan>`, then `/piv-commit`
(`Record validation and execution notes for <title>`).

**B6. Ship.** `/piv-create-pr #N`. It opens ready, or as a draft when halted.

**B7. Halt rules.** Open the PR as a **draft** (or stop before the PR if
nothing is worth showing) with the reason under "Needs your decision" when:

- validation can't reach PASS;
- after two review rounds an acceptance FAIL or UNPROVEN, or a Critical finding,
  is still open;
- the Supabase guard asked and the owner declined or didn't answer;
- the fix needs a change to a frozen acceptance test, a product decision, or
  breaking an epic decision.

## Final report

```
#<N> <title> — <state reached>
Branch: <branch> · PR: <url> (ready | draft)
Acceptance: AC1 ✅ AC2 ✅ … (independent validator: PASS)
Validation: format ✅ lint ✅ types ✅ unit ✅ build ✅ e2e ✅
Needs your decision: <items or "nothing">
Next: review and merge the PR (optionally `/piv-review-pr <number>` in a fresh session first)
```

After the PR exists, don't poll. CI results and review comments arrive as
events in this session; handle them with `/piv-validate`, a fix, `/piv-commit`,
and `git push` on the same branch.
