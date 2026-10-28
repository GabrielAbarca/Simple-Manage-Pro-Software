import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promptSecret } from "./credential.mjs";
import { createManagementApiExecutor } from "./executors/managementApi.mjs";
import { proveAudit, proveNoAuditLeftovers } from "./proofs.mjs";
import { SCHEMA_DIR } from "./schemaHarness.mjs";

const PROJECT_REF = /^[a-z]{20}$/;
const USAGE =
  "usage: node scripts/delivery/audit.mjs <project-ref> [--test-data]";

/**
 * Runs `rls_audit.sql` on a real project through the Management API, then
 * counts the audit's fixture rows left behind.
 * @param {{ projectRef: string, holdsRealData: boolean, prompt?: (question: string) => Promise<string>, fetch?: typeof globalThis.fetch, out?: (line: string) => void, auditFile?: string }} options
 * @returns {Promise<boolean>}
 */
export async function runAudit({
  projectRef,
  holdsRealData,
  prompt = promptSecret,
  fetch = globalThis.fetch,
  out = (line) => process.stdout.write(`${line}\n`),
  auditFile = join(SCHEMA_DIR, "rls_audit.sql"),
}) {
  if (typeof projectRef !== "string" || !PROJECT_REF.test(projectRef)) {
    out(USAGE);
    return false;
  }
  const token = await prompt("Supabase personal access token: ");
  const executor = createManagementApiExecutor({
    projectRef,
    token,
    holdsRealData,
    fetch,
  });

  const audit = await proveAudit(executor, auditFile);
  if (audit.ok) {
    out(`RLS audit on ${projectRef}: PASS`);
  } else {
    const sqlstate = audit.sqlstate ? ` (SQLSTATE ${audit.sqlstate})` : "";
    out(`RLS audit on ${projectRef}: FAIL${sqlstate}: ${audit.error}`);
  }

  const leftovers = await proveNoAuditLeftovers(executor);
  out(
    leftovers.count === null
      ? `Audit fixture rows left behind: unknown (${leftovers.error})`
      : `Audit fixture rows left behind: ${leftovers.count}`,
  );
  return audit.ok && leftovers.ok;
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  const args = process.argv.slice(2);
  runAudit({
    projectRef: args.find((arg) => !arg.startsWith("--")),
    holdsRealData: !args.includes("--test-data"),
  }).then(
    (ok) => {
      process.exitCode = ok ? 0 : 1;
    },
    (error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    },
  );
}
