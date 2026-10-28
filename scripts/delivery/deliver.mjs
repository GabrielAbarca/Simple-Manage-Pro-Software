import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promptSecret } from "./credential.mjs";
import { createManagementApiExecutor } from "./executors/managementApi.mjs";
import { probeFingerprint } from "./fingerprint.mjs";
import { loadManifest, loadProjects, unitsFor } from "./manifest.mjs";
import { proveAudit, proveDemoLock, proveNoAuditLeftovers } from "./proofs.mjs";
import {
  RECORDS_DIR,
  appendEntry,
  readProjectState,
  validateEntry,
} from "./record.mjs";
import { SCHEMA_DIR } from "./schemaHarness.mjs";
import { windowRefusal } from "./window.mjs";

/** @typedef {import("./executors/psql.mjs").Executor} Executor */
/** @typedef {import("./manifest.mjs").Manifest} Manifest */
/** @typedef {import("./manifest.mjs").Project} Project */
/** @typedef {import("./manifest.mjs").ProjectList} ProjectList */
/** @typedef {import("./manifest.mjs").Unit} Unit */
/** @typedef {import("./record.mjs").ProofEntry} ProofEntry */

/**
 * @typedef {object} Failure
 * @property {string} unit
 * @property {string} proof
 * @property {string | null} sqlstate
 */

/**
 * @typedef {object} DeliveryResult
 * @property {boolean} ok
 * @property {string | null} reason
 * @property {string[]} delivered
 * @property {Failure | null} failure
 * @property {string | null} branch
 */

/**
 * @typedef {object} RecordChange
 * @property {Project} project
 * @property {string} file
 * @property {string[]} units
 */

/**
 * @typedef {object} PreparedCommit
 * @property {string | null} branch
 * @property {string | null} [reason]
 */

/**
 * @typedef {object} DeliverOptions
 * @property {string} project
 * @property {NodeJS.ReadableStream & { isTTY?: boolean }} [input]
 * @property {NodeJS.WritableStream} [output]
 * @property {(project: Project) => Promise<Executor>} [connect]
 * @property {string} [approver]
 * @property {() => Date} [now]
 * @property {Manifest} [manifest]
 * @property {ProjectList} [projects]
 * @property {string} [recordsDir]
 * @property {string} [schemaDir]
 * @property {(change: RecordChange) => Promise<PreparedCommit>} [prepareCommit]
 * @property {(line: string) => void} [out]
 */

/**
 * @typedef {object} ProofStep
 * @property {boolean} ok
 * @property {string | null} [sqlstate]
 * @property {string | null} [detail]
 */

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const LOCKDOWN = "demo_lockdown.sql";
const AUDIT = "rls_audit.sql";
const BRANCH =
  /^(feat|fix|docs|chore|refactor|test)\/[a-z0-9]+(-[a-z0-9]+){1,2}$/;
const EPOCH = "1970-01-01T00:00:00.000Z";
const PLACEHOLDER_HASH = "0".repeat(64);
const USAGE = "usage: npm run deliver -- <project>";

/**
 * The schema-version marker, the delivery's only data write.
 * @param {number} sequence
 * @returns {string}
 */
export const markerStatement = (sequence) =>
  `insert into public.app_config (key, value) values ('schema_version', '${sequence}') on conflict (key) do update set value = excluded.value;`;

/**
 * The branch the record commit goes on, or null when the project's name
 * can't make one that fits the branch rule.
 * @param {string} name
 * @returns {string | null}
 */
export function recordBranch(name) {
  const branch = `chore/record-${name}`;
  return BRANCH.test(branch) ? branch : null;
}

/**
 * @param {Buffer} bytes
 * @returns {string}
 */
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/**
 * @param {Project} project
 * @param {Unit} unit
 * @returns {string[]}
 */
const filesOf = (project, unit) =>
  project.type === "demo" ? [...unit.files, LOCKDOWN] : [...unit.files];

/**
 * @param {Unit} unit
 * @returns {string[]}
 */
const proofNames = (unit) => [
  "apply",
  "demo-lock",
  "audit",
  "audit-leftovers",
  ...unit.checks.map((check) => `check.${check.id}`),
  "marker",
];

/**
 * Runs every pending unit's entry through the record writer's own rules with
 * placeholder hashes, so an approver or name it would refuse stops the run
 * before anything is applied.
 * @param {Project} project
 * @param {Unit[]} units
 * @param {string} approver
 * @returns {string | null}
 */
