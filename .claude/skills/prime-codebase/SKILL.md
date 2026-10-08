---
name: prime-codebase
description: Orients the session in Simple Manage Pro before planning or implementing — project rules, the architecture map sections that matter, recent activity — anchored to a ticket when one is given. Use at the start of a session, before /plan-architecture or /piv-slice-epic, or when a ticket spans both frontend and backend. For a scoped ticket prefer /prime-frontend or /prime-backend.
argument-hint: "[#ticket] (blank = general orientation)"
---

# Prime: load only the context the work needs

**Input**: $ARGUMENTS, an optional ticket `#N`.

The aim is orientation, not a full audit. Load what the work needs and stop. A
ticket's `## Context` and `**Docs:**` lines say what that is.

## 0. Load the ticket (when given)

1. `mcp__github__issue_read` (method `get`, owner `GabrielAbarca`, repo
   `Simple-Manage-Pro-Software`) for `#N`: title, field lines, Concern,
   Acceptance checks, Context, Out of scope.
2. `mcp__github__issue_read` (method `get_parent`) to confirm the epic, then
   read the epic docs the `**Docs:**` line points to
   (`docs/epics/<slug>/prd.md`, `architecture.md`), only the sections named.

Summarise the ticket in three lines before going on. It frames everything else.

## 1. Project rules

- `CLAUDE.md`: hard rules, demo mode, commands.
- `.claude/references/conventions.md`: branch, commit, PR, GitHub, Supabase and
  code rules.
- `.claude/references/validation-ladder.md`: how work here is proved.

## 2. Architecture, scoped

Read `.claude/ARCHITECTURE_MAP.md` sections **Entry points**, **Directory
layout**, and the **Feature map** subsection that matches the work (Academic
structure, People, Teaching & assessment, Timetable, Cross-cutting). Read
**Import cycles** and **Conventions worth knowing** if the work touches
`src/js/admin/`. Read **Backend** if it touches data or `supabase/`.

With no ticket, read the whole map once.

## 3. The seams themselves

Read the files the ticket's Context names as seams and the "pattern to mirror"
file. Read one existing test next to them (`test/<module>.test.js` or the
matching `e2e/*.spec.js`) to see how that area is tested. Nothing else unless a
question comes up.

## 4. Current state

```bash
git branch --show-current
git status --short
git log -10 --oneline
```

## Output

Keep it short and scannable:

- **Ticket** (if any): number, title, one-line concern, its ACs and their check kinds.
- **Where it lands:** portal(s), entry controller, modules and data seams, with paths.
- **Rules that bite here:** demo-mode writes, i18n EN+ES (_usted_), JSDoc on
  logic-layer code, `errorHandler` first import, admin import cycles,
  `supabase/` requiring approval. Only the ones that apply.
- **How it's tested:** the test files and fixtures to extend.
- **State:** branch, uncommitted work, recent relevant commits.
- **Open questions** the context didn't answer.
