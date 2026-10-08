---
name: piv-implement
description: Executes an approved Simple Manage Pro plan task by task, running each task's own validation before the next, until the acceptance checks committed red are green — without touching frozen tests except through a recorded amendment. Use after the plan is approved (Status Approved), on the ticket branch.
argument-hint: "[path to .claude/plans/<N>-<slug>.md]"
---

# Implement: walk the plan, one validated task at a time

**Plan**: $ARGUMENTS. If it's blank, use the plan whose `**Branch:**` matches the
current branch.

## Preconditions (stop if any fail)

```bash
git branch --show-current          # must equal the plan's **Branch:**
git status --short                 # must be clean
git log --format='%h %s' origin/main..HEAD | grep 'Add failing checks for'   # the red commit exists
```

- The plan's `**Status:**` must start with `Approved`. A Draft plan hasn't
  passed the gate: stop.
- This skill never creates branches. `/piv-run-full-loop` or
  `/piv-plan-implementation` already did.

## 1. Read everything first

Read the whole plan: Inherited decisions, Out of scope, Context references,
Patterns, the Phase R table, every task, Open questions with their **approved
defaults or overrides**, and AMENDMENTS. Read the context files it lists.

## 2. Execute the tasks in order

For each task:

1. Read the target file and the referenced pattern (`file:line`).
2. Implement exactly what the task says, in the codebase's existing style:
   JSDoc on logic-layer code, `t()` for every user-facing string, the demo
   overlay for every data path, no code comments (hard rule 6), nothing outside
   the ticket (hard rule 8).
3. Run the task's **Validate** command. The task isn't done until it passes.
   Fix it now rather than carrying a failure forward.

When the plan is wrong (a file doesn't exist, a pattern differs, a step is
impossible):

- make the smallest sound correction,
- append an `AMENDMENTS` entry: `<date> — <what changed> — <why>`,
- keep going. Stop and report only if the change would alter an acceptance
  criterion or an inherited epic decision; that needs the human.

## 3. Frozen tests

The acceptance tests from the red commit are frozen (anti-gaming rules in
`.claude/references/validation-ladder.md`). Don't edit them to make them pass.
If one is genuinely wrong (it tests something the AC doesn't say), the fix is
an AMENDMENTS entry that quotes the AC and explains the change, plus the minimal
test edit. The acceptance validator will check every such change against the
amendments. Non-acceptance tests you add for internal behaviour are fine to
write freely.

## 4. Turn Phase R green

Run every Phase R command. All must pass. Then run the full ladder with
`/piv-validate <plan path>`. Fix whatever it reports (in code, not in frozen
tests) and re-run until it's PASS.

## 5. Record

Fill the plan's `## Validation` section:

```
| Check | Result |
| format / lint / typecheck / unit / build / e2e | ✅ … |

| AC | Kind | Red before (from Phase R) | Green after |
| AC1 | e2e | locator "Export" not found | ✅ |
```

Commit the implementation with `/piv-commit`, subject = the ticket title in
history style (for example `Export the filtered students table as CSV`).

## Output

- Tasks completed (`ACTION path`), with any amendments listed.
- Validation verdict and the per-AC table.
- Anything a reviewer should know: risks, follow-ups noticed but left out of scope.
- Next: `/piv-review-changes`.
