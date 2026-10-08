# SMP review rubric

The standard every review uses: `/piv-review-changes`, `/piv-review-pr`, and the
`code-reviewer` agent. Rank every finding by severity. Report only findings you
have confirmed in the code (`file:line`), not suspicions.

## Critical: blocks the PR

- **Demo-mode write leak.** A write path that can reach Supabase while
  `DEMO_MODE` is on (bypassing `demoDb.js` / `adminDemoDb.js`, calling the client
  directly from a view, or a new gateway method missing from the demo overlay).
- **XSS.** `innerHTML`, `insertAdjacentHTML` or template strings built from data
  (names, notes, imported CSV cells, URL params) without escaping. Text belongs
  in `textContent` or the existing escaping helpers.
- **Supabase without approval.** Any change under `supabase/` (schema, RLS,
  Auth, Edge Function) or any SQL the owner hasn't approved (hard rule 5).
- **Secrets.** Keys, tokens, `.env` contents or service-role usage in client
  code.
- **Data loss.** A destructive action without confirmation, or an import or
  bulk update that can overwrite records silently.

## High: fix before merge

- **Role or portal guard bypassed.** A screen or action reachable by a role
  that shouldn't have it (`role.js`, each portal's on-load guard, the admin-only
  `IS_ADMIN` locks).
- **i18n.** A user-facing string hardcoded in JS or HTML, a key added to only
  one of `src/js/i18n/en/<area>.js` and `src/js/i18n/es/<area>.js`, a
  placeholder mismatch, or Spanish copy not in the _usted_ register.
- **Entry-point order.** `errorHandler.js` is no longer the first import of a
  page entry point.
- **Import cycles.** A new cycle under `src/js/admin/` (see the "Import cycles"
  section of `.claude/ARCHITECTURE_MAP.md`).
- **Types.** New logic-layer code without JSDoc, or a change that breaks
  `npm run typecheck`.
- **Unhandled failure.** A Supabase call whose `error` is ignored, or a failed
  load that leaves a screen blank with no retry or message.
- **An acceptance check that doesn't test its AC**, or a frozen acceptance test
  changed without an AMENDMENTS entry.

## Medium: fix if it's in scope, otherwise list it

- An undocumented deviation from the plan (documented deviations in
  AMENDMENTS are intentional and are _not_ findings).
- An existing pattern not reused: a new helper that duplicates one in
  `ui.js`, `admin/ui/`, `teacher{Feedback,Modal,TableHelpers,Format}.js`,
  `controls/`, `validate.js` or `csv.js`.
- Mobile layout broken or not considered on a screen the change touches.
- Scope creep: changes unrelated to the ticket (hard rule 8).
- Code comments that aren't strictly necessary (hard rule 6).
- `.claude/ARCHITECTURE_MAP.md` not updated for a new module or moved
  responsibility. A file pushed past 1,000 lines.

## Low: mention only

Naming, small simplifications, and polish that doesn't change behaviour.

## Finding format

```
severity: critical | high | medium | low
file: src/js/path/to/file.js
line: 42
issue: one line
why: the concrete failure it causes (input or state → wrong result)
fix: the smallest change that resolves it
```

Also say what's done well. A review is a judgment of the change, not just a
list of defects.
