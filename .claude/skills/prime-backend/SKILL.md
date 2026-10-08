---
name: prime-backend
description: Orients the session on Simple Manage Pro's data side for a ticket — the Supabase client, query modules, the admin gateway, teacher data, the demo-mode overlay, roles, and the schema/RLS files (read-only) — with the demo-write invariant and the Supabase approval rule up front. Use before planning a ticket whose Prime line says backend or both.
argument-hint: "[#ticket]"
---

# Prime backend: data flow, demo overlay, schema, read-only

**Input**: $ARGUMENTS, the ticket `#N`.

## Two rules before anything else

1. **A demo-mode write never reaches Supabase.** `DEMO_MODE` defaults on
   (`src/js/demoMode.js`). `demoDb.js` wraps the real data layer: reads pass
   through, then per-session deltas apply; writes only record deltas.
   `adminDemoDb.js` is the admin console's per-table demo `Gateway`. Any new
   read or write path must go through these.
2. **Hard rule 5:** never change Supabase RLS, Auth, schema or data without the
   owner's approval. Everything under `supabase/` is **read-only** while
   priming. The guard hook asks before any edit there in a Default-mode
   session, and refuses it in every other mode.

## 0. The ticket

Read `#N` with `mcp__github__issue_read` (method `get`, owner `GabrielAbarca`,
repo `Simple-Manage-Pro-Software`), and the epic architecture sections its
`**Docs:**` line names, especially any "Supabase impact" items. Note the
ticket's `**Supabase:**` field.

## 1. Rules and map

`CLAUDE.md`; `supabase/CLAUDE.md`; `.claude/references/conventions.md` (section
supabase); `.claude/ARCHITECTURE_MAP.md` sections **Backend**, **Shared vs
single-portal modules**, and the matching Feature map subsection.

## 2. The data layer, scoped

Read only the modules on the ticket's path:

| Concern                   | Files                                                                                                       |
| ------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Client and env            | `src/js/supabaseClient.js` (throws without env; `VITE_EXPECTED_PROJECT_REF`)                                |
| Student and teacher reads | `src/js/supabaseQueries.js`                                                                                 |
| Admin CRUD                | `src/js/adminData.js` (`Gateway` + `createAdminData(gateway)`), `src/js/admin/data.js`                      |
| Teacher console data      | `src/js/teacherData/` (attendance, classes, gradebook, students, categories, schedule, identity, reference) |
| Demo overlay              | `src/js/demoDb.js`, `src/js/adminDemoDb.js`, `src/js/demoMode.js`                                           |
| Accounts                  | `src/js/accounts.js` (the `admin-users` Edge Function in real mode, simulated in demo)                      |
| Roles and routing         | `src/js/role.js`, each portal's auth module                                                                 |
| Error mapping             | `src/js/dbErrors.js`                                                                                        |

## 3. Schema and RLS (read-only)

`supabase/schema/school_schema.sql` (baseline) and the
`incremental_*.sql` snippets relevant to the tables involved. There is no
migrations directory; changes ship as hand-applied snippets. Note the RLS
policies that govern the tables the ticket reads or writes, and the role each
one admits.

## 4. How it's tested

`test/supabaseQueries.test.js`, `test/adminGateway.test.js` (an in-memory
PostgREST stand-in), `test/demoDb.test.js` (fake `realDb`, records writes), and
the module's own test. Tests mock `supabaseClient.js` with `vi.mock` and import
the module under test with `await import(...)`.

## 5. State

```bash
git status --short && git log -10 --oneline -- src/js supabase test
```

## Output

- **Data path:** UI → module → gateway or query → table(s), with paths.
- **Demo behaviour:** how the overlay handles each read and write involved, and
  what must be added for new ones.
- **Supabase impact:** none, or the exact schema or RLS change the ticket needs
  (an owner-approval item; the ticket must say `**Supabase:** yes`).
- **Tests to extend:** files and the mocking pattern.
- **Risks:** RLS that would block the new query for a role, demo/real
  divergence, error paths without retry.
