import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createPsqlExecutor } from "../scripts/delivery/executors/psql.mjs";
import { runSchemaHarness } from "../scripts/delivery/schemaHarness.mjs";

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
 */

const serverUrl = process.env.SMP_SCHEMA_DB_URL;
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
});
