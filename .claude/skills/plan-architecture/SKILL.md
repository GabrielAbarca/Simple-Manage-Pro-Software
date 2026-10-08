---
name: plan-architecture
description: A working session that decides HOW a Simple Manage Pro epic lands in the existing system — portals and roles, data seams, demo-mode behaviour, Supabase impact (owner-approval items), i18n, validation strategy — by exploring the code, proposing 2–3 approaches with trade-offs, recommending one, and letting the owner decide. Writes docs/epics/<slug>/architecture.md and opens the epic's docs PR. High-level decisions, not a task plan.
argument-hint: "[docs/epics/<slug>/prd.md | free-form idea] [optional: reference docs]"
---

# Architecture: decide how the epic lands, then write it down

**Input**: $ARGUMENTS, normally the PRD from `/plan-create-prd`.

The PRD says **what** and **why**. This session makes the decisions an
engineering lead owns _before_ any ticket is planned: the approach, the data
shape, the boundaries, and what's risky enough to spike. It's **not** a
task list. If you catch yourself listing file edits, pull back up;
`/piv-plan-implementation` does that per ticket.

SMP is always **brownfield**: a vanilla JS (ES modules) multi-page Vite app, no
framework, Supabase (Postgres, RLS, Auth, Edge Functions), Vercel, bilingual.
Much of the architecture already _is_. The session decides only what goes on top.

## The session is the deliverable

```
investigate → 2–3 options with trade-offs → recommend, with reasons → ask → wait for the owner's call → go deeper
```

Never converge silently. Propose, don't dictate. Optimise for the owner's goals,
**familiarity** (no new framework or library without a strong reason; a new
dependency is an explicit decision), **leanness**, and **reversibility**. Spend the
thinking on one-way doors.

## 1. Read

- The PRD in full.
- `CLAUDE.md`, `.claude/references/conventions.md`,
  `.claude/references/validation-ladder.md`.
- `.claude/ARCHITECTURE_MAP.md`: Entry points, Directory layout, the Feature
  map subsections the epic touches, Shared vs single-portal modules, Import
  cycles, Conventions, Backend.
- The actual code at the seams: the screens and views involved, `adminData.js`
  and `admin/data.js`, `supabaseQueries.js`, `teacherData/`, `demoDb.js` and
  `adminDemoDb.js`, `role.js`. Use parallel Explore subagents for wide
  searches.
- If data is involved: `supabase/CLAUDE.md`, `supabase/schema/school_schema.sql`
  and the relevant `incremental_*.sql`, read-only.

## 2. Decide, with the owner

Work through these, recommending each time and asking for a decision. Skip
what doesn't apply, and say that you did:

- **Approach.** 2–3 genuinely different ways to land the epic (for example
  a new admin screen vs extending an existing one; a client-side computation vs
  an RPC; a new table vs columns on an existing one), with trade-offs.
- **Portals and roles.** Which portal(s), which role sees what, and how
  `role.js` and each portal's guard enforce it.
- **Data shape.** Entities and relationships at the model level. Reuse
  existing tables where possible.
- **Data seams.** Which gateway or query module carries the data, and how the
  **demo overlay** handles every new read and write. A demo write must never
  reach Supabase.
- **Supabase impact** (owner-approval items, hard rule 5): any schema, RLS,
  Auth or Edge Function change, written as the `incremental_*.sql` snippet it
  would become. Tickets that need these get `**Supabase:** yes` and run attended.
- **i18n.** The areas and namespaces new strings go into (both languages,
  _usted_).
- **Security and privacy.** Minors' data, RLS narrowing per role, escaping of
  imported or user text.
- **Validation strategy.** What proves the epic works: new e2e specs and
  fixtures (`routeSupabase` filters to extend), unit-testable logic to extract,
  where `verify` evidence is needed, and the mobile viewport.
- **Spikes.** For anything uncertain or expensive to undo:
  ```
  Question: … · Spike: smallest thing to try, timeboxed · Decision rule: go X if …, Y if …
  ```

## 3. Write it

On the epic's docs branch (created by `/plan-create-prd`; otherwise create
`docs/<two-or-three-words>` off `origin/main`), write
`docs/epics/<slug>/architecture.md`:

```markdown
# <Epic title> — Architecture

**Status:** Decided <YYYY-MM-DD> · **PRD:** ./prd.md

## Problem and goals (one paragraph from the PRD: the lens for every decision below)

## Approaches considered (2–3, trade-offs, and which one was chosen and why)

## Recommended approach (the shape of the solution and where it plugs into the existing system)

## Key decisions

- Portals and roles
- Data shape
- Data seams and demo-mode behaviour
- Supabase impact (owner approval): <none | the SQL snippets, by name>
- i18n areas
- Security and privacy
- Other (patterns, build vs buy)

## ARCHITECTURE_MAP rows to add (new modules and moved responsibilities)

## Validation strategy (specs and fixtures, unit seams, verify evidence, mobile)

## Missing pieces (what must exist first; often the real work)

## Spikes (each with its decision rule)

## Open questions (deferred decisions and what would settle each)
```

Keep it high-level: decisions and shapes, not file-by-file edits.

## 4. Open the docs PR

`/piv-commit` (for example `Add the architecture for <epic>`), then `/piv-create-pr`.
The PR body summarises the PRD's hypothesis and the chosen approach (no ticket
yet, so no `Fixes`). **The owner merges it**. Tickets are cut from `main`, so
`/piv-slice-epic` waits for the merge.

## After this

Summarise the approach and the key calls in a few lines, then offer:

- **Slice it:** after the docs PR merges, run `/piv-slice-epic docs/epics/<slug>`.
- **Spike first:** if a flagged risk blocks the slicing.
- **Small epic:** if it's really one ticket, run `/piv-slice-epic` anyway to get a
  well-formed ticket, then `/piv-run-full-loop #N`.

## Success criteria

- It ran as a conversation, and the owner chose among real options.
- Demo-mode behaviour and Supabase impact are explicit, even when the answer is "none".
- The validation strategy names concrete specs, fixtures and seams.
- One-way doors got a spike, not a guess.
- It stays high-level, with no task list.
