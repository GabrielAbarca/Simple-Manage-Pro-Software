# Delivery pipeline — PRD

**Status:** Draft · **Owner:** Gabriel Zelaya · **Date:** 2026-10-08

## Problem statement

Changes reach SMP's Supabase projects (schema, access rules, the demo lock,
the `admin-users` Edge Function, per-project Auth settings) and its two live
sites by hand. The order they must go in is written only in the runbook and in
PR bodies, nothing checks the result, and what each project actually has is
known from memory and one dated paragraph. That route has already left a site
on an app version its database did not match and left access-rule gaps in
place for weeks.

G3 (guardian portal) adds a new role, its access rules and a login path
through the same route, and every school that signs adds another project to
keep in step. Before G3, delivery has to become repeatable and checked, with
the owner's approval on anything that touches Supabase.

## Evidence

| #   | Observation                                                                                                                                                                                                                                                                                                                                                          | Source                                            |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| 1   | **Schema ahead of the app for 19 days.** #41 (20 Aug 2026) changed attendance's unique constraint in the database with no app change. Saving attendance failed with 42P10 on the pilot and on any freshly provisioned school until #58 (8 Sep 2026). The demo project was never migrated in that window.                                                             | PR #58 body                                       |
| 2   | **A change that would not have done what it said.** The #41 SQL dropped the old constraint by a hardcoded name. The demo's constraint, created out of band, had another name, so applying it there would have kept the two-teacher collision. It was caught by reading the code in #58, not by a check.                                                              | PR #58 body; runbook §2                           |
| 3   | **A "safe to re-run" script that wasn't.** `demo_seed_attendance.sql` would have duplicated a month of attendance on every re-run.                                                                                                                                                                                                                                   | PR #58 body                                       |
| 4   | **Access rules missing from the baseline.** `incremental_narrow_read_policies.sql` and `incremental_teacher_policies.sql` were absent from `school_schema.sql` until 2026-09-05. Every project provisioned from it before then had no `teachers_directory` (a broken student Teachers tab) and no teacher-scoped RLS (a dead teacher console). The demo lacked both. | Runbook §2; #55, #56                              |
| 5   | **The order lives in prose.** Two files say they are "required before deploying the app version that…" (`incremental_attendance_by_subject.sql`, `incremental_conducta.sql`). `demo_lockdown.sql` must be re-run by hand after any new table. Nothing enforces either.                                                                                               | Runbook §2; file headers                          |
| 6   | **A merge is a production deploy.** Both Vercel projects (`demo-smp-web-page`, `smp-pilot`) deploy every push to `main` to production in the same second. No step waits for a database change.                                                                                                                                                                       | Vercel deployment list, 8 Oct 2026                |
| 7   | **A required delivery with no record.** #63's body says `incremental_conducta.sql` must be applied to each project before it ships. It was opened at 01:55 and merged at 01:57 UTC on 7 Oct 2026. Nothing records whether the SQL reached both projects or whether `demo_lockdown.sql` was re-run. Assumption — validate via the runbook's check queries.            | PR #63; runbook §2                                |
| 8   | **Project state is a paragraph.** The only record of what each project has applied is a runbook paragraph dated 2026-09-05 that tells the reader not to trust it. Auth settings are recorded nowhere; leaked-password protection was off on both projects in August.                                                                                                 | Runbook §2; readiness board, 7 Oct 2026           |
| 9   | **Two sites, two builds of one commit.** Demo builds on Node 22.x with no framework preset; pilot on Node 24.x with the Vite preset. CI uses Node 24.                                                                                                                                                                                                                | Vercel project settings, 8 Oct 2026               |
| 10  | **No releases.** `package.json` is `1.0.0`; there are no tags and no changelog.                                                                                                                                                                                                                                                                                      | Repository                                        |
| 11  | **CI gaps.** `format:check` and `rls_audit.sql` never run in CI, and nothing scans dependencies. `format:check` passes on `main` today because the pre-commit hook keeps it clean, so no failure is on record from that gap.                                                                                                                                         | `.github/workflows/ci.yml`; local run, 8 Oct 2026 |
| 12  | **No real person affected yet.** Every incident above hit test accounts on the demo or the empty pilot. The first real school data, expected mid-February 2027 at the earliest, ends that margin.                                                                                                                                                                    | Owner, 8 Oct 2026                                 |
| 13  | **Time per delivery today.** No baseline exists. Assumption — validate by timing the MVP's re-delivery.                                                                                                                                                                                                                                                              | Owner, 8 Oct 2026                                 |

## Thesis

**Why this.** Every recorded failure is on the database side, and every one
was caught by someone reading code, not by a check. The safeguards that exist
(`rls_audit.sql`, `demo_lockdown.sql`'s self-verification,
`VITE_EXPECTED_PROJECT_REF`) work only when someone remembers to run them, on
the right project, in the right order.

