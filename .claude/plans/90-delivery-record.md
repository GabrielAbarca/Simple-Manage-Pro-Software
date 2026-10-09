# Plan — Record each delivery in a fixed format that holds no row values

**Implements:** #90 · **Epic:** #86 · **Branch:** feat/delivery-record
**Status:** Draft
**Red commit:** <short sha of the newest `Add failing checks for` commit, filled at approval>
**Confidence:** 9/10 that one unattended pass reaches a green PR

> Validate every pattern and path below against the code before acting on it.
> Import from the files named here; don't recreate helpers that already exist.

## Ticket

**Concern:** Every delivery, bypass and exception is appended to its project's
record, `supabase/delivery/records/<project>.json`, in a fixed schema: unit ids
with each file's SHA-256; start and end times and the approver; the fingerprint
hash before and after; pass or fail for each proof. Bypass and exception
entries also carry the owner's reason. The writer refuses anything else, so no
value read from a row can reach the public repo. A reader returns each
project's proved sequence, latest proofs, open bypasses and exceptions.

**User story:** As the owner, I want every delivery written to a record whose
schema can't carry a row value, so that I can publish what each project is
running without leaking minors' data.

**Type:** New capability · **Complexity:** Medium
**Portals:** none (delivery tooling) · **Supabase:** no (the module only
defines where records live; tests write to a temp dir; nothing under
`supabase/` is created or edited)

## Inherited decisions

- Records are append-only, one file per project, under `supabase/delivery/`
  (guarded). Delivery entries carry unit ids with SHA-256 per file, start and
  end times, the approver, the fingerprint before and after, pass or fail per
  proof; bypass and exception entries carry a reason. Ids, hashes, booleans,
  timestamps and owner-written reasons only. `architecture.md#data-shape-model-level`
- A Postgres error on a `holdsRealData` project is stored as its SQLSTATE,
  never its message. `architecture.md#security-and-privacy`
