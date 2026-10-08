---
name: system-execution-report
description: Reflects on a just-finished Simple Manage Pro ticket while the context is fresh — what was built, how it diverged from the plan and why, what was hard, what was skipped, and what the skills or CLAUDE.md should learn — and appends it to the ticket's committed plan as the Execution report. Run inside /piv-run-full-loop before the PR; the raw material for /system-evolution-review.
argument-hint: "[path to .claude/plans/<N>-<slug>.md] (blank = plan for the current branch)"
---

# Execution report: what really happened, while it's fresh

**Plan**: $ARGUMENTS, or the plan whose `**Branch:**` matches the current branch.

This is a reflection on the **process**, not the code. It's written by the
session that did the work, because only it knows where the plan fell short.
It's appended to the plan file, which is committed with the PR, so the
learning outlives the container.

## Gather

```bash
git log --format='%h %s' origin/main..HEAD
git diff --stat origin/main...HEAD
```

Plus the plan's Phase R table, AMENDMENTS, Validation and Review sections, and
the review file in `.claude/code-reviews/` if one exists.

## Write

Fill the plan's `## Execution report` section:

```markdown
## Execution report

**Files:** +<added> ~<modified> −<deleted> · **Lines:** +<x> −<y> · **Review rounds:** <n> · **Outcome:** ready PR | draft (reason)

### Validation summary

format ✅ · lint ✅ · types ✅ · unit ✅ (<n>) · build ✅ · e2e ✅ (<n>) · acceptance validator: PASS | …

### What went well

- <specific: a pattern reference that saved time, a check that caught a real bug>

### Divergences from the plan

For each AMENDMENTS entry and anything else that differed:

- **<title>** — planned: <…> · actual: <…> · why: <…> ·
  type: better approach found | plan assumption wrong | missing context | security or performance | other

### Challenges

- <what was hard and why>: flaky selector, fixture gap, demo overlay surprise, import cycle, …

### Skipped

- <planned item not done> — <why>

### Recommendations

- **Plan skill:** <an instruction that would have prevented a divergence>
- **Implement / validate / review skills:** <…>
- **References** (conventions, ladder, rubric, ticket template): <…>
- **CLAUDE.md / ARCHITECTURE_MAP:** <a durable rule or a stale fact found>
- **Ticket slicing:** <was the ticket the right size, and were its checks right?>
```

Be specific. "The plan was unclear" is useless. "The plan didn't say
`routeSupabase` needs an `ilike` filter for the search box" is a fix someone
can make. Write "None." under a heading rather than inventing content.

## Commit

Leave the commit to the caller. Inside `/piv-run-full-loop` it's committed as
`Record validation and execution notes for <title>`. Run standalone, commit it
with `/piv-commit`.

## Output

The plan path, and the 1–3 recommendations most worth acting on.