**Why now.** G3 is the largest database change ahead. Guardians have no login
link, no access rules and no persona in `rls_audit.sql`. G3 needs guardian read
rules across the student-facing tables, the first write path for a non-staff
role (absence justifications), new tables for comunicados and likely
notifications (each needing the demo lock), and an Edge Function change for
bulk logins: roughly 4–6 database changes and one function deploy, to two
projects (estimate from the readiness board and the schema; TBD — needs
validation in `/plan-architecture`). After G3 the first signed school turns a
failure on a test account into a failure on minors' records under Ley 8968.
Doing this after G3 means G3 ships through the route that already failed.

**Why it beats the workaround.** The workaround is the runbook, memory and a
hand-run audit. It depends on one person recalling an order across every
project, its cost grows with projects × changes, and it leaves no record. The
owner's bar for switching: smoother, more professional, more secure, and no
repeated hand steps. A portfolio-grade pipeline is the owner's personal goal;
it is not the problem this solves.

## Hypothesis

```
We believe a repeatable, checked way of delivering database and code changes
(a session prepares it, the owner approves it, it lands in the right order with
the app, and every Supabase change is proved and recorded per project) will
cause the owner to ship G3's database changes and provision the first school
without applying SQL by hand or working out the order from the runbook.
Without it we stay exposed to a site (demo, pilot or school) running an app
version its database doesn't match, an access-rule gap reaching a live site,
and slow delivery because every step is by hand.

We'll know we're RIGHT if, through G3 (Nov 2026 – Jan 2027):
  - every delivery, database or code, goes through the delivery path;
  - every G3 database change reaches every project with a recorded proof
    before or together with the app version that needs it;
  - every production deploy maps to a recorded, checked version;
  - a routine database change is proved on every project within one evening
    window;
  - "what state is each project in?" is answered from the record in
    10 minutes or less;
and, at the first school's onboarding (mid-Feb 2027 at the earliest):
  - its project goes from empty to "audit passes" with no hand-written SQL.

We'll know we're WRONG if:
  - more than one G3 change bypasses the path, or any bypass has no written
    reason;
  - a mismatch or access-rule gap reaches a live site anyway;
  - the epic is not finished before the first G3 database change merges
    (mid-November 2026).

Guardrails (one breach is enough to count as wrong):
  - a change reaches Supabase without the owner's approval (never bypassable);
  - a database change lands on a live school holding real data during class
    hours (evenings and weekends only);
  - a credential or student data appears in a public log (the repo is public);
  - any extra cost.
```

## Users and job to be done

**Primary user:** the owner, Gabriel Zelaya, the only person who delivers
changes now and before January.

**Moments, in priority order:**

1. **A merged PR changes `supabase/`** (schema, access rules, the Edge
   Function or Auth settings). It has to land on every project and line up
   with the app deploy that the same merge triggers.
2. **A new school project is provisioned.**
3. **"What state is each project in?"** before a demo or an onboarding.

