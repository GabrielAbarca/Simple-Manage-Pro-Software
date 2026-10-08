# Ticket (sub-issue) template

`/piv-slice-epic` writes every ticket in this exact shape, and
`.github/ISSUE_TEMPLATE/ticket.md` gives humans the same shape. The PIV skills
parse it, so keep the field lines and the acceptance-check line format as they
are.

## Parsing contract

- Field lines, one per line, at the top of the body:
  `**Epic:**`, `**Docs:**`, `**Branch:**`, `**Depends on:**`, `**Supabase:**`,
  `**Prime:**`.
- `**Depends on:**` is `none` or a comma-separated list of `#<issue>`.
- `**Supabase:**` is `no` or `yes`. `yes` means the ticket runs attended (see
  `.claude/references/conventions.md`, section supabase).
- `**Prime:**` is `frontend`, `backend` or `both`.
- Acceptance-check lines match
  `^- (AC|G)\d+ · (.+) · (unit|e2e|verify|guard) · (.+)$`. `AC` lines are
  acceptance criteria; `G` lines are standing guards. Kinds are defined in
  `.claude/references/validation-ladder.md`.
- The issue title is the ticket's concern in imperative history style
  (`Export the filtered students table as CSV`). It becomes the PR title.

## Body

```markdown
**Epic:** #<epic issue>
**Docs:** docs/epics/<slug>/prd.md · docs/epics/<slug>/architecture.md#<section>
**Branch:** <feat|fix|refactor|test|chore|docs>/<two-or-three-words>
**Depends on:** none
**Supabase:** no
**Prime:** frontend

## Concern

One user-visible behaviour in 2–3 sentences: who does what, and what they get.

## Acceptance checks

- AC1 · <observable behaviour, as given / when / then> · e2e · `e2e/<feature>.spec.js` › "<test name>"
- AC2 · <rule or edge case> · unit · `test/<module>.test.js` › "<test name>"
- AC3 · <visual-only criterion> · verify · "<portal · role · lang · viewport · steps · what must be seen>"
- G1 · No demo-mode write reaches Supabase · guard · AC1's spec ends with `expect(writes).toEqual([])` and no pageerror

## Context

- Seams: `<file>` (<why>) · `<file>` (<why>)
- Pattern to mirror: `<file>`
- ARCHITECTURE_MAP: <section › subsection>
- Size: S (<300 lines) | M (300–900) | L (900–1500), tests included

## Out of scope

- <the adjacent thing a reader might assume is included>
```

## A good ticket

- **One testable concern.** If you can't prove it with 2–5 acceptance checks,
  it's two tickets.
- **A vertical slice**, not a layer. "Teachers see X" rather than "add the query
  for X".
- **Checks you can write before the code.** Each AC names its test file and
  test name up front. That's what makes Phase R possible.
- **Carries its own context**, so a fresh session can plan it from the ticket
  and the epic docs alone.