function recordProblem(project, units, approver) {
  try {
    for (const unit of units) {
      validateEntry(project, {
        kind: "delivery",
        units: [
          {
            id: unit.id,
            sequence: unit.seq,
            files: filesOf(project, unit).map((file) => ({
              path: `supabase/schema/${file}`,
              sha256: PLACEHOLDER_HASH,
            })),
          },
        ],
        startedAt: EPOCH,
        endedAt: EPOCH,
        approver,
        fingerprint: { before: PLACEHOLDER_HASH, after: null },
        proofs: proofNames(unit).map((name) => ({ name, ok: true })),
      });
    }
    return null;
  } catch (error) {
    return `the record would refuse this delivery: ${error.message}`;
  }
}

/**
 * One line from `input`, or what it held when it ended without one.
 * @param {NodeJS.ReadableStream} input
 * @returns {Promise<string>}
 */
function readLine(input) {
  return new Promise((done, fail) => {
    let text = "";
    const stop = () => {
      input.removeListener("data", onData);
      input.removeListener("end", onEnd);
      input.removeListener("error", onError);
      input.pause();
    };
    /** @param {Buffer | string} chunk */
    function onData(chunk) {
      text += String(chunk);
      const end = text.indexOf("\n");
      if (end >= 0) {
        stop();
        done(text.slice(0, end));
      }
    }
    function onEnd() {
      stop();
      done(text);
    }
    /** @param {Error} error */
    function onError(error) {
      stop();
      fail(error);
    }
    input.on("data", onData);
    input.on("end", onEnd);
    input.on("error", onError);
    input.resume();
  });
}

/**
 * @param {Project} project
 * @returns {Promise<Executor>}
 */
async function connectManagementApi(project) {
  const token = await promptSecret("Supabase personal access token: ");
  return createManagementApiExecutor({
    projectRef: project.ref,
    token,
    holdsRealData: project.holdsRealData,
  });
}

/**
 * @param {string[]} args
 * @returns {string}
 */
