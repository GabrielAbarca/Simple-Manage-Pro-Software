import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { proveAudit, proveDemoLock } from "./proofs.mjs";

/** @typedef {import("./executors/psql.mjs").Executor} Executor */
/** @typedef {import("./proofs.mjs").AuditProof} AuditProof */
/** @typedef {import("./proofs.mjs").LockProof} LockProof */
/** @typedef {import("./proofs.mjs").Shape} Shape */

/**
 * @typedef {object} ApplyStep
 * @property {boolean} ok
 * @property {string} file
 * @property {string | null} sqlstate
 * @property {string | null} error
 */

/**
 * @typedef {object} ShapeResult
 * @property {boolean} ok
 * @property {ApplyStep[]} applied
 * @property {LockProof} lock
 * @property {AuditProof} audit
 */

/**
 * @typedef {object} HarnessResult
 * @property {boolean} ok
 * @property {ShapeResult} school
 * @property {ShapeResult} demo
 */

export const SCHEMA_DIR = fileURLToPath(
  new URL("../../supabase/schema/", import.meta.url),
);

const NOT_RUN = "not run: the school shape did not apply";

/**
 * @param {string} error
 * @returns {ShapeResult}
 */
function notRun(error) {
  return {
    ok: false,
    applied: [],
    lock: { ok: false, counts: {}, tables: [], error },
    audit: { ok: false, check: null, sqlstate: null, error },
  };
}

/**
 * @param {Executor} executor
 * @param {Shape} shape
 * @param {string[]} files
 * @param {string} auditFile
 * @returns {Promise<ShapeResult>}
 */
async function runShape(executor, shape, files, auditFile) {
  /** @type {ApplyStep[]} */
  const applied = [];
  for (const file of files) {
    const run = await executor.runFile(file);
    applied.push({
      ok: run.ok,
      file,
      sqlstate: run.sqlstate,
      error: run.error,
    });
    if (!run.ok) {
      const failed = `not run: ${file} did not apply`;
      return { ...notRun(failed), applied };
    }
  }
  const lock = await proveDemoLock(executor, shape);
  const audit = await proveAudit(executor, auditFile);
  return { ok: lock.ok && audit.ok, applied, lock, audit };
}

/**
 * Applies the baseline and proves the school shape, then applies the demo
 * lock and proves the demo shape, on one throwaway database.
 * @param {{ executor: Executor, schemaDir?: string, afterBaseline?: string[], afterLockdown?: string[] }} options
 * @returns {Promise<HarnessResult>}
 */
export async function runSchemaHarness({
  executor,
  schemaDir = SCHEMA_DIR,
  afterBaseline = [],
  afterLockdown = [],
}) {
  const auditFile = join(schemaDir, "rls_audit.sql");
  const school = await runShape(
    executor,
    "school",
    [join(schemaDir, "school_schema.sql"), ...afterBaseline],
    auditFile,
  );
  const demo = school.applied.every((step) => step.ok)
    ? await runShape(
        executor,
        "demo",
        [join(schemaDir, "demo_lockdown.sql"), ...afterLockdown],
        auditFile,
      )
    : notRun(NOT_RUN);
  return { ok: school.ok && demo.ok, school, demo };
}
