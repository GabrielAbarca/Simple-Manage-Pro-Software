---
name: piv-validate
description: Runs Simple Manage Pro's full validation ladder (format, lint, types, unit, build, e2e), then each acceptance check a plan or ticket names, plus the skip/only, entry-point-order and EN/ES-key checks, and returns one PASS/FAIL verdict. Use before committing, before opening a PR, after finishing a chunk of work, or whenever the loop says "validate".
argument-hint: "[plan path | #ticket] [--quick]"
---

# Validate: run every check SMP has, report one verdict

**Input**: $ARGUMENTS. Optional: a plan path (`.claude/plans/<N>-<slug>.md`) or a
ticket `#N` whose acceptance checks to run individually, and `--quick` to stop
after the unit rung.

This skill **reports; it never fixes**. Fixing is the caller's job
(`/piv-implement`, `/piv-fix-review-findings`). The commands and check kinds come
from `.claude/references/validation-ladder.md`.

Run the steps in order. **Keep going after a failure** so the report covers
everything, and capture the relevant output of anything that fails.

## 0. Preconditions

```bash
test -d node_modules || npm ci --no-audit --no-fund
git status --short
```

## 1. Static

```bash
npm run format:check
npm run lint
npm run typecheck
```

## 2. Unit

```bash
npm test
```

`--quick` stops here and reports.

## 3. Build

```bash
npm run build
```

## 4. E2E

```bash
npm run test:e2e
```

If it fails before any test body runs because the Chromium build is missing,
use the `playwright.local.config.js` fallback from
`.claude/references/validation-ladder.md` and re-run. That's an environment
fix, not a test result. Report which config you used.

## 5. Acceptance checks (when a plan or ticket was given)

Read the acceptance checks: from the plan's Phase R table, or from the
ticket's `## Acceptance checks` lines (`mcp__github__issue_read`, method
`get`). For each `unit` and `e2e` AC, run its own command and record ✅/❌:

```bash
npx vitest run test/<module>.test.js -t "<test name>"
npx playwright test e2e/<feature>.spec.js -g "<test name>"
```

For each `verify` AC, run `/verify` with the scenario the plan records under
that AC id, and record the evidence (screenshots and what they show). For
`guard` lines, confirm the assertion is present in the named spec.

## 6. Branch hygiene checks

```bash
# no skipped or focused tests added on this branch
git diff origin/main...HEAD -- test e2e | grep -nE '^\+.*(\.(skip|only|todo|fixme)\(|\bx(it|describe)\()' || echo "clean"
# errorHandler.js is still the first import of every entry point
for f in src/js/main.js src/js/teacher.js src/js/admin.js src/js/login.js; do
  head -20 "$f" | grep -m1 -E '^import ' | grep -q errorHandler || echo "errorHandler not first in $f"
done
# every new EN key has an ES twin (test/i18n.test.js enforces it; this names the files)
git diff --name-only origin/main...HEAD -- src/js/i18n
```

Also check that nothing under `supabase/` changed unless the ticket says
`**Supabase:** yes`: `git diff --name-only origin/main...HEAD -- supabase`.

## 7. Report

```
## Validation — <branch> @ <short sha>

| Check | Result | Notes |
|---|---|---|
| format:check | ✅ | |
| lint | ✅ | |
| typecheck | ✅ | |
| unit | ✅ 412 passed | |
| build | ✅ | |
| e2e | ✅ 58 passed | local config: no |
| AC1 (e2e) | ✅ | |
| AC2 (unit) | ❌ | expected 3, received 0 — test/x.test.js:41 |
| skip/only | ✅ clean | |
| entry-point order | ✅ | |
| supabase/ untouched | ✅ | |

**Overall: PASS | FAIL**
```

For every ❌, include the exact command and the few lines of output that show
the failure. Overall is PASS only if every row is ✅.

## Notes

- A checker that can't fail is worthless. If a step looks suspiciously green
  (zero tests collected, a filter that matched nothing), say so: `-t` and `-g`
  matching zero tests is a ❌, not a ✅.
- Don't widen or skip steps to save time. If e2e is slow, that's a finding to
  report, not a reason to drop it.
