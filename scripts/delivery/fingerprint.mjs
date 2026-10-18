/**
 * @typedef {object} FingerprintObject
 * @property {string} kind
 * @property {string} name
 * @property {string} hash
 */

/**
 * @typedef {object} Fingerprint
 * @property {string} digest
 * @property {Record<string, FingerprintObject>} objects
 */

/**
 * @typedef {object} FingerprintDifference
 * @property {string} key
 * @property {string} kind
 * @property {string} name
 */

/**
 * @typedef {object} FingerprintComparison
 * @property {boolean} equal
 * @property {FingerprintDifference[]} added
 * @property {FingerprintDifference[]} removed
 * @property {FingerprintDifference[]} changed
 */

/**
 * @typedef {object} FingerprintException
 * @property {string} key
 * @property {string} reason
 */

/** @returns {Promise<Fingerprint>} */
export async function probeFingerprint() {
  return { digest: "", objects: {} };
}

/** @returns {FingerprintComparison} */
export function compareFingerprints() {
  return { equal: false, added: [], removed: [], changed: [] };
}

/** @returns {string} */
export function serializeFingerprint() {
  return "";
}

/** @returns {Fingerprint} */
export function readExpectedFingerprint() {
  return { digest: "", objects: {} };
}
