# Plan — Pull the schema job's database images without hitting ECR Public's rate limit

**Implements:** #112 · **Epic:** none (CI bug) · **Branch:** fix/schema-image-pulls
**Status:** Draft
**Red commit:** <short sha of the newest `Add failing checks for` commit, filled at approval>
**Confidence:** 8/10 that one unattended pass reaches a green PR

> Validate every pattern and path below against the code before acting on it.

## Issue

#112 Pull the schema job's database images without hitting ECR Public's rate
limit · reported: the `schema · baseline and access audit` job dies in
`npx supabase db start` with `toomanyrequests: Data limit exceeded` pulling
`public.ecr.aws/supabase/postgres:17.6.1.132`, before any test runs · expected:
the job does not depend on ECR Public's anonymous quota and still uses no
secret · portal / role / lang / mode: none (CI) · reproduced: yes, from the
logs of PR #111's run 39011514359 job 117334844985 (and run 39014391990 job
117343366918). The local stack itself is not run in this session (the guard
refuses `supabase` CLI commands); CI's `schema` job is the proof.

## Assessment

| Metric     | Value  | Reason                                                                                                                                |
| ---------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Severity   | Medium | Blocks merging any PR until someone re-runs the job; a re-run passes, so there is a workaround; CI only, no user impact               |
| Complexity | Low    | One workflow file, one env line; no app code, nothing under `supabase/`                                                               |
| Confidence | High   | The CLI's registry override and the mirror's tag were both checked directly (evidence below); the end-to-end proof is the PR's CI run |

## Root cause

```
WHY does the schema job fail?
  → `npx supabase db start` exits 1 after three failed pulls of the postgres image
    (evidence: job 117334844985 log — "failed to pull docker image: Error response
    from daemon: toomanyrequests: Data limit exceeded", retried after 4s and 8s)
WHY does the pull fail?
  → the image is pulled anonymously from public.ecr.aws, whose anonymous quota is
    per source IP and shared by every GitHub-hosted runner behind that IP
    (evidence: "Retrying after 8s: public.ecr.aws/supabase/postgres:17.6.1.132")
WHY public.ecr.aws?
  → it is the Supabase CLI's default registry: `npx supabase` resolves to the
    devDependency supabase@2.104.0 (package.json:46), whose shim
    (node_modules/supabase/dist/supabase.js) execs
    @supabase/cli-linux-x64/bin/supabase; `db start` is a legacy command that
    hands off to the bundled Go binary `supabase-go`, which builds image refs as
    `<registry>/supabase/<image>:<tag>` with the registry read from viper key
    INTERNAL_IMAGE_REGISTRY (env `SUPABASE_INTERNAL_IMAGE_REGISTRY`), defaulting
    to public.ecr.aws (evidence: `strings supabase-go` contains
    INTERNAL_IMAGE_REGISTRY and public.ecr.aws)
ROOT CAUSE: .github/workflows/ci.yml:54–66 — the `schema` job sets no registry,
  so every run pulls anonymously from ECR Public and fails whenever the shared
  quota is spent.
```

