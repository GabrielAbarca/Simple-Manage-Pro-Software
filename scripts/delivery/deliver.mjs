/**
 * @typedef {object} DeliveryResult
 * @property {boolean} ok
 * @property {string | null} reason
 * @property {string[]} delivered
 * @property {{ unit: string, proof: string, sqlstate: string | null } | null} failure
 * @property {string | null} branch
 */

/** @returns {Promise<DeliveryResult>} */
export async function deliver() {
  return { ok: false, reason: "", delivered: [], failure: null, branch: null };
}

/** @returns {Promise<boolean>} */
export async function main() {
  return false;
}
