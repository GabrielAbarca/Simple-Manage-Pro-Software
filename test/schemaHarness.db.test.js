import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createPsqlExecutor } from "../scripts/delivery/executors/psql.mjs";
import {
  compareFingerprints,
  probeFingerprint,
  readExpectedFingerprint,
  serializeFingerprint,
} from "../scripts/delivery/fingerprint.mjs";
import { AUDIT_SUMMARY } from "../scripts/delivery/proofs.mjs";
import {
  SCHEMA_DIR,
  runSchemaHarness,
} from "../scripts/delivery/schemaHarness.mjs";

/**
 * Schema harness — opt-in, skipped unless SMP_SCHEMA_DB_URL is set.
 *
 * Point it at the `postgres` role of a fresh local server started by the
 * Supabase CLI, as CI's `schema` job does:
 *
 *   npx supabase db start --workdir scripts/delivery/harness
 *   SMP_SCHEMA_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
 *   npx vitest run test/schemaHarness.db.test.js
 *
 * Each test gets its own database, cloned from a pristine copy of `postgres`
 * that the first run makes with the CLI's local `supabase_admin` login.
 *
 * With SMP_FINGERPRINT_OUT set, the fresh fingerprints are also written there
 * as `school.json` and `demo.json`, ready to replace the committed ones.
 */

const serverUrl = process.env.SMP_SCHEMA_DB_URL;
const fingerprintOut = process.env.SMP_FINGERPRINT_OUT;
const TEMPLATE = "smp_harness_template";

/** @param {string} name */
const fixture = (name) =>
  fileURLToPath(new URL(`./fixtures/delivery/${name}`, import.meta.url));

/**
 * @param {string} database
 * @param {string} [user]
 */
function databaseUrl(database, user) {
  const url = new URL(serverUrl);
  url.pathname = `/${database}`;
  if (user) url.username = user;
  return url.toString();
}

/**
 * @param {string} url
 * @param {...string} statements
 */
