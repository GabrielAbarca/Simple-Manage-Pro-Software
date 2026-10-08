---
name: Ticket
about: One testable concern of an epic, ready for /piv-run-full-loop
title: ""
labels: ticket
---

**Epic:** #
**Docs:** docs/epics/<slug>/prd.md · docs/epics/<slug>/architecture.md#<section>
**Branch:** feat/<two-or-three-words>
**Depends on:** none
**Supabase:** no
**Prime:** frontend

## Concern

One user-visible behaviour in 2–3 sentences: who does what, and what they get.

## Acceptance checks

<!-- One line each: id · behaviour · kind (unit | e2e | verify | guard) · where.
     Every AC needs a unit, e2e or verify check, named down to the test name.
     See .claude/references/ticket-template.md and .claude/references/validation-ladder.md. -->

- AC1 · <observable behaviour> · e2e · `e2e/<feature>.spec.js` › "<test name>"
- AC2 · <rule or edge case> · unit · `test/<module>.test.js` › "<test name>"
- G1 · No demo-mode write reaches Supabase · guard · AC1's spec ends with `expect(writes).toEqual([])` and no pageerror

## Context

- Seams: `<file>` (<why>)
- Pattern to mirror: `<file>`
- ARCHITECTURE_MAP: <section › subsection>
- Size: S | M | L

## Out of scope

-