**Agent sessions** (the PIV loop's cloud sessions) may prepare a delivery up
to the owner's approval. They never complete one.

**Job to be done:**

> When a change that touches the database merges, I want every project to end
> up in the state that change expects, in the right order with the app, with
> proof, so I can ship G3 and onboard schools without re-reading the runbook
> or trusting memory.

**A project's state** means all of: its schema, its access rules, its demo
lock (present on the demo, absent on every school project), the `admin-users`
Edge Function, and its Auth settings (URL configuration, leaked-password
protection, the reset-password email template).

**Who feels a failure:** school admins, teachers and students (guardians after
G3). They never run a delivery.

**Not for:** school staff and guardians as operators of the path; the landing
page and portfolio projects on the same Vercel team; the demo's seed content.

**Constraints:**

- The owner approves every change that touches Supabase, including routine,
  already-reviewed ones (hard rule 5). Sessions that cannot show an approval
  prompt are already refused (#84).
- On a live school holding real data, database changes land only in the
  evening or at the weekend. App deploys are not bound by that window.
- Zero extra cost.
- The repository is public, so anything a workflow prints is public.
- Two project types with opposite rules: the demo must stay read-only after
  every change; a school project must never receive the demo lock.
- The demo project is linked to the Supabase↔GitHub integration.
- School projects will hold minors' records under Ley 8968.
- Project lifecycle: the demo and the pilot stay the only two projects until
  a school signs. Then the pilot is reworked or removed, and a dedicated
  school project takes its place.
- Time box: finished before the first G3 database change merges.

## MVP

**Re-deliver `incremental_conducta.sql` (merged in #63) to both existing
projects through the whole path:**

1. **Before.** Record each project's current state, which also settles
   whether #63 was ever delivered (evidence 7).
2. **Prepare and approve.** A session prepares the delivery; the owner
   approves it; nothing reaches Supabase without that approval.
3. **Deliver.** The change lands on the demo and the pilot.
4. **Prove, per project.** The access audit passes; the demo lock covers every
   table on the demo, `student_conduct_grades` included, and is absent from the
   pilot; the runbook's conducta check returns 0; the Edge Function and the
   Auth settings match the recorded expected state.
5. **Record.** Each project's state is recorded, and "what state is each
   project in?" is answered from that record in 10 minutes or less.
6. **Hold the order.** An app version that needs a database change does not
   reach a site before that change is proved on the site's project.
   Conducta's app half shipped on 7 Oct, so this has to be shown with another
   change (TBD — needs validation in `/plan-architecture`).

**Also in the MVP (app side):**

- Version tags and a changelog, so every production deploy maps to a recorded
  version.
- A change to when Vercel deploys, so step 6 can hold.
- Dependency and security scanning.

**In this epic, after the MVP:** `format:check` in CI; the two sites built
with the same settings.

**Not proved in the MVP:** provisioning (moment 2). No third project exists
before a school signs, at zero cost, so provisioning is proved on the first
school's own project.

**Doors** (owner-confirmed):

- **One-way, flagged for a spike in `/plan-architecture`:** a tracked
  migration history (it conflicts with the demo's Supabase↔GitHub
  integration); Supabase credentials held by CI in a public repository;
  anything that applies a change without the owner's approval (ruled out for
  Supabase by the guardrail); bringing the two existing projects to a known,
  recorded state when both contain objects created out of band; any write path
  into a project holding real minors' data.
- **Two-way, just build:** checks that only read; the per-project record;
  `format:check` in CI; dependency and security scanning; version tags and a
  changelog; matching the two sites' build settings; changing when Vercel
  deploys.

## Success metrics

| Metric                                                     | Target                                         | How measured                                                        |
| ---------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------- |
| G3 Supabase changes delivered through the path             | All; at most one bypass, with a written reason | Delivery record against merged PRs that touch `supabase/`           |
| Supabase changes without the owner's approval              | 0, ever                                        | Every delivery in the record shows its approval                     |
| Mismatch or access-rule gap reaching a live site           | 0 through G3                                   | Delivery record, audit results, incident notes                      |
| Merge to "proved on every project" for a routine change    | Within one evening window                      | Record timestamps; baseline from the MVP re-delivery                |
| Time to answer "what state is each project in?"            | 10 minutes or less                             | Timed from the record before a demo or onboarding                   |
| Production deploys that map to a recorded, checked version | All, from the MVP onward                       | Vercel deploy list against the version record                       |
| Database changes on a live school during class hours       | 0                                              | Record timestamps against the school's hours, from the first school |
| Hand-written SQL to provision the first school             | 0 statements                                   | The first school's provisioning record                              |
| Credentials or student data in a public log                | 0                                              | Review of every public log the path produces (method TBD)           |
| Extra cost                                                 | $0                                             | Vercel, Supabase and GitHub billing                                 |
| Epic finished before the first G3 database change merges   | Yes                                            | Dates                                                               |
| Known vulnerable dependencies at a release (secondary)     | TBD — needs validation (owner sets the bar)    | Scanning results at each release                                    |

## Non-goals

- Restores (`docs/BACKUP_RESTORE.md` §3 and §5): the drill and a real restore
  stay as documented.
- Bootstrapping a school's first admin and loading its data: out of band, as
  in the runbook.
- A third project before a school signs.
- Applying anything to Supabase without the owner's approval.
- A class-hours window for app deploys.
- Delivery for the landing page, portfolio projects, or the demo's seed
  content.
- Error monitoring (a separate G2 item).
- G3's own features.

## Open questions

**For the owner:**

- [ ] Did #63's `incremental_conducta.sql` reach both projects, and was
      `demo_lockdown.sql` re-run on the demo? (The runbook's check queries
      answer it; this becomes the MVP's "before" record.)
- [ ] Which rules does `main`'s ruleset enforce: required checks, reviews?
      Every branch reports as protected.
- [ ] Which Supabase plan is each project on? It decides backups, branching
      and how many projects can be active.
- [ ] Confirm three hypothesis choices taken at the interviewer's
      recommendation without an explicit answer: "the delivery path" instead
      of "a CD pipeline"; the version-and-order code-side signal; "one evening
      window" as the speed target.
- [ ] Class hours per school: what exact window counts as evenings and
      weekends, given that some schools teach on Saturdays (schedules support
      days 1–7)?
- [ ] When the first school signs, is the pilot reworked or removed, and what
      happens to its record?
- [ ] The severity bar for dependency and security findings.

**For `/plan-architecture` (one-way doors marked ⚠, each needing a spike):**

- [ ] ⚠ How the two existing projects reach a known, recorded state when both
      contain objects created out of band.
- [ ] ⚠ Whether a tracked migration history is used, given the demo's
      Supabase↔GitHub integration.
- [ ] ⚠ Where Supabase credentials live, and whether CI holds any, in a public
      repository.
- [ ] ⚠ Any write path into a project holding real minors' data.
- [ ] How the owner's approval is captured and enforced for every Supabase
      change, including one prepared by a session (#84).
- [ ] How an app deploy is held until its database change is proved on that
      site's project, with two Vercel projects deploying from one `main`; and
      which change demonstrates it in the MVP.
- [ ] How the Edge Function and Auth settings are captured, compared and
      delivered per project.
- [ ] How the demo lock is applied after every change on the demo, and proved
      absent on every school project.
- [ ] Whether `rls_audit.sql` can run without a live project, at zero cost.
- [ ] What "a recorded, checked version" is, and how each deploy maps to one.
- [ ] How public logs are kept free of credentials and student data.
- [ ] How provisioning is proved on the first school's project.