function psql(url, ...statements) {
  return execFileSync(
    "psql",
    [
      "-X",
      "-q",
      "-A",
      "-t",
      "-v",
      "ON_ERROR_STOP=1",
      "-d",
      url,
      ...statements.flatMap((sql) => ["-c", sql]),
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

/** @param {string} out */
const lines = (out) => out.split("\n").filter(Boolean);

function ensureTemplate() {
  const admin = databaseUrl("template1", "supabase_admin");
  const exists = psql(
    admin,
    `select 1 from pg_database where datname = '${TEMPLATE}'`,
  );
  if (exists.trim()) return;
  for (let attempt = 1; ; attempt += 1) {
    try {
      psql(
        admin,
        "select pg_terminate_backend(pid) from pg_stat_activity where datname = 'postgres'",
        `create database ${TEMPLATE} template postgres is_template true`,
      );
      return;
    } catch (error) {
      if (attempt === 3) throw error;
    }
  }
}

let next = 0;
/** @type {string[]} */
const created = [];

function freshDatabase() {
  const name = `smp_harness_${process.pid}_${next++}`;
  psql(serverUrl, `create database ${name} template ${TEMPLATE}`);
  created.push(name);
  return databaseUrl(name);
}

describe.skipIf(!serverUrl)("schema harness", () => {
  beforeAll(ensureTemplate, 60_000);

  afterEach(() => {
    for (const name of created.splice(0)) {
      psql(serverUrl, `drop database if exists ${name} with (force)`);
    }
  });

  it("passes the committed baseline in the school and demo shapes", async () => {
    const url = freshDatabase();

    const result = await runSchemaHarness({
      executor: createPsqlExecutor({ databaseUrl: url }),
    });

    expect(result.school.audit).toMatchObject({ ok: true });
    expect(result.demo.audit).toMatchObject({ ok: true });

    const tables = lines(
      psql(
        url,
        "select tablename from pg_tables where schemaname = 'public' order by tablename",
      ),
    );
    const fullyLocked = lines(
      psql(
        url,
        `select tablename from pg_policies
          where schemaname = 'public'
            and policyname in ('demo_deny_insert', 'demo_deny_update', 'demo_deny_delete')
          group by tablename having count(*) = 3 order by tablename`,
      ),
    );
    expect(tables.length).toBeGreaterThan(0);
    expect(fullyLocked).toEqual(tables);

    expect(result.school.lock.ok).toBe(true);
    expect(result.school.lock.counts).toEqual(
      Object.fromEntries(tables.map((table) => [table, 0])),
    );
    expect(result.demo.lock.ok).toBe(true);
    expect(result.demo.lock.counts).toEqual(
      Object.fromEntries(tables.map((table) => [table, 3])),
    );
    expect(result.ok).toBe(true);
  }, 120_000);

  it("fails the school shape when the audit finds a missing access rule", async () => {
    const result = await runSchemaHarness({
      executor: createPsqlExecutor({ databaseUrl: freshDatabase() }),
      afterBaseline: [fixture("drop_student_self_read.sql")],
    });

    expect(result.school.audit).toMatchObject({
      ok: false,
      check: "student sees only their own student row",
    });
    expect(result.school.ok).toBe(false);
    expect(result.ok).toBe(false);
  }, 120_000);

  it("fails the demo shape when a table lacks its three demo locks", async () => {
    const result = await runSchemaHarness({
      executor: createPsqlExecutor({ databaseUrl: freshDatabase() }),
      afterLockdown: [fixture("unlock_guardians.sql")],
    });

    expect(result.demo.lock).toMatchObject({
      ok: false,
      tables: ["guardians"],
    });
    expect(result.demo.ok).toBe(false);
    expect(result.school.ok).toBe(true);
    expect(result.ok).toBe(false);
  }, 120_000);

  it("prints the summary row only when a plain psql run of the audit passes", async () => {
    const baseline = join(SCHEMA_DIR, "school_schema.sql");
    const plainAudit = (url) =>
      execFileSync(
        "psql",
        [
          "-X",
          "-q",
          "-A",
          "-t",
          "-d",
          url,
          "-f",
          join(SCHEMA_DIR, "rls_audit.sql"),
        ],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
    const passing = freshDatabase();
    const failing = freshDatabase();
    for (const [url, files] of [
      [passing, [baseline]],
      [failing, [baseline, fixture("drop_student_self_read.sql")]],
    ]) {
      const executor = createPsqlExecutor({ databaseUrl: url });
      for (const file of files) {
        expect((await executor.runFile(file)).ok).toBe(true);
      }
    }

    expect(lines(plainAudit(passing))).toContain(AUDIT_SUMMARY);
    expect(plainAudit(failing)).not.toContain(AUDIT_SUMMARY);
  }, 120_000);

  it("the committed expected fingerprints match a fresh install in both shapes", async () => {
    const executor = createPsqlExecutor({ databaseUrl: freshDatabase() });
    const shapes = [
      ["school", "school_schema.sql"],
      ["demo", "demo_lockdown.sql"],
    ];

    for (const [shape, file] of shapes) {
      expect((await executor.runFile(join(SCHEMA_DIR, file))).ok).toBe(true);
      const fresh = await probeFingerprint(executor);
      if (fingerprintOut) {
        mkdirSync(fingerprintOut, { recursive: true });
        writeFileSync(
          join(fingerprintOut, `${shape}.json`),
          serializeFingerprint(fresh),
        );
      }

      expect(Object.keys(fresh.objects).length).toBeGreaterThan(0);
      const committed = readExpectedFingerprint(shape);
      expect(compareFingerprints(committed, fresh)).toEqual({
        equal: true,
        added: [],
        removed: [],
        changed: [],
      });
      expect(committed.digest).toBe(fresh.digest);
    }
  }, 120_000);

  it("the probe reports a re-granted privilege, an extra enum label and a changed sequence", async () => {
    const executor = createPsqlExecutor({ databaseUrl: freshDatabase() });
    expect(
      (await executor.runFile(join(SCHEMA_DIR, "school_schema.sql"))).ok,
    ).toBe(true);
    const fresh = await probeFingerprint(executor);
    const freshKeys = Object.keys(fresh.objects);

    expect(freshKeys).toContain("type:public.user_role_enum");
    expect(freshKeys).toContain("sequence:public.students.id");
    expect(freshKeys).toContain("grant:public.teacher_id().authenticated");
    expect(
      freshKeys.filter((key) =>
        /^grant:public\.(teacher_id\(\)|teachers_directory)\.(anon|public)$/.test(
          key,
        ),
      ),
    ).toEqual([]);

    for (const statement of [
      "grant execute on function public.teacher_id() to anon",
      "alter type public.user_role_enum add value 'guardian'",
      "alter table public.students alter column id set increment by 10",
    ]) {
      expect((await executor.runStatement(statement)).ok).toBe(true);
    }

    expect(
      compareFingerprints(fresh, await probeFingerprint(executor)),
    ).toEqual({
      equal: false,
      added: [
        {
          key: "grant:public.teacher_id().anon",
          kind: "grant",
          name: "public.teacher_id().anon",
        },
      ],
      removed: [],
      changed: [
        {
          key: "sequence:public.students.id",
          kind: "sequence",
          name: "public.students.id",
        },
        {
          key: "type:public.user_role_enum",
          kind: "type",
          name: "public.user_role_enum",
        },
      ],
    });
  }, 120_000);
});
