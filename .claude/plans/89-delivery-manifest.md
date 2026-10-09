# Plan — Describe every project and delivery unit in a checked manifest

**Implements:** #89 · **Epic:** #86 · **Branch:** feat/delivery-manifest
**Status:** Approved 2026-10-09
**Red commit:** 50978b0
**Confidence:** 8/10 that one unattended pass reaches a green PR

> Validate every pattern and path below against the code before acting on it.
> Import from the files named here; don't recreate helpers that already exist.

## Ticket

**Concern:** The owner and every delivery tool read one ordered manifest of
delivery units and one list of projects from `supabase/delivery/`. A malformed
manifest or project list is refused with the reason, so nothing downstream acts
on it. The first manifest holds one unit, `conducta`.

**User story:** As the repository owner, I want every project and every
delivery unit described in one validated place, so that the deliver command,
the gate and the records all act on the same facts and refuse bad ones.

**Type:** New capability · **Complexity:** Medium
**Portals:** none (tooling) · **Supabase:** yes (two new JSON files under
`supabase/delivery/`, owner approval per edit; no database change)

## Inherited decisions

- All delivery files live under `supabase/delivery/`, guarded; none is a
  migration — `architecture.md#data-shape-model-level`.
- Projects carry name, ref, type (`demo` | `school`), Vercel site and origin,
  `holdsRealData`, and a window required once `holdsRealData` is true. Expected
  function/Auth state is #101's — `architecture.md#data-shape-model-level`.
- A unit has a sequence number, an id, ordered `supabase/schema/*.sql` files,
  the project types it applies to, function deploys / Auth changes, and
  read-only checks. A build requires the manifest's highest sequence —
  `architecture.md#data-shape-model-level`.
- No new npm dependency; Node 24 built-ins only —
  `architecture.md#other-build-vs-buy`.
