/**
 * @typedef {object} Check
 * @property {string} id
 * @property {string} sql
 * @property {number} expect
 */

/**
 * @typedef {object} Unit
 * @property {number} seq
 * @property {string} id
 * @property {string[]} files
 * @property {ProjectType[]} appliesTo
 * @property {string[]} functions
 * @property {string[]} auth
 * @property {Check[]} checks
 */

/** @typedef {{ units: Unit[] }} Manifest */

/** @typedef {"demo" | "school"} ProjectType */

/**
 * @typedef {object} WindowSlot
 * @property {number[]} days
 * @property {string} from
 * @property {string} to
 */

/**
 * @typedef {object} DeliveryWindow
 * @property {string} timezone
 * @property {WindowSlot[]} slots
 */

/**
 * @typedef {object} Project
 * @property {string} name
 * @property {string} ref
 * @property {ProjectType} type
 * @property {string} site
 * @property {string} origin
 * @property {boolean} holdsRealData
 * @property {DeliveryWindow | null} window
 */

/** @typedef {{ projects: Project[] }} ProjectList */

/** @type {readonly ProjectType[]} */
export const PROJECT_TYPES = ["demo", "school"];

/**
 * @param {unknown} data
 * @param {Iterable<string>} schemaFiles
 * @returns {string[]}
 */
export function checkManifest(data, schemaFiles) {
  void [data, schemaFiles];
  return [];
}

/**
 * @param {unknown} data
 * @returns {string[]}
 */
export function checkProjects(data) {
  void data;
  return [];
}

/**
 * @param {string} [root]
 * @returns {Manifest}
 */
export function loadManifest(root) {
  void root;
  return { units: [] };
}

/**
 * @param {string} [root]
 * @returns {ProjectList}
 */
export function loadProjects(root) {
  void root;
  return { projects: [] };
}

/**
 * @param {Manifest} manifest
 * @returns {number}
 */
export function requiredSequence(manifest) {
  void manifest;
  return 0;
}

/**
 * @param {Manifest} manifest
 * @param {ProjectType} type
 * @param {number} afterSeq
 * @returns {Unit[]}
 */
export function unitsFor(manifest, type, afterSeq) {
  void [manifest, type, afterSeq];
  return [];
}
