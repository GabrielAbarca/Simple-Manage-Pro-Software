export const RECORDS_DIR = "supabase/delivery/records";

export class RecordError extends Error {}

/**
 * @param {string} dir
 * @param {{ name: string, holdsRealData: boolean }} project
 * @param {object} entry
 * @returns {Promise<object | null>}
 */
export async function appendEntry(dir, project, entry) {
  void dir;
  void project;
  void entry;
  return null;
}

/**
 * @param {string} dir
 * @param {string} name
 * @returns {Promise<{ project: string, entries: object[] }>}
 */
export async function readRecord(dir, name) {
  void dir;
  return { project: name, entries: [] };
}

/**
 * @param {string} dir
 * @param {string} name
 * @returns {Promise<{ provedSequence: number, latestProofs: object | null, openBypasses: object[], exceptions: object[] }>}
 */
export async function readProjectState(dir, name) {
  void dir;
  void name;
  return {
    provedSequence: 0,
    latestProofs: null,
    openBypasses: [],
    exceptions: [],
  };
}
