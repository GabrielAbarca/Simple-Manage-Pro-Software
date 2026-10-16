/** @typedef {import("./psql.mjs").Executor} Executor */
/** @typedef {import("./psql.mjs").ExecResult} ExecResult */

/**
 * @param {{ projectRef: string, token: string, holdsRealData: boolean, fetch?: typeof globalThis.fetch }} options
 * @returns {Executor}
 */
export function createManagementApiExecutor(options) {
  void options;
  /** @returns {Promise<ExecResult>} */
  const notRun = async () => ({
    ok: false,
    sqlstate: null,
    error: null,
    notices: [],
    rows: [],
  });
  return { runFile: notRun, runStatement: notRun };
}
