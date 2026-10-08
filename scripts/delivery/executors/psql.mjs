import { spawn } from "node:child_process";

/**
 * @typedef {object} ExecResult
 * @property {boolean} ok
 * @property {string | null} sqlstate
 * @property {string | null} error
 * @property {string[]} notices
 * @property {string[][]} rows
 */

/**
 * @typedef {object} Executor
 * @property {(file: string) => Promise<ExecResult>} runFile
 * @property {(sql: string) => Promise<ExecResult>} runStatement
 */

const MESSAGE =
  /^(?:psql:[^:]*:\d+: )?(ERROR|FATAL|WARNING|NOTICE|INFO):\s+(?:([0-9A-Z]{5}): )?(.*)$/;
const DROPPED = /^(?:LOCATION|CONTEXT|DETAIL|HINT|QUERY|STATEMENT|LINE \d+):/;
const FIELD = "\u001f";

/**
 * libpq environment for a `postgresql://` URL, so the password never reaches
 * the command line.
 * @param {string} databaseUrl
 * @returns {Record<string, string>}
 */
export function connectionEnv(databaseUrl) {
  const url = new URL(databaseUrl);
  /** @type {Record<string, string>} */
  const env = {
    PGHOST: url.hostname.replace(/^\[|\]$/g, ""),
    PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.replace(/^\//, "")),
  };
  const sslmode = url.searchParams.get("sslmode");
  if (sslmode) env.PGSSLMODE = sslmode;
  return env;
}

/**
 * @param {string} stderr
 * @returns {{ notices: string[], error: { sqlstate: string | null, message: string } | null }}
 */
export function parseMessages(stderr) {
  /** @type {{ level: string, sqlstate: string | null, message: string }[]} */
  const messages = [];
  for (const line of stderr.split("\n")) {
    const match = MESSAGE.exec(line);
    if (match) {
      messages.push({
        level: match[1],
        sqlstate: match[2] ?? null,
        message: match[3],
      });
    } else if (line.trim() && !DROPPED.test(line) && messages.length) {
      messages[messages.length - 1].message += `\n${line}`;
    }
  }
  const failure = messages.find(
    (m) => m.level === "ERROR" || m.level === "FATAL",
  );
  return {
    notices: messages.filter((m) => m.level === "NOTICE").map((m) => m.message),
    error: failure
      ? { sqlstate: failure.sqlstate, message: failure.message }
      : null,
  };
}

/**
 * Runs SQL through `psql` with ON_ERROR_STOP, so the first error ends the run.
 * @param {{ databaseUrl: string, psql?: string }} options
 * @returns {Executor}
 */
export function createPsqlExecutor({ databaseUrl, psql = "psql" }) {
  /**
   * @param {string[]} args
   * @returns {Promise<ExecResult>}
   */
  const run = (args) =>
    new Promise((resolve) => {
      const child = spawn(
        psql,
        [
          "-X",
          "-q",
          "-A",
          "-t",
          "-F",
          FIELD,
          "-v",
          "ON_ERROR_STOP=1",
          "-v",
          "VERBOSITY=verbose",
          ...args,
        ],
        { env: { ...process.env, ...connectionEnv(databaseUrl) } },
      );
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => (stdout += chunk));
      child.stderr.on("data", (chunk) => (stderr += chunk));
      child.on("error", (error) =>
        resolve({
          ok: false,
          sqlstate: null,
          error: error.message,
          notices: [],
          rows: [],
        }),
      );
      child.on("close", (code) => {
        const { notices, error } = parseMessages(stderr);
        const lastLine =
          stderr
            .split("\n")
            .filter((line) => line.trim())
            .pop() ?? null;
        resolve({
          ok: code === 0 && !error,
          sqlstate: error?.sqlstate ?? null,
          error: error?.message ?? (code === 0 ? null : lastLine),
          notices,
          rows: stdout
            .split("\n")
            .filter(Boolean)
            .map((line) => line.split(FIELD)),
        });
      });
    });

  return {
    runFile: (file) => run(["-f", file]),
    runStatement: (sql) => run(["-c", sql]),
  };
}
