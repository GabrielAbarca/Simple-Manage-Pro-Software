/** @typedef {import("./executors/psql.mjs").Executor} Executor */

/**
 * @typedef {object} AuditProof
 * @property {boolean} ok
 * @property {string | null} check
 * @property {string | null} sqlstate
 * @property {string | null} error
 */

/**
 * @typedef {object} LockProof
 * @property {boolean} ok
 * @property {Record<string, number>} counts
 * @property {string[]} tables
 * @property {string | null} error
 */

/**
 * @typedef {object} LeftoverProof
 * @property {boolean} ok
 * @property {number | null} count
 * @property {string | null} error
 */

/** @typedef {"school" | "demo"} Shape */

export const AUDIT_SUMMARY = "RLS AUDIT: ALL CHECKS PASSED";

const AUDIT_PERSONAS = `('00000000-0000-4000-a000-00000000ad11',
     '00000000-0000-4000-a000-000000007ea1',
     '00000000-0000-4000-a000-000000007ea2',
     '00000000-0000-4000-a000-00000000c0a1',
     '00000000-0000-4000-a000-00000000c0b2')`;

export const AUDIT_LEFTOVERS_SQL = `select
  (select count(*) from auth.users
    where email like '%@rls-audit.invalid' or id in ${AUDIT_PERSONAS})
  + (select count(*) from public.profiles where id in ${AUDIT_PERSONAS})
  + (select count(*) from public.school_years where name = 'RLS Audit Year')
  + (select count(*) from public.grade_levels where name = 'RLS Audit Grade')
  + (select count(*) from public.subjects where code in ('RLSA', 'RLSA2'))
  + (select count(*) from public.teachers where email like '%@rls-audit.invalid')
  + (select count(*) from public.students where enrollment_number like 'RLS-%')
  + (select count(*) from public.rooms where name like 'RLS Audit Room%')
  + (select count(*) from public.grade_component_templates
      where name in ('RLS Audit Scheme', 'Audit Scheme 2'))
  as leftovers`;

const FAIL_LABEL = /^FAIL \[(.+?)\]/;

/** @type {Record<Shape, number>} */
const LOCKS_PER_TABLE = { school: 0, demo: 3 };

const LOCK_COUNTS_SQL = `select t.tablename, count(p.policyname)
  from pg_tables t
  left join pg_policies p
    on p.schemaname = t.schemaname
   and p.tablename = t.tablename
   and p.policyname like 'demo\\_deny\\_%'
 where t.schemaname = 'public'
 group by t.tablename
 order by t.tablename`;

/**
 * Passes only when `rls_audit.sql` ran to its summary line, read from the
 * notices (psql) or from the final result row (the Management API).
 * @param {Executor} executor
 * @param {string} auditFile
 * @returns {Promise<AuditProof>}
 */
export async function proveAudit(executor, auditFile) {
  const run = await executor.runFile(auditFile);
  const finished =
    run.notices.some((notice) => notice.includes(AUDIT_SUMMARY)) ||
    run.rows.some((row) => row[0] === AUDIT_SUMMARY);
  if (run.ok && finished) {
    return { ok: true, check: null, sqlstate: null, error: null };
  }
  return {
    ok: false,
    check: FAIL_LABEL.exec(run.error ?? "")?.[1] ?? null,
    sqlstate: run.sqlstate,
    error: run.error ?? "the audit ended without its summary line",
  };
}

/**
 * Passes only when none of the audit's fixture rows is left on the project.
 * @param {Executor} executor
 * @returns {Promise<LeftoverProof>}
 */
export async function proveNoAuditLeftovers(executor) {
  const run = await executor.runStatement(AUDIT_LEFTOVERS_SQL);
  if (!run.ok) {
    return { ok: false, count: null, error: run.error ?? "the count failed" };
  }
  const count = Number(run.rows[0]?.[0]);
  if (!Number.isInteger(count)) {
    return { ok: false, count: null, error: "the count returned no number" };
  }
  return { ok: count === 0, count, error: null };
}

/**
 * `demo_deny_*` policies on every public table, zero included.
 * @param {Executor} executor
 * @returns {Promise<{ counts: Record<string, number>, error: string | null }>}
 */
export async function demoLockCounts(executor) {
  const run = await executor.runStatement(LOCK_COUNTS_SQL);
  if (!run.ok) return { counts: {}, error: run.error };
  return {
    counts: Object.fromEntries(
      run.rows.map(([table, count]) => [table, Number(count)]),
    ),
    error: null,
  };
}

/**
 * A school project carries no demo lock; the demo carries three on every
 * public table.
 * @param {Executor} executor
 * @param {Shape} shape
 * @returns {Promise<LockProof>}
 */
export async function proveDemoLock(executor, shape) {
  const { counts, error } = await demoLockCounts(executor);
  const want = LOCKS_PER_TABLE[shape];
  const tables = Object.keys(counts)
    .filter((table) => counts[table] !== want)
    .sort();
  return {
    ok: !error && tables.length === 0 && Object.keys(counts).length > 0,
    counts,
    tables,
    error,
  };
}