- A bypass is a write made outside deliver, recorded with a reason by
  `deliver --record-bypass` (#98). `architecture.md#portals-and-roles`
- Exceptions are named, with a reason; the fingerprint compare subtracts them.
  `architecture.md#data-shape-model-level`
- No new npm dependency; `scripts/delivery/**/*.mjs` are JSDoc-typed and
  checked by `tsconfig.scripts.json`. `architecture.md#other-build-vs-buy`

## Out of scope

- Writing records from a delivery (#94), the `--record-bypass` flag (#98),
  printing state (#96), the fingerprint compare and its key format (#93).
- Committing any record. The first ones come from #102 and #104.
- Not changing: `scripts/delivery/{proofs,schemaHarness}.mjs`,
  `scripts/delivery/executors/psql.mjs`, anything under `supabase/`.

## Context references — read before implementing

- `scripts/delivery/proofs.mjs` (lines 1–30) — JSDoc typedef style for this
  directory (`@typedef {object}` + `@property`), named exports, no default.
- `scripts/delivery/executors/psql.mjs` (lines 3–10) — `ExecResult` carries
  `sqlstate` and `error`; #94 will map a failed unit's result into the
  delivery's `failure` input (`{ unit, sqlstate, message: error }`).
- `src/js/dbErrors.js` (lines 37–46) + `test/dbErrors.test.js` (lines 30–37) —
  the pattern the ticket names: key off the SQLSTATE and prove the raw
  message never survives (`JSON.stringify(mapped)` doesn't contain it).
- `tsconfig.scripts.json` — already includes `scripts/delivery/**/*.mjs`
  with Node types; nothing to add.
- `eslint.config.js` (lines 34–44) — `scripts/**/*.{js,mjs}` already get Node
  globals.
- `.claude/ARCHITECTURE_MAP.md` (lines 275–285) — the `## Delivery` table,
  sorted by path.

### Patterns to follow

```js
// scripts/delivery/proofs.mjs:3-9 — typedefs at the top
/**
 * @typedef {object} AuditProof
 * @property {boolean} ok
 * @property {string | null} check
 ...
 */
```

```js
// test/dbErrors.test.js:30-36 — prove the message is gone, not just the key present
const mapped = mapDbError(pgError("23503", raw));
expect(JSON.stringify(mapped)).not.toContain("fkey");
```

## Design

### File

`<dir>/<project>.json`, written as
`JSON.stringify({ project, entries }, null, 2) + "\n"`.

**Append-only by construction.** `appendEntry` reads the existing file,
requires its text to equal the canonical serialisation of what it parses to
(an edited file is refused, not normalised), builds the new canonical text,
and refuses unless the new text starts with the old text minus its closing
`\n  ]\n}\n` (so every earlier byte is kept). It writes to `<file>.tmp` and
renames, so a crash never leaves half a record. A missing file starts a new
record; `dir` is created if needed.

### Entry schema (exact keys; any other key at any level → `RecordError`)

| Kind        | Keys                                                                                                           |
| ----------- | -------------------------------------------------------------------------------------------------------------- |
| `delivery`  | `kind`, `units`, `startedAt`, `endedAt`, `approver`, `fingerprint`, `proofs`, optional `failure`               |
| `bypass`    | `kind`, `at`, `approver`, `fingerprint`, `reason`                                                              |
| `exception` | `kind`, `at`, `approver`, `object`, `reason`                                                                   |
| unit        | `id`, `sequence`, `files` (array of `{ path, sha256 }`, may be empty for a function or Auth unit)              |
| fingerprint | delivery: `{ before, after }` (`after` may be `null` when a unit failed); bypass: one hash (the live one seen) |
| proof       | `{ name, ok }`, non-empty array                                                                                |
| failure     | stored `{ unit, sqlstate }`; input may also carry `message`, which is always dropped                           |

Value rules (the "no free text" half of AC2):

- id (`unit.id`, `proof.name`, `failure.unit`): `^[a-z0-9][a-z0-9._-]{0,63}$`
- `sequence`: positive integer
- hash: `^[0-9a-f]{64}$`
- timestamp: `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$` and a real
  date; `startedAt <= endedAt`
- `path`: `^supabase/[A-Za-z0-9_][A-Za-z0-9_./-]*$`, no `..`
- `approver`: a git identity, `^[^<>\n]{1,100} <[^<>\s]+@[^<>\s]+>$`
- `sqlstate`: `^[0-9A-Z]{5}$` or `null`
- `object`: printable ASCII, 1–200 chars, no leading or trailing space,
  stored as given (the compare in #93 owns its meaning)
- `reason`: string, trimmed length 1–500, no control characters; only on
  bypass and exception
- `ok`: boolean
- project name: `^[a-z0-9][a-z0-9-]{0,62}$` (also the file name)

### Reader

- `readRecord(dir, name)` → `{ project, entries }`; missing file →
  `{ project: name, entries: [] }`. Every entry is re-validated, so a
  hand-edited record that carries a stray field fails loudly.
- `readProjectState(dir, name)` →
  - `provedSequence`: the highest unit `sequence` across **proved** deliveries
    (every proof `ok` and no `failure`), else `0`;
  - `latestProofs`: `{ at: endedAt, proofs }` of the last delivery entry
    (proved or not), else `null`;
  - `openBypasses`: bypass entries after the last proved delivery (a
    reconcile ships as a delivery of reconcile units, so it closes them too);
  - `exceptions`: the latest exception entry per `object`, in record order.

### API (`scripts/delivery/record.mjs`)

`RECORDS_DIR`, `RecordError`, `validateEntry(project, entry)` (returns the
stored form or throws), `appendEntry(dir, project, entry)` (returns the stored
entry), `readRecord(dir, name)`, `projectState(entries)`,
`readProjectState(dir, name)`. `project` is `{ name, holdsRealData }`.

## Phase R — acceptance checks, red before any `src/` change

| AC  | Behaviour                                                                                       | Kind | Where (file › test name)                                                                                    | Command                                                                       | Expected red                       |
| --- | ----------------------------------------------------------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------- |
| AC1 | Second append keeps the first entry byte for byte                                               | unit | `test/deliveryRecord.test.js` › "appends a delivery entry and never rewrites earlier ones"                  | `npx vitest run test/deliveryRecord.test.js -t "never rewrites earlier ones"` | file not written                   |
| AC2 | Any field outside the schema, or free text outside a reason, is rejected and nothing is written | unit | `test/deliveryRecord.test.js` › "rejects an entry carrying any field outside the fixed schema"              | `npx vitest run test/deliveryRecord.test.js -t "outside the fixed schema"`    | valid entry not written / no throw |
| AC3 | A failure on a `holdsRealData` project is stored as its SQLSTATE only                           | unit | `test/deliveryRecord.test.js` › "stores a failure on a real-data project as its SQLSTATE only"              | `npx vitest run test/deliveryRecord.test.js -t "SQLSTATE only"`               | `failure` undefined                |
| AC4 | Bypass and exception need a reason; an exception names its object                               | unit | `test/deliveryRecord.test.js` › "requires a reason on bypass and exception entries"                         | `npx vitest run test/deliveryRecord.test.js -t "requires a reason"`           | promise resolved                   |
| AC5 | Reader returns proved sequence, latest proofs, open bypasses, exceptions                        | unit | `test/deliveryRecord.test.js` › "reads a project's proved sequence, latest proofs, bypasses and exceptions" | `npx vitest run test/deliveryRecord.test.js -t "proved sequence"`             | `0` instead of `2`                 |

**STUB tasks:**

- STUB `scripts/delivery/record.mjs`: exports `RECORDS_DIR`, `RecordError`,
  `appendEntry` (resolves `null`, writes nothing), `readRecord` (no entries),
  `readProjectState` (the empty state), so every AC fails on its assertion.

**Red evidence** (2026-10-09, `npx vitest run test/deliveryRecord.test.js`):

- AC1: → `AssertionError: expected false to be true` (the record file exists) ✅ valid red
- AC2: → `AssertionError: expected '' not to be ''` (the valid first entry wasn't written, and no bad entry is rejected) ✅ valid red
- AC3: → `AssertionError: expected undefined to deeply equal { unit: 'unit-1', sqlstate: '23505' }` ✅ valid red
- AC4: → `AssertionError: promise resolved "null" instead of rejecting` ✅ valid red
- AC5: → `AssertionError: expected +0 to be 2` ✅ valid red

Existing suite with the stub: all green except
`test/i18n.test.js` › "formats 24h time strings to the locale's 12h form",
which fails identically on a clean `origin/main` in this container (Node 22's
ICU vs CI's Node 24; `'2:30 p. m.'` differs only in the space character).
Not this ticket's.

## Implementation tasks

### 1. UPDATE `scripts/delivery/record.mjs` — schema and validator

- **Implement:** typedefs (`Project`, `UnitEntry`, `ProofEntry`,
  `DeliveryEntry`, `BypassEntry`, `ExceptionEntry`, `Entry`, `ProjectState`);
  pattern constants; an `exactKeys(obj, required, optional, where)` helper that
  throws `RecordError` naming the stray or missing key; `validateEntry(project,
entry)` returning a new stored object built from the allowed keys only
  (`failure` → `{ unit, sqlstate }`, `message` dropped on every project).
- **Pattern:** `scripts/delivery/proofs.mjs:1-30`
- **Gotcha:** build the stored object key by key; never spread the input, or a
  stray key can slip through. `reason` is accepted only on bypass/exception.
- **Validate:** `npx vitest run test/deliveryRecord.test.js -t "outside the fixed schema|requires a reason|SQLSTATE only"` (the parts not needing the writer will still fail until task 2)
- **Satisfies:** AC2, AC3, AC4

### 2. UPDATE `scripts/delivery/record.mjs` — writer and reader

- **Implement:** `readRecord`, `appendEntry` (canonical check, prefix check,
  tmp + rename, `mkdir -p`), `projectState`, `readProjectState`, per Design.
  Use `node:fs/promises` and `node:path` only.
- **Gotcha:** validate before touching the disk, so a rejected entry never
  creates the file or the directory's `.tmp`.
- **Validate:** `npx vitest run test/deliveryRecord.test.js`
- **Satisfies:** AC1, AC2, AC3, AC4, AC5

### 3. ADD non-AC unit tests to `test/deliveryRecord.test.js` (new `describe`, below the frozen ones)

- **Implement:** a hand-edited record (reformatted, or with a stray field) is
  refused on append and on read; `startedAt` after `endedAt` is rejected; a
  generated record passes `npx prettier --check` unchanged (so the records
  later committed by #102/#104 survive `format:check` from #92).
- **Validate:** `npx vitest run test/deliveryRecord.test.js`
- **Satisfies:** robustness (no AC)

### 4. UPDATE `.claude/ARCHITECTURE_MAP.md`

- **Implement:** in the `## Delivery` table, insert in path order a row for
  `scripts/delivery/record.mjs` (after `proofs.mjs`, before
  `schemaHarness.mjs`) and a row for `supabase/delivery/records/` (after
  `scripts/…`) describing the append-only per-project record and that it is
  guarded.
- **Validate:** `npx prettier --check .claude/ARCHITECTURE_MAP.md`

### 5. Turn Phase R green

- **Validate:** every Phase R command passes; `npm run lint && npm run typecheck`

## Validation commands

```bash
npm run format:check && npm run lint && npm run typecheck
npm test
npm run build
npm run test:e2e
```

## Open questions / assumptions

Each has a default the loop uses if the reviewer approves without overriding it.

1. Does a project without `holdsRealData` (the demo) keep the Postgres message
   of a failure? — **Default:** no. Every project stores the SQLSTATE only;
   the message stays on the owner's terminal. It keeps AC2's "no free text
   outside a reason" absolute, and the demo's messages can echo row values too.
2. What closes a bypass? — **Default:** the next **proved** delivery (every
   proof passes, no failure). A reconcile is a delivery of reconcile units, so
   it closes bypasses the same way; there is no separate `reconcile` kind.
3. Can an exception be withdrawn? — **Default:** not in this ticket.
   Exceptions stay open; a later exception for the same object replaces the
   earlier one's reason. Withdrawal can be a new kind when #93 needs it.
4. Each unit's `sequence` is stored next to its `id`, so the reader can
   report the proved sequence without the manifest. — **Default:** yes.

## Notes

- Rejected: JSON Lines (the ticket fixes the `.json` name and the PR diff of
  a pretty JSON file reads better); rewriting the whole file from parsed data
  (it would silently normalise a hand edit, so "unchanged byte for byte"
  would be a property of the serialiser, not a guarantee).
- `npm ci` was needed in this container: `node_modules` predated
  `@types/node`, so `tsc -p tsconfig.scripts.json` failed before it.

## AMENDMENTS

Append-only. Every change to this plan or to a frozen acceptance test after the
red commit goes here: date — what changed — why.

- (none)

## Manual Supabase steps

- None.

## Validation

## Execution report
