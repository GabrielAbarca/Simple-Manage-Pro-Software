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

/** @type {ExecResult} */
const NOT_RUN = {
  ok: false,
  sqlstate: null,
  error: null,
  notices: [],
  rows: [],
};

/**
 * @returns {Executor}
 */
export function createPsqlExecutor() {
  return {
    runFile: async () => NOT_RUN,
    runStatement: async () => NOT_RUN,
  };
}