Introduced: 93c558b (Prove the schema baseline and the access audit in CI,
#107), the commit that added the job. Original behaviour of the job, not a
regression. No other job pulls Supabase images.

## Fix strategy

Set `SUPABASE_INTERNAL_IMAGE_REGISTRY: ghcr.io` in the `schema` job's `env`.
The CLI then pulls `ghcr.io/supabase/postgres:17.6.1.132`, a public GHCR
package that needs no login. The TypeScript layer of the same CLI already lists
`public.ecr.aws/supabase/…`, `supabase/…` and `ghcr.io/supabase/…` as
interchangeable mirrors, and an anonymous registry check confirmed the tag
exists on ghcr.io (manifest HEAD → 200). GHCR sits inside GitHub's network,
which makes it the registry least likely to throttle a GitHub-hosted runner.

Alternatives considered:

- **Docker Hub (`docker.io`)**: also supported by the override, but its
  anonymous pull limit is per IP as well, the same problem in another place.
- **`actions/cache` with `docker save`/`docker load`**: would make the job
  survive the quota on a warm cache, but a cold cache (first run, a new CLI
  version or image tag, eviction after 7 days) still pulls from ECR Public.
  It also needs ~40 lines of image-list plumbing and a ~1 GB tarball per run.
  It doesn't remove the dependency, so it's not done.
- **Pre-pull with retries/backoff**: the CLI already retries twice (4s, 8s).
  ECR Public's data limit doesn't clear within minutes, so more retries only
  make the job slower before it fails.

Combining isn't needed: the override removes the dependency on ECR Public
outright, and it's one line. If GHCR ever throttles, caching is the follow-up.

Risks: a future CLI bump to an image tag that isn't mirrored on ghcr.io would
fail the pull visibly in the same step (Supabase publishes every tag to all
three registries). The variable is internal to the CLI, which could rename it.
The job would then fall back to ECR Public, not break. `quality` and `e2e` are
untouched.

## Out of scope

- Not changing: the `quality` and `e2e` jobs; anything under `supabase/`;
  `scripts/delivery/harness/supabase/config.toml` (no setting there is needed).
- Not included: image caching (see Fix strategy).

## Phase R — acceptance checks, red before any change

| AC  | Behaviour                                                                       | Kind   | Where (file › test name)                                                                          | Command                                                                                                           | Expected red                       |
| --- | ------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| AC1 | The schema job pulls from a registry other than ECR Public, with no secret      | unit   | `test/ciWorkflow.test.js` › "pulls the schema job's images from a registry other than ECR Public" | `npx vitest run test/ciWorkflow.test.js -t "pulls the schema job's images from a registry other than ECR Public"` | `expected undefined to be defined` |
| AC2 | The `schema` job passes on the fix's PR, pulling postgres from the new registry | verify | GitHub Actions, the PR's CI run                                                                   | the PR's `schema · baseline and access audit` job                                                                 | evidence only                      |

The red check can't exercise a real image pull: a unit test can't start Docker,
and the guard refuses `supabase` CLI commands in this session. AC1 therefore
asserts the workflow's shape (the override is set in the `schema` job, to a
registry the CLI mirrors to, with no secret), and AC2 is the real proof.

**Verify scenarios:**

- AC2: GitHub Actions · the fix PR's CI run · the `schema` job's
  `supabase db start` step pulls `ghcr.io/supabase/postgres:…` (not
  `public.ecr.aws`) and `test/schemaHarness.db.test.js` passes.

**Red evidence:**

- AC1: `npx vitest run test/ciWorkflow.test.js` →
  `AssertionError: expected undefined to be defined` at
  `test/ciWorkflow.test.js:81` (`expect(registry).toBeDefined()`) ✅ valid red;
  the other five tests in the file pass.

## Implementation tasks

### 1. ADD `SUPABASE_INTERNAL_IMAGE_REGISTRY: ghcr.io` to the `schema` job's `env` in `.github/workflows/ci.yml`

- **Implement:** one line beside `SMP_SCHEMA_DB_URL`.
- **Gotcha:** job-level `env` (not step-level) so any later CLI step in the job
  uses the same registry; no `secrets.` anywhere in the job.
- **Validate:** `npx vitest run test/ciWorkflow.test.js`
- **Satisfies:** AC1, AC2

### 2. Turn Phase R green

- **Validate:** AC1's command passes; AC2 is read from the PR's CI run.

## Validation commands

```bash
npm run format:check && npm run lint && npm run typecheck
npm test
npm run build
npm run test:e2e
```

## Open questions / assumptions

1. ghcr.io or docker.io? — **Default:** ghcr.io (GitHub-hosted, so not
   subject to Docker Hub's per-IP anonymous limit).
2. Also add an image cache? — **Default:** no; revisit only if GHCR throttles.

## Notes

The prime step (`/prime-backend`) was skipped: the change is to the CI workflow
only and touches no app data seam.

## AMENDMENTS

Append-only. Every change to this plan or to a frozen acceptance test after the
red commit goes here: date — what changed — why.

- (none)

## Manual Supabase steps

- None.

## Validation

## Execution report
