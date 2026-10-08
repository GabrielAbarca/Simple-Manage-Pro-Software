---
name: piv-slice-epic
description: Slices a Simple Manage Pro epic (its merged PRD and architecture) into one-testable-concern tickets with acceptance checks written validation-first, branch names, dependencies and Supabase flags, shows the breakdown and dependency waves for confirmation, then creates the epic issue and each ticket as a native GitHub sub-issue. Use after the epic's docs PR is merged, before /piv-run-epic.
argument-hint: "[docs/epics/<slug> | path to prd.md or architecture.md]"
---

# Slice an epic into PIV-sized tickets

**Input**: $ARGUMENTS, the epic folder (`docs/epics/<slug>`) or one of its files.

Tickets are the bridge between the epic docs and the inner loop. Each one
must be planned, proven and reviewed in **one** unattended loop, from its own
body plus the epic docs, by a session that has never seen this conversation.

## 1. Preconditions

```bash
git fetch origin main
git cat-file -e origin/main:docs/epics/<slug>/prd.md && git cat-file -e origin/main:docs/epics/<slug>/architecture.md && echo merged
```

Both docs must be **on `origin/main`**. Ticket branches are cut from `main`, and
every plan reads the docs from there. If they aren't merged yet, stop: "merge the
epic's docs PR first."

## 2. Read and orient

- The PRD and the architecture doc in full: the MVP, decisions, demo and
  Supabase impact, validation strategy, missing pieces, spikes.
- `.claude/references/ticket-template.md` (the exact output format) and
  `.claude/references/validation-ladder.md` (check kinds).
- Enough of the code to judge overlap and independence. Run `/prime-codebase` if
  this session isn't oriented; then read the seams the architecture names.

## 3. Decompose

Size tickets for an agent loop, not a human backlog: a small-to-medium vertical
slice sized S, M or L as the ticket template defines them (up to ~1,500 lines
including tests). Each ticket:

- is **one testable concern** a user can observe, provable with 2–5 acceptance
  checks;
- has acceptance checks **written before any code exists**, each naming its kind
  (`unit`, `e2e`, `verify`, `guard`), its file, and its exact test name. Prefer
  `e2e` for anything a user does and `unit` for rules and calculations. Use
  `verify` only for purely visual criteria. Every e2e write path gets a `G` guard
  line;
- carries its own context: seams, a pattern to mirror, the ARCHITECTURE_MAP section,
  the epic doc sections;
- gets a **unique branch name** that follows `.claude/references/conventions.md`
  (section branch) and isn't already taken
  (`git ls-remote --heads origin <branch>` prints nothing, and no merged plan
  used it: `git grep -lF "**Branch:** <branch>" origin/main -- .claude/plans`
  prints nothing);
- is marked `**Supabase:** yes` if it needs any owner-approval item from the
  architecture doc; those run attended.

Prefer vertical slices ("teachers see X") over layers ("add the query for X").
A thin end-to-end first slice that a later ticket fattens is often the best first
wave. Spikes the architecture flagged become their own tickets, first.

## 4. Map dependencies and waves

- **Depends on** when one ticket needs another's merged code.
- **Conflict hotspots** count as overlap even without a logical dependency.
  Parallel branches that both edit these will conflict at merge: the same
  i18n area file, `.claude/ARCHITECTURE_MAP.md`, `e2e/fixtures.js`,
  `src/js/admin/nav.js`, the same screen module. Serialise tickets that share
  one (add a `Depends on`), unless the shared edit is trivially additive.
- **Waves:** wave 1 is everything with no dependencies; wave n+1 is what
  wave n unblocks. A dependent ticket is planned only after its dependency
  merges, so its plan reads real code rather than a guess.

## 5. Confirm before creating anything

Show:

1. a table: # · title · kind of change · checks (AC count by kind) · depends on ·
   Supabase · size · branch;
2. a mermaid graph of the dependencies with the waves;
3. the full body of the first ticket as a sample, with the rest available on
   request.

Ask with AskUserQuestion: **Create these issues / Revise / Cancel.** Creating
issues is outward-facing, so nothing is created without a yes.

## 6. Create

Use `mcp__github__issue_write` (owner `GabrielAbarca`, repo
`Simple-Manage-Pro-Software`):

1. **Epic issue** (`method: create`, labels `["epic"]`). Title: the epic title.
   Body: the hypothesis, the chosen approach in 3 lines, links to
   `docs/epics/<slug>/prd.md` and `architecture.md` on `main`, and a placeholder
   for the ticket table.
2. **Tickets, in dependency order** (so `Depends on` can name real numbers):
   `method: create`, `parent_issue_number: <epic>` (a native sub-issue), labels
   `["ticket"]` (add `"bug"` for a fix ticket), title = the concern in
   imperative history style, body = the template with `**Epic:** #<epic>`
   filled in.
3. **Update the epic body** (`method: update`) with the ticket table using the
   real numbers, the mermaid graph, and the waves.

If a label can't be applied, carry on without it and say so. Don't comment on
any issue.

## Output

The epic number and URL; a table of ticket number → title → wave → branch →
Supabase; the waves. Next:

> Dispatch wave 1: `/piv-run-epic #<epic>`. Supabase tickets are listed there to
> run attended with `/piv-run-full-loop #N`.

## Success criteria

- Every ticket is one testable concern with checks named down to the test name.
- No two parallel tickets share a conflict hotspot.
- Every ticket can be planned from its body plus the epic docs alone.
- Nothing was created before the owner confirmed.