- `scripts/delivery/**/*.mjs` is JSDoc-typed and checked by
  `tsconfig.scripts.json` (#87).
- Refs are public (runbook, `.mcp.json`, built bundle).

## Out of scope

- Not included: records (#90), fingerprints (#93), the deliver command (#94),
  reconcile units (#102), docs (#105), expected function and Auth state (#101),
  the delivery-window refusal at run time (`test/deliveryWindow.test.js`).
- Not changing: anything in `supabase/schema/`; no SQL runs against any project.

## Context references — read before implementing

- `src/js/projectRef.js` + `test/projectRef.test.js` — the pattern: a small
  validated module with JSDoc and error messages that name both sides.
- `scripts/delivery/proofs.mjs:1-30` — JSDoc typedef style for delivery code.
- `scripts/delivery/schemaHarness.mjs:1-3` — `fileURLToPath`/`join` for the
  repo root from a script.
- `docs/ONBOARDING_RUNBOOK.md:104-117` — the conducta snippet and its check.
- `docs/ONBOARDING_RUNBOOK.md:313` — pilot ref `wklxkntdnzshyrijvnjj`.
- `.mcp.json:5` — demo ref `jgszeiccaycnpzhuwclb`.
- `vite.config.js:50` — demo origin `https://demo.simplemanagepro.com`.
- `test/siteOrigin.test.js:10` — pilot production domain
  `pilot.simplemanagepro.com` (see Open question 1).
- `supabase/schema/incremental_schedules.sql:77-80` — days are 1–7.
- `.claude/ARCHITECTURE_MAP.md:275-285` — the Delivery table.

### Data shapes

`supabase/delivery/manifest.json`:

```json
{
  "units": [
    {
      "seq": 1,
      "id": "conducta",
      "files": ["incremental_conducta.sql"],
      "appliesTo": ["demo", "school"],
      "functions": [],
      "auth": [],
      "checks": [
        {
          "id": "conducta-unchanged",
          "sql": "select count(*) from public.student_period_conduct where conduct_score <> 100",
          "expect": 0
        }
      ]
    }
  ]
}
```

`supabase/delivery/projects.json`:

```json
{
  "projects": [
    {
      "name": "demo",
      "ref": "jgszeiccaycnpzhuwclb",
      "type": "demo",
      "site": "demo-smp-web-page",
      "origin": "https://demo.simplemanagepro.com",
      "holdsRealData": false,
      "window": null
    },
    {
      "name": "pilot",
      "ref": "wklxkntdnzshyrijvnjj",
      "type": "school",
      "site": "smp-pilot",
      "origin": "https://pilot.simplemanagepro.com",
      "holdsRealData": false,
      "window": null
    }
  ]
}
```

Window format (required when `holdsRealData`):
`{ "timezone": "America/Costa_Rica", "slots": [{ "days": [6, 7], "from": "14:00", "to": "20:00" }] }`
— `days` integers 1–7 (1 = Monday, as `schedules.day_of_week`), `from` < `to`
as `HH:MM` 24 h, at least one slot, a non-empty IANA timezone accepted by
`Intl.DateTimeFormat`.

### Module API (`scripts/delivery/manifest.mjs`)

- `checkManifest(data, schemaFiles) → string[]` — every problem, empty when valid.
- `checkProjects(data) → string[]` — same for the project list.
- `loadManifest(root = repoRoot) → Manifest` — reads `supabase/delivery/manifest.json`,
  lists `supabase/schema/`, throws `Error` naming the file and every reason.
- `loadProjects(root = repoRoot) → ProjectList` — same for `projects.json`.
- `requiredSequence(manifest) → number` — highest `seq`, 0 when empty.
- `unitsFor(manifest, type, afterSeq) → Unit[]` — units with `seq > afterSeq`
  whose `appliesTo` includes `type`, in manifest order.

## Phase R — acceptance checks, red before any change

| AC  | Behaviour                                                                     | Kind | Where (file › test name)                                                                                              | Command                                                                            | Expected red                                  |
| --- | ----------------------------------------------------------------------------- | ---- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------- |
| AC1 | The committed manifest holds `conducta`; the project list holds demo + pilot  | unit | `test/deliveryManifest.test.js` › "accepts the committed manifest and project list"                                   | `npx vitest run test/deliveryManifest.test.js -t "accepts the committed manifest"` | expected [] to deeply equal [ { seq: 1, … } ] |
| AC2 | Non-increasing sequence or a repeated id is rejected                          | unit | `test/deliveryManifest.test.js` › "rejects units out of sequence or with a repeated id"                               | `npx vitest run test/deliveryManifest.test.js -t "rejects units out of sequence"`  | expected [] to have a length of 1             |
| AC3 | A missing schema file or a check that isn't a single `select` is rejected     | unit | `test/deliveryManifest.test.js` › "rejects a unit with a missing schema file or a check that is not a single select"  | `npx vitest run test/deliveryManifest.test.js -t "missing schema file"`            | expected [] to have a length of 1             |
| AC4 | Unknown project type, or `holdsRealData` without a window, is rejected        | unit | `test/deliveryManifest.test.js` › "rejects an unknown project type and a real-data project without a delivery window" | `npx vitest run test/deliveryManifest.test.js -t "unknown project type"`           | expected [] to have a length of 1             |
| AC5 | Required sequence is the highest; pending units are those of a type after seq | unit | `test/deliveryManifest.test.js` › "derives the required sequence and a project's pending units"                       | `npx vitest run test/deliveryManifest.test.js -t "derives the required sequence"`  | expected +0 to be 7                           |
| —   | The loaders refuse a malformed file and name the reason (Concern, not an AC)  | unit | `test/deliveryManifest.test.js` › "refuses to load a malformed manifest or project list, with the reason"             | `npx vitest run test/deliveryManifest.test.js -t "refuses to load"`                | expected [Function] to throw an error         |

**STUB tasks:**

- STUB `scripts/delivery/manifest.mjs`: the six exports with their JSDoc types,
  returning `[]`, `{ units: [] }`, `{ projects: [] }`, `0`, `[]`.

**Red evidence:**

- AC1: → `AssertionError: expected [] to deeply equal [ { seq: 1, id: 'conducta', …(5) } ]` ✅ valid red
- AC2: → `AssertionError: expected [] to have a length of 1 but got +0` ✅ valid red
- AC3: → `AssertionError: expected [] to have a length of 1 but got +0` ✅ valid red
- AC4: → `AssertionError: expected [] to have a length of 1 but got +0` ✅ valid red
- AC5: → `AssertionError: expected +0 to be 7 // Object.is equality` ✅ valid red
- Loader refusal: → `AssertionError: expected [Function] to throw an error` ✅ valid red

`npm run typecheck` and `npx eslint` pass with the stub; the rest of `npm test`
is unchanged (the known Node-22 ICU case in `test/i18n.test.js` aside).

## Implementation tasks

### 1. UPDATE `scripts/delivery/manifest.mjs` — validation

- **Implement:** `checkManifest`: `data.units` is an array; each unit has
  `seq` a positive integer strictly greater than the previous unit's (reason
  names the unit id and both numbers); `id` matches
  `^[a-z0-9]+(-[a-z0-9]+)*$` and is unique (reason names the id);
  `files` a non-empty array of plain names (no `/` or `\`) present in
  `schemaFiles` (reason names the file); `appliesTo` a non-empty array of
  `PROJECT_TYPES` without repeats; `functions` and `auth` arrays of non-empty
  strings; `checks` an array of `{ id, sql, expect }` where `sql`, trimmed and
  with one optional trailing `;` removed, starts with `select` (case-insensitive,
  word boundary) and contains no other `;`, and `expect` is a number. One
  reason string per problem, each prefixed with the unit id (or index when the
  id is missing). `checkProjects`: `data.projects` is an array; `name` kebab
  and unique; `ref` matches `^[a-z]{20}$` and is unique; `type` in
  `PROJECT_TYPES` (reason quotes the bad value); `site` non-empty; `origin` an
  `https:` URL with no path beyond `/`; `holdsRealData` boolean; `window` null
  or a valid window (format above), and required when `holdsRealData`.
- **Pattern:** `src/js/projectRef.js:44-57` (messages naming both sides).
- **Gotcha:** AC tests assert exactly one reason per bad input, so a single
  defect must not cascade (e.g. a bad `seq` must not also trip the order check
  for the next unit — compare against the last _valid_ `seq`).
- **Validate:** `npx vitest run test/deliveryManifest.test.js -t "rejects"`
- **Satisfies:** AC2, AC3, AC4

### 2. UPDATE `scripts/delivery/manifest.mjs` — loaders and derivations

- **Implement:** repo root from `fileURLToPath(new URL("../..", import.meta.url))`;
  `loadManifest(root)` reads and `JSON.parse`s the file (a parse error becomes a
  refusal naming the file), lists `supabase/schema/*.sql`, throws
  `supabase/delivery/manifest.json is refused:\n- <reason>…` when
  `checkManifest` returns anything; `loadProjects` likewise. `requiredSequence`
  and `unitsFor` as in the API above.
- **Pattern:** `scripts/delivery/schemaHarness.mjs:1-3`.
- **Validate:** `npx vitest run test/deliveryManifest.test.js -t "refuses to load|derives"`
- **Satisfies:** AC5, Concern

### 3. CREATE `supabase/delivery/manifest.json` and `supabase/delivery/projects.json` — **owner approval**

- **Implement:** the two files exactly as in "Data shapes", Prettier-formatted.
- **Gotcha:** the guard asks for each file; a refusal halts the loop (B7).
- **Validate:** `npx vitest run test/deliveryManifest.test.js -t "accepts the committed manifest"`
- **Satisfies:** AC1

### 4. UPDATE `.claude/ARCHITECTURE_MAP.md`

- **Implement:** in the Delivery table, in path order, a row for
  `scripts/delivery/manifest.mjs` (after `executors/psql.mjs`) and one for
  `supabase/delivery/manifest.json` + `projects.json` (last).
- **Validate:** both paths exist; `npx prettier --check .claude/ARCHITECTURE_MAP.md`

### 5. Turn Phase R green

- **Validate:** `npx vitest run test/deliveryManifest.test.js`; `npm run lint && npm run typecheck`.

## Validation commands

```bash
npm run format:check && npm run lint && npm run typecheck
npm test
npm run build
npm run test:e2e
```

No app code changes; e2e runs once at the end as a regression check.

## Open questions / assumptions

1. The pilot's origin: only `test/siteOrigin.test.js` names
   `pilot.simplemanagepro.com`. **Default:** `https://pilot.simplemanagepro.com`;
   the owner corrects it at the gate if the pilot is served elsewhere. Resolved: default accepted at the gate.
2. The demo ref is taken from `.mcp.json` (the project linked to the GitHub
   integration). **Default:** `jgszeiccaycnpzhuwclb`. Resolved: default accepted at the gate.
3. Window format: per-slot `days` 1–7 (1 = Monday) with `HH:MM` `from`/`to`
   and one IANA timezone per project; no overnight slots (an evening window
   past midnight is two slots). **Default:** as described. Resolved: default accepted at the gate.
4. A check is "a single select" by shape only (one statement starting with
   `select`). It does not prove the statement is read-only (`select
some_volatile_fn()` passes); the deliver command (#94) should run checks in a
   read-only transaction. **Default:** shape check here, read-only enforcement
   noted for #94. Resolved: default accepted at the gate.
5. `functions` and `auth` are plain string lists for now; #101 gives them
   meaning. **Default:** arrays of non-empty strings, empty for `conducta`. Resolved: default accepted at the gate.

## Notes

`checkManifest` takes the schema file list as an argument instead of reading
the disk, so AC2–AC5 run on in-memory data and only the loaders touch files.
The extra loader test covers the Concern's "refused with the reason" for the
two committed files; it isn't one of the ticket's ACs.

## AMENDMENTS

Append-only.

- (none)

## Manual Supabase steps

- None. The two new files under `supabase/delivery/` are repository data; no SQL
  is applied to any project.

## Validation

## Execution report
