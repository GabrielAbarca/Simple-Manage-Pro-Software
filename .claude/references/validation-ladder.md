# SMP validation ladder

Validation-first means you say how you'll prove a change works before you build it, and
a check counts only if it has been seen to fail. Every PIV skill uses this page
for its commands, check kinds and anti-gaming rules.

## The rungs, cheapest first

| #   | Rung                  | Command                                                                                                 | Proves                                                                                     |
| --- | --------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 1   | Format                | `npm run format:check`                                                                                  | Prettier-clean `src/**/*.{js,css}` and root `*.{js,json}`                                  |
| 2   | Lint                  | `npm run lint`                                                                                          | ESLint flat config, whole repo (including `.claude/hooks/`)                                |
| 3   | Types                 | `npm run typecheck`                                                                                     | `tsc` over the JSDoc-typed logic layer in `src/js/`                                        |
| 4   | Unit                  | `npm test` · one file: `npx vitest run test/<m>.test.js` · one case: add `-t "<test name>"`             | Logic in isolation (Vitest, node env, Supabase mocked)                                     |
| 5   | Build                 | `npm run build`                                                                                         | The four entry points bundle                                                               |
| 6   | E2E                   | `npm run test:e2e` · one spec: `npx playwright test e2e/<f>.spec.js` · one case: add `-g "<test name>"` | Real browser, real pages, Supabase mocked at the network (`e2e/fixtures.js`), demo mode on |
| 7   | Browser evidence      | `/verify`                                                                                               | What a person sees: layout, copy, viewport, language                                       |
| —   | **Independence line** |                                                                                                         | Everything below is visible to the author; everything above it is not                      |
| 8   | Acceptance validator  | `.claude/agents/acceptance-validator.md`                                                                | Each acceptance criterion holds, checked by an agent that never saw the plan               |

CI runs rungs 2–6 on every PR (`.github/workflows/ci.yml`). Locally, run all of
them before a PR.

### When the bundled browser is missing

`playwright.config.js` starts Vite on :5199 itself. In a cloud container the
Chromium build Playwright expects may be missing while another one is installed
under `/opt/pw-browsers`. Create an untracked `playwright.local.config.js` in the
repo root that spreads the base config and sets
`use.launchOptions.executablePath` to an installed Chromium binary (and another
port if :5199 is taken), then run `npx playwright test -c playwright.local.config.js`.
It is gitignored; never commit it. See `/verify` for the full recipe.

## Check kinds

Every acceptance criterion (AC) in a ticket names its check(s) with one of these
kinds:

| Kind     | Lives in                                                          | Red before the change?        | Use for                                                                                              |
| -------- | ----------------------------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------- |
| `unit`   | `test/<module>.test.js`, a named `it(...)`                        | **Yes**                       | Rules, calculations, parsing, data shaping, gateway queries                                          |
| `e2e`    | `e2e/<feature>.spec.js`, a named `test(...)`                      | **Yes**                       | Anything a user does in a portal: clicks, forms, rendered rows, navigation, language                 |
| `verify` | Scenario text on the AC line in the ticket (copied into the plan) | Evidence only                 | Purely visual criteria that can't be asserted (spacing, visual hierarchy, how a mobile layout looks) |
| `guard`  | An assertion inside an e2e spec                                   | **No** (green from the start) | Standing invariants: `expect(writes).toEqual([])`, no `pageerror`                                    |

Rules:

- Every AC needs at least one `unit`, `e2e` or `verify` check. A `guard` is never
  the only check for an AC.
- Prefer `e2e` over `verify`. If it can be asserted, it gets a committed spec.
- A `verify` scenario states portal, role, language, viewport, the steps, and
  what must be seen. Screenshots are the evidence.

## Phase R: proving red

Before any `src/` change, the plan's Phase R writes every `unit` and `e2e`
acceptance test and runs it. A test counts as red **only** when it fails for the
behaviour's reason:

- ✅ **Valid red**: an assertion mismatch (`expected 3, received 0`), or a locator
  timeout on the element the AC is about (`getByRole('button', { name: 'Export' })`
  not found).
- ❌ **Invalid red**: a missing module, an import or syntax error, a
  `ReferenceError`, a typo in a selector, a fixture that throws. Those prove
  nothing about the behaviour.

When a test has to import a module that doesn't exist yet, the plan adds a
**STUB** task first: create the module with the exported signature and a body
that returns an empty or neutral value, so the test fails on its assertion. The
stub is the only `src/` change allowed in Phase R.

Record the red evidence in the plan (the failing command and the assertion
line), then commit the plan, the tests and any stubs together as
`Add failing checks for <ticket title>`. That commit is the freeze point.

## Anti-gaming rules

1. **Acceptance tests are frozen** after the red commit. Changing one needs the
   owner's agreement (at the plan gate, or after a halt), an `AMENDMENTS` entry in
   the plan (what changed, why, and the date), and the ticket's AC line updated to
   match. The acceptance validator diffs the AC test files between the red commit
   and HEAD, and any change without a matching amendment is a FAIL.
2. **No skipping or focusing.** No `.skip`, `.only`, `.todo`, `test.fixme`,
   `it.skip`, `describe.only`, `xit` or `xdescribe` in the diff
   (`git diff origin/main...HEAD -- test e2e | grep -nE '^\+.*(\.(skip|only|todo|fixme)\(|\bx(it|describe)\()'`
   must print nothing).
3. **No loosened assertions.** Don't weaken `toEqual` into `toBeTruthy`, widen
   a regex, or catch and ignore an error to make a test pass.
4. **Don't mock the unit under test.** Mock its boundaries (`supabaseClient.js`,
   the network) and keep the code being tested real.
5. **E2E keeps its guards.** Every e2e spec that exercises a write path ends with
   `expect(writes).toEqual([])` and asserts no `pageerror`. Never edit
   `e2e/fixtures.js` to weaken `routeSupabase`'s write refusal. Extending
   `rowMatches` for a new filter is fine.
6. **Coupling.** An acceptance test must fail again when the implementation is
   removed. The acceptance validator proves this in a throwaway worktree:
   it restores `src/`, `public/` and the HTML entry points to the red commit
   (keeping the stubs), deletes files added since, and re-runs the checks.

## Standing invariants (every ticket, no AC needed)

- Demo mode is on by default and a demo-mode write never reaches Supabase.
- EN and ES dictionaries have exactly the same keys and placeholders
  (`test/i18n.test.js`). Spanish copy uses _usted_.
- `errorHandler.js` stays the first import of every page entry point
  (`src/js/{main,teacher,admin,login}.js`).
- Lint, types, unit, build and e2e are all green.

## Quick checks used by `/piv-validate`

```bash
# no skipped/focused tests added on this branch
git diff origin/main...HEAD -- test e2e | grep -nE '^\+.*(\.(skip|only|todo|fixme)\(|\bx(it|describe)\()' && echo "FOCUS/SKIP FOUND" || true
# errorHandler.js is still the first import of each entry point
for f in src/js/main.js src/js/teacher.js src/js/admin.js src/js/login.js; do
  head -20 "$f" | grep -m1 -E '^import ' | grep -q errorHandler || echo "errorHandler not first in $f"
done
```
