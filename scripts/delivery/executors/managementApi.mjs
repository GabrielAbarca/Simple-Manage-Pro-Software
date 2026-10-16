import { readFile } from "node:fs/promises";
import { parseMessages } from "./psql.mjs";

/** @typedef {import("./psql.mjs").Executor} Executor */
/** @typedef {import("./psql.mjs").ExecResult} ExecResult */

export const API_URL = "https://api.supabase.com";
export const WITHHELD = "message withheld (the project holds real data)";

const PROJECT_REF = /^[a-z]{20}$/;
const QUERY_FAILED = /^Failed to run sql query: /;

/**
 * One cell as `psql -A -t` prints it.
 * @param {unknown} value
 * @returns {string}
 */
function cell(value) {
  if (value === null || value === undefined) return "";
  if (value === true) return "t";
  if (value === false) return "f";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * @param {unknown} body
 * @returns {string[][]}
 */
function rowsOf(body) {
  if (!Array.isArray(body)) return [];
  return body.map((row) =>
    row && typeof row === "object" ? Object.values(row).map(cell) : [cell(row)],
  );
}

/**
 * @param {string} text
 * @returns {string}
 */
function messageOf(text) {
  try {
    const body = JSON.parse(text);
    if (body && typeof body.message === "string") return body.message;
  } catch {
    return text;
  }
  return text;
}

/**
 * Runs SQL on a real project through the Supabase Management API. Each call
 * is one request, so a file runs as one unit, and the token travels only in
 * that request's Authorization header.
 * @param {{ projectRef: string, token: string, holdsRealData: boolean, fetch?: typeof globalThis.fetch }} options
 * @returns {Executor}
 */
export function createManagementApiExecutor({
  projectRef,
  token,
  holdsRealData,
  fetch = globalThis.fetch,
}) {
  if (typeof projectRef !== "string" || !PROJECT_REF.test(projectRef)) {
    throw new TypeError("the project ref must be 20 lowercase letters");
  }
  if (typeof token !== "string" || token.length === 0) {
    throw new TypeError("the access token is missing");
  }
  if (typeof holdsRealData !== "boolean") {
    throw new TypeError("holdsRealData must be true or false");
  }
  const endpoint = `${API_URL}/v1/projects/${projectRef}/database/query`;

  /**
   * @param {string | null} sqlstate
   * @param {string} message
   * @param {number | null} status
   * @returns {ExecResult}
   */
  const failure = (sqlstate, message, status) => ({
    ok: false,
    sqlstate,
    error: holdsRealData
      ? status === null
        ? WITHHELD
        : `${WITHHELD} · HTTP ${status}`
      : message,
    notices: [],
    rows: [],
  });

  /**
   * @param {string} query
   * @returns {Promise<ExecResult>}
   */
  const run = async (query) => {
    let response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query }),
      });
    } catch (error) {
      return failure(
        null,
        error instanceof Error ? error.message : String(error),
        null,
      );
    }
    const text = await response.text();
    if (!response.ok) {
      const message = messageOf(text);
      const { error } = parseMessages(message.replace(QUERY_FAILED, ""));
      return error
        ? failure(error.sqlstate, error.message, response.status)
        : failure(null, `HTTP ${response.status}: ${message}`, response.status);
    }
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    return {
      ok: true,
      sqlstate: null,
      error: null,
      notices: [],
      rows: rowsOf(body),
    };
  };

  return {
    runFile: async (file) => run(await readFile(file, "utf8")),
    runStatement: (sql) => run(sql),
  };
}
