---
name: verify
description: Verify Simple Manage Pro changes by driving the real app in a browser — dev server + Playwright, with Supabase mocked at the network layer.
---

# Verifying Simple Manage Pro changes

Static Vite multi-page app — `login.html`, `index.html` (student),
`teacher.html`, `admin.html`, plus `privacy.html`, `terms.html` and
`404.html` — against a Supabase backend. No real backend or `.env` is
needed to verify: the e2e harness mocks it.

## Build & launch

```bash
npm run build      # bundle check
npm run test:e2e   # boots Vite on :5199 with a dummy Supabase env, demo mode on
```

`playwright.config.js` starts the dev server itself and reuses one already
listening on 5199 outside CI, so a server another checkout started there
would serve its code, not yours. Don't kill a server you did not start;
run on a free port instead.

Both that and a sandbox where Playwright cannot download its browser are
handled by an untracked config in the repo root (paths resolve from the
config's directory) that spreads the base one: set `use.baseURL`,
`webServer.command` (`npx vite --port <N> --strictPort`) and `webServer.url`
for another port, and `use.launchOptions.executablePath` for an installed
Chromium. Run it with `npx playwright test -c <that config>` and never
commit it.

## Drive (Playwright)

Write the check as a spec — a scratch one is fine — and build it from
`e2e/fixtures.js`:

- `routeSupabase(context, fix)` answers REST reads from per-table fixture
  arrays, applying the filters `rowMatches` understands (extend it when a
  screen sends one it doesn't; ordering and limits are not applied, and a
  filter on an embedded column such as `students.class_id` matches nothing),
  returns a single row when the `Accept` header asks for an object, answers
  `rpc/demo_teacher_id` and `GET /auth/v1/user`, refuses every write, and
  returns the list of writes attempted.
- `studentFix`, `teacherFix`, `consoleFix` and `scheduleFix` are ready-made
  schools; spread one and override the tables the check is about.
- Sign in by seeding the session before the page loads:

  ```js
  await context.addInitScript(
    ([key, value]) => localStorage.setItem(key, value),
    [`sb-${REF}-auth-token`, sessionSeed()],
  );
  ```

- The app defaults to Spanish, but `routeSupabase` pins English, so text
  assertions are in English. Call `seedLang(context, "es")` after it to
  check the Spanish copy. The login page has no language key and cannot be
  pinned.

Demo mode is on in the harness, so every check of a write flow should end
with `expect(writes).toEqual([])` — a demo write must never reach Supabase.
Collect `pageerror` events and assert none too.

Existing specs show the pattern for each portal: `smoke.spec.js` (login and
all three portals), `mobile.spec.js` (Pixel 7 viewport), `errors.spec.js`
(failed reads, retry and the offline notice).

## Gotchas

- The teacher roster's column-header row shares `.roster-row-cells` with the
  clickable data rows — click `.roster-row .roster-row-cells` or you hit the
  inert header.
- Gradebook completion text is `{graded}/{total} graded` (e.g. `2/3 graded`).
- `getCurrentPeriodId()` (`teacherFormat.js`) picks the grading period whose
  dates bracket today, else the first one — with several periods, make the
  one under test cover the current date (the fixtures' `TODAY` helps).
- Some teacher-console controls are admin-locked through `IS_ADMIN` in
  `teacherAuth.js`; they render inert, so drive what a teacher can do.
- Lists re-render after async loads — wait on expected text, not just
  selectors, before clicking rows.
- Admin dialogs nest (a form or confirm over another dialog); assert on the
  topmost one.