const git = (...args) =>
  execFileSync("git", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

/** @returns {string} */
function gitApprover() {
  try {
    return `${git("config", "user.name")} <${git("config", "user.email")}>`;
  } catch {
    return "";
  }
}

/**
 * @param {(...args: string[]) => string} run
 * @param {string[]} args
 * @returns {boolean}
 */
function succeeds(run, ...args) {
  try {
    run(...args);
    return true;
  } catch {
    return false;
  }
}

/**
 * Commits only the record file on a new branch cut from `origin/main`, for
 * the owner's PR. It never pushes.
 * @param {RecordChange} change
 * @param {(...args: string[]) => string} [run]
 * @returns {Promise<PreparedCommit>}
 */
export async function prepareRecordCommit({ project, file, units }, run = git) {
  const branch = recordBranch(project.name);
  if (!branch) {
    return {
      branch: null,
      reason: `chore/record-${project.name} does not fit the branch rule`,
    };
  }
  try {
    run("rev-parse", "--verify", "--quiet", `refs/heads/${branch}`);
    return { branch: null, reason: `branch ${branch} already exists` };
  } catch {
    succeeds(run, "fetch", "origin", "main");
    try {
      run("switch", "-c", branch, "origin/main");
      run("add", "--", file);
      run(
        "commit",
        "-m",
        `Record the delivery of ${units.join(", ")} to ${project.name}`,
        "--only",
        "--",
        file,
      );
      return { branch, reason: null };
    } catch (error) {
      return { branch: null, reason: error.message };
    }
  }
}

/**
 * Applies one unit, proves it, writes the marker, and appends its entry.
 * Stops at the first step that fails.
 * @param {{ executor: Executor, project: Project, unit: Unit, schemaDir: string, recordsDir: string, approver: string, now: () => Date, out: (line: string) => void }} context
 * @returns {Promise<{ failure: Failure | null, marked: boolean, unrecorded: string | null }>}
 */
async function deliverUnit({
  executor,
  project,
  unit,
  schemaDir,
  recordsDir,
  approver,
  now,
  out,
}) {
  const startedAt = now().toISOString();
  const before = (await probeFingerprint(executor)).digest;
  const files = filesOf(project, unit);
  const hashed = [];
  for (const file of files) {
    hashed.push({
      path: `supabase/schema/${file}`,
      sha256: sha256(await readFile(join(schemaDir, file))),
    });
  }

  /** @type {[string, () => Promise<ProofStep>][]} */
  const steps = [
    [
      "apply",
      async () => {
        for (const file of files) {
          const run = await executor.runFile(join(schemaDir, file));
          if (!run.ok) {
            return {
              ok: false,
              sqlstate: run.sqlstate,
              detail: `${file}: ${run.error}`,
            };
          }
        }
        return { ok: true };
      },
    ],
    [
      "demo-lock",
      async () => {
        const lock = await proveDemoLock(executor, project.type);
        return {
          ok: lock.ok,
          detail:
            lock.error ?? `tables off the lock: ${lock.tables.join(", ")}`,
        };
      },
    ],
    [
      "audit",
      async () => {
        const audit = await proveAudit(executor, join(schemaDir, AUDIT));
        return { ok: audit.ok, sqlstate: audit.sqlstate, detail: audit.error };
      },
    ],
    [
      "audit-leftovers",
      async () => {
        const left = await proveNoAuditLeftovers(executor);
        return {
          ok: left.ok,
          detail: left.error ?? `${left.count} fixture rows left`,
        };
      },
    ],
    ...unit.checks.map(
      (check) =>
        /** @type {[string, () => Promise<ProofStep>]} */ ([
          `check.${check.id}`,
          async () => {
            const run = await executor.runStatement(check.sql);
            const got = run.ok ? Number(run.rows[0]?.[0]) : null;
            return {
              ok: run.ok && got === check.expect,
              sqlstate: run.sqlstate,
              detail: run.ok
                ? `returned ${run.rows[0]?.[0] ?? "no row"}, expected ${check.expect}`
                : run.error,
            };
          },
        ]),
    ),
    [
      "marker",
      async () => {
        const run = await executor.runStatement(markerStatement(unit.seq));
        return { ok: run.ok, sqlstate: run.sqlstate, detail: run.error };
      },
    ],
  ];

  /** @type {ProofEntry[]} */
  const proofs = [];
  /** @type {Failure | null} */
  let failure = null;
  for (const [name, prove] of steps) {
    const step = await prove();
    proofs.push({ name, ok: step.ok });
    if (step.ok) {
      out(`  ${name}: pass`);
      continue;
    }
    const sqlstate = step.sqlstate ?? null;
    out(
      `  ${name}: FAIL${sqlstate ? ` (SQLSTATE ${sqlstate})` : ""}${step.detail ? `: ${step.detail}` : ""}`,
    );
    failure = { unit: unit.id, proof: name, sqlstate };
    break;
  }

  const marked = proofs.some((proof) => proof.name === "marker" && proof.ok);
  try {
    await appendEntry(recordsDir, project, {
      kind: "delivery",
      units: [{ id: unit.id, sequence: unit.seq, files: hashed }],
      startedAt,
      endedAt: now().toISOString(),
      approver,
      fingerprint: { before, after: null },
      proofs,
      ...(failure
        ? { failure: { unit: failure.unit, sqlstate: failure.sqlstate } }
        : {}),
    });
  } catch (error) {
    return { failure, marked, unrecorded: error.message };
  }
  return { failure, marked, unrecorded: null };
}

/**
 * Delivers a project's pending units once the owner has typed its ref at a
 * terminal: applies them in manifest order (each followed by the demo lock on
 * the demo), proves each, writes the schema-version marker, records the
 * result and prepares the record commit.
 * @param {DeliverOptions} options
 * @returns {Promise<DeliveryResult>}
 */
export async function deliver({
  project: name,
  input = process.stdin,
  output = process.stderr,
  connect = connectManagementApi,
  approver,
  now = () => new Date(),
  manifest,
  projects,
  recordsDir = join(REPO_ROOT, RECORDS_DIR),
  schemaDir = SCHEMA_DIR,
  prepareCommit = prepareRecordCommit,
  out = (line) => process.stdout.write(`${line}\n`),
}) {
  /** @type {string[]} */
  const delivered = [];
  /**
   * @param {string} reason
   * @param {Partial<DeliveryResult>} [rest]
   * @returns {DeliveryResult}
   */
  const refuse = (reason, rest = {}) => {
    out(`Refused: ${reason}`);
    return {
      ok: false,
      reason,
      delivered,
      failure: null,
      branch: null,
      ...rest,
    };
  };

  const list = projects ?? loadProjects();
  const project = list.projects.find((entry) => entry.name === name);
  if (!project) {
    const known = list.projects.map((entry) => entry.name).join(", ");
    return refuse(`unknown project ${JSON.stringify(name)} (known: ${known})`);
  }

  const closed = windowRefusal(project, now());
  if (closed) return refuse(closed);

  const units = unitsFor(
    manifest ?? loadManifest(),
    project.type,
    (await readProjectState(recordsDir, project.name)).provedSequence,
  );
  const identity = approver ?? gitApprover();
  const problem = recordProblem(project, units, identity);
  if (problem) return refuse(problem);
  if (units.length === 0) {
    out(`Nothing pending for ${project.name}.`);
    return { ok: true, reason: null, delivered, failure: null, branch: null };
  }

  out(
    `Delivery to ${project.name} (${project.type} project, ref ${project.ref}), as ${identity}:`,
  );
  for (const unit of units) {
    const files = filesOf(project, unit).join(", then ");
    const checks = unit.checks.map((check) => check.id).join(", ") || "none";
    out(`  ${unit.seq}. ${unit.id}: ${files} · checks: ${checks}`);
  }

  if (!input.isTTY) {
    return refuse("the ref confirmation needs a terminal; nothing was applied");
  }
  output.write(`Type ${project.name}'s project ref to apply these units: `);
  const typed = (await readLine(input)).trim();
  if (typed !== project.ref) {
    return refuse(
      `the typed ref does not match ${project.name}'s; nothing was applied`,
    );
  }

  const stillClosed = windowRefusal(project, now());
  if (stillClosed) return refuse(stillClosed);

  let executor;
  try {
    executor = await connect(project);
  } catch (error) {
    return refuse(`could not connect to ${project.name}: ${error.message}`);
  }

  /** @type {string[]} */
  const recorded = [];
  /** @type {Failure | null} */
  let failure = null;
  /** @type {string | null} */
  let stopped = null;
  for (const unit of units) {
    const closedNow = windowRefusal(project, now());
    if (closedNow) {
      stopped = closedNow;
      out(`Unit ${unit.seq} ${unit.id} not started: ${closedNow}`);
      break;
    }
    out(`Unit ${unit.seq} ${unit.id}:`);
    let outcome;
    try {
      outcome = await deliverUnit({
        executor,
        project,
        unit,
        schemaDir,
        recordsDir,
        approver: identity,
        now,
        out,
      });
    } catch (error) {
      stopped = `unit ${unit.id} stopped before any marker or record: ${error.message}`;
      out(`  ${stopped}`);
      break;
    }
    if (outcome.unrecorded) {
      stopped = outcome.marked
        ? `the marker for ${unit.id} was written, but its record entry was refused: ${outcome.unrecorded}`
        : `unit ${unit.id} was not recorded: ${outcome.unrecorded}`;
      out(`  ${stopped}`);
      break;
    }
    failure = outcome.failure;
    recorded.push(unit.id);
    if (failure) break;
    delivered.push(unit.id);
  }

  let branch = null;
  if (recorded.length > 0) {
    const file = join(recordsDir, `${project.name}.json`);
    const commit = await prepareCommit({ project, file, units: recorded });
    branch = commit.branch;
    if (branch) {
      out(
        `Record committed on ${branch}. Push it and open its PR: git push -u origin ${branch}`,
      );
    } else {
      out(
        `The record is in ${file}, but its commit was not prepared (${commit.reason}). Commit that file alone on a new branch and open its PR.`,
      );
    }
  }

  const ok = !failure && !stopped;
  out(
    ok
      ? `Delivered ${delivered.join(", ")} to ${project.name}.`
      : failure
        ? `Stopped: ${failure.unit} failed ${failure.proof}. No marker was written for it.`
        : `Stopped: ${stopped}.`,
  );
  return {
    ok,
    reason: ok ? null : (stopped ?? `${failure.unit} failed ${failure.proof}`),
    delivered,
    failure,
    branch,
  };
}

/**
 * The command line: exactly one argument, the project's name. No flag is
 * accepted, so nothing can override a refusal.
 * @param {string[]} argv
 * @param {Partial<DeliverOptions>} [deps]
 * @returns {Promise<boolean>}
 */
export async function main(argv, deps = {}) {
  const out = deps.out ?? ((line) => process.stdout.write(`${line}\n`));
  if (argv.length !== 1 || argv[0].startsWith("-")) {
    out(USAGE);
    return false;
  }
  const result = await deliver({ ...deps, project: argv[0] });
  return result.ok;
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  main(process.argv.slice(2)).then(
    (ok) => {
      process.exitCode = ok ? 0 : 1;
    },
    (error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    },
  );
}
