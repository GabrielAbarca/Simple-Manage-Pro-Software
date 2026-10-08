---
name: plan-create-prd
description: Interviews the owner into a problem-first PRD for the next Simple Manage Pro epic — who in the school has the problem, the evidence, why now, a falsifiable hypothesis, the thinnest MVP, outcome metrics, non-goals, open questions — and writes it to docs/epics/<slug>/prd.md on a docs branch. Intent only (what and why), never engineering; that's /plan-architecture. Use at the start of an epic.
argument-hint: "[epic idea] [optional: paths to evidence — feedback notes, QA lists, runbooks] (blank = start with questions)"
---

# Create PRD: intent, not instructions

**Input**: $ARGUMENTS

A PRD says **what** to build and **why**, in a form the team can challenge
before building and judge after shipping. **How** belongs to
`/plan-architecture`. SMP is a live product (Costa Rican schools, admin, teacher
and student portals, bilingual), so this is the **brownfield** case: the PRD
scopes the next epic ("the next sprint"), not a whole product.

## Your role

A sharp product manager: start from the **problem**, demand **evidence**,
think in **hypotheses**, and ask before assuming. **Anti-fluff rule:** never
invent plausible requirements. An unknown is written as
**"TBD — needs validation"**.

## Evidence first

Read whatever was passed, then the project's own signal:

- README `## 🗺️ Roadmap` (the open items), `QA-list.md`, `docs/ONBOARDING_RUNBOOK.md`
  (what a new school goes through), `docs/ACCOUNT_RECOVERY.md`, and any
  `docs/*FINDINGS*.md`;
- existing epics in `docs/epics/`, so this one doesn't overlap or contradict
  them;
- `.claude/ARCHITECTURE_MAP.md`, Feature map only, to know which features already exist.

Ask whether other evidence exists: feedback from school staff, support
messages, MEP requirements, usage data.

## Two hard guards

1. **The problem statement must not prescribe the solution.** If only one
   solution fits the statement you've written, you've written a spec. Reframe
   until more than one answer could fit.
2. **No engineering decisions.** No libraries, data model, RLS, file layout,
   testing approach or error handling. Those are `/plan-architecture`'s
   job. Write them down as questions for it instead.

## The interview

```
INITIATE → FOUNDATION → USERS → HYPOTHESIS → MVP & DOORS → GENERATE
```

Ask in **clusters**, then **gate**: post the cluster, end the turn, wait for the
answers. Never ask and answer in the same breath. Reflect thin answers back and
dig. If the owner says "just write it", do so, but name what you had to guess
and ship each guess as TBD.

1. **Initiate.** Restate the idea in two lines and confirm it. Blank input: "What
   do you want schools to be able to do that they can't today?" **Gate.**
2. **Foundation.** Who has the problem: admin, teacher, student, guardian, or
   school director? What's the observable pain? How do they cope today (paper,
   WhatsApp, a spreadsheet, the MEP system, another tool)? Why now? Would this
   beat how they cope today by enough that they'd switch? **Gate.**
3. **Users.** Primary user and the moment it happens (trigger and context).
   The job to be done ("When …, I want to …, so I can …"). Who it's explicitly
   **not** for. Constraints: MEP rules, school calendar, devices (phones in
   class), connectivity, Spanish-first copy (_usted_), privacy of minors'
   data. **Gate.**
4. **Hypothesis.** Write it with the owner:
   ```
   We believe [change] will cause [these users] to [do Y], resulting in [outcome].
   We'll know we're RIGHT if [leading signal] within [timeframe].
   We'll know we're WRONG if [counter-signal or guardrail moves].
   ```
   Don't ship it without a wrong condition. **Gate.**
5. **MVP and doors.** What's the thinnest end-to-end slice that proves or kills
   the hypothesis? Which parts are two-way doors (just build them), and which are one-way
   (data model, anything touching real student records or RLS)? One-way doors
   go to `/plan-architecture` flagged for a spike. **Gate.**

## Generate

1. Branch for the epic's docs (hard rule 1, `.claude/references/conventions.md`,
   section branch): `git fetch origin main && git checkout -b docs/<two-or-three-words> origin/main`.
2. Write `docs/epics/<kebab-slug>/prd.md` (the slug comes from the epic idea;
   never overwrite another epic's folder):

```markdown
# <Epic title> — PRD

**Status:** Draft · **Owner:** Gabriel Zelaya · **Date:** <YYYY-MM-DD>

## Problem statement

## Evidence (quote, data or observation, or "Assumption — validate via …")

## Thesis (why this, why now, why it beats the current workaround)

## Hypothesis (the RIGHT / WRONG block)

## Users and job to be done (primary user, trigger, JTBD, non-users)

## MVP (the thinnest end-to-end slice)

## Success metrics (metric · target · how measured; outcome-shaped, not "engagement")

## Non-goals

## Open questions (checkboxes, including the engineering questions handed to /plan-architecture)
```

3. Commit it with `/piv-commit` (for example `Add the PRD for <epic>`). Don't open a PR
   yet: the architecture doc joins it first.

## Output

The file path. A 3–5 line summary that leads with the thesis and the
hypothesis. What's evidenced and what's assumed. The open-question count.
Next: **`/plan-architecture docs/epics/<slug>/prd.md`**.

## The tests of a good PRD

- The problem is grounded in evidence, not "users want X".
- The hypothesis has separate RIGHT and WRONG conditions.
- The metrics are specific and outcome-shaped.
- There are explicit non-goals.
- Open questions are named, not hidden.
- There are no engineering decisions.
