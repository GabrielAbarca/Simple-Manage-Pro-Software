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

/** @typedef {"school" | "demo"} Shape */

export const AUDIT_SUMMARY = "RLS AUDIT: ALL CHECKS PASSED";

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
 * Passes only when `rls_audit.sql` ran to its summary line.
 * @param {Executor} executor
 * @param {string} auditFile
 * @returns {Promise<AuditProof>}
 */
export async function proveAudit(executor, auditFile) {
  const run = await executor.runFile(auditFile);
  const finished = run.notices.some((notice) => notice.includes(AUDIT_SUMMARY));
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
