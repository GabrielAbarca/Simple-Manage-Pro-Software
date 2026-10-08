# Epics

One folder per epic, created by the outer loop (see
[`docs/DEVELOPMENT_PROCESS.md`](../DEVELOPMENT_PROCESS.md)):

```
docs/epics/<kebab-slug>/
  prd.md           # what and why: problem, evidence, hypothesis, MVP, metrics, non-goals (/plan-create-prd)
  architecture.md  # how it lands: approach, data seams, demo mode, Supabase impact, validation strategy (/plan-architecture)
```

- The slug comes from the epic's idea (`guardian-portal`, `report-cards`), and
  the folder is never reused for another epic.
- Both files are merged to `main` through one docs PR **before** the epic is
  sliced. Every ticket's plan reads them from `main`.
- The tickets themselves live in GitHub, as sub-issues of the epic's `epic`
  issue. Each ticket's plan and execution report live in
  `.claude/plans/<issue>-<slug>.md`, committed with that ticket's PR.
- When a decision changes later, edit `architecture.md` in a PR and note the
  change at the top. Don't let the doc and the code drift apart.
