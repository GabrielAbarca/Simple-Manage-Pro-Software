import { createHash } from "node:crypto";

/**
 * @typedef {object} ProbeRow
 * @property {string} kind
 * @property {string | null} on
 * @property {string} name
 * @property {string} definition
 */

export class FingerprintError extends Error {}

const KINDS_ON_A_TABLE = new Set([
  "column",
  "constraint",
  "index",
  "policy",
  "trigger",
]);
const KINDS_ON_THE_SCHEMA = new Set([
  "table",
  "view",
  "function",
  "grant",
  "type",
  "sequence",
]);
const KEYED_BY_DEFINITION = new Set(["constraint", "index"]);
const MAX_KEY_LENGTH = 200;
const INDEX_NAME = /^(CREATE (?:UNIQUE )?INDEX) (?:"(?:[^"]|"")+"|\S+) ON /;
const SEQUENCE_DEFAULT = /nextval\('(?:[^']|'')*'::regclass\)/g;
const GRANTED_PRIVILEGE = /^(.+)\.([A-Z]+)$/;

/** @param {string} text */
export const sha256 = (text) => createHash("sha256").update(text).digest("hex");

/**
 * @param {ProbeRow} row
 * @returns {{ holder: string, privilege: string } | null}
 */
function grantedPrivilege(row) {
  if (row.kind !== "grant") return null;
  const granted = GRANTED_PRIVILEGE.exec(row.name);
  if (!granted) return null;
  const marker = row.definition === "grantable" ? "*" : "";
  return { holder: granted[1], privilege: `${granted[2]}${marker}` };
}

/**
 * Folds the probe's one row per privilege into one grant per object and
 * grantee, so a role holding a table's default privileges is one object, not
 * eight. A grantable privilege is marked `*`, as in an `aclitem`.
 * @param {ProbeRow[]} rows
 * @returns {ProbeRow[]}
 */
export function foldGrants(rows) {
  /** @type {Map<string, string[]>} */
  const privilegesByHolder = new Map();
  const others = [];
  for (const row of rows) {
    const granted = grantedPrivilege(row);
    if (!granted) {
      others.push(row);
      continue;
    }
    const held = privilegesByHolder.get(granted.holder) ?? [];
    privilegesByHolder.set(granted.holder, held.concat(granted.privilege));
  }
  const folded = [...privilegesByHolder].map(([holder, privileges]) => ({
    kind: "grant",
    on: null,
    name: holder,
    definition: [...privileges].sort().join(","),
  }));
  return [...others, ...folded];
}

/**
 * Drops the names the database generates, so only the definition is hashed.
 * @param {string} kind
 * @param {string} definition
 * @returns {string}
 */
export function normaliseDefinition(kind, definition) {
  if (kind === "index") return definition.replace(INDEX_NAME, "$1 ON ");
  if (kind === "column") {
    return definition.replace(SEQUENCE_DEFAULT, "nextval(<sequence>)");
  }
  return definition;
}

/** @param {string} identity */
function keySafe(identity) {
  const spaced = identity.replaceAll(", ", ",");
  const safe = spaced.replace(/[^A-Za-z0-9_.,()]/g, "_");
  if (safe === spaced) return safe;
  return `${safe}.${sha256(identity).slice(0, 8)}`;
}

/**
 * Constraints and indexes are keyed by their definition, every other object
 * by its name, in the `kind:name` shape a recorded exception names. A name
 * the shape can't hold as is carries a short hash of the raw name, so two
 * names that slug alike keep distinct keys.
 * @param {ProbeRow} row
 * @param {string} hash
 * @returns {string}
 */
export function objectKey(row, hash) {
  const identity = KEYED_BY_DEFINITION.has(row.kind)
    ? `${row.on}.${hash.slice(0, 16)}`
    : row.name;
  const key = `${row.kind}:${keySafe(identity)}`;
  if (key.length <= MAX_KEY_LENGTH) return key;
  return `${key.slice(0, MAX_KEY_LENGTH - 17)}.${sha256(key).slice(0, 16)}`;
}

/**
 * @param {unknown} value
 * @returns {value is ProbeRow}
 */
function isProbeRow(value) {
  if (!value || typeof value !== "object") return false;
  const row = /** @type {Record<string, unknown>} */ (value);
  if (typeof row.name !== "string" || row.name === "") return false;
  if (typeof row.definition !== "string") return false;
  if (KINDS_ON_THE_SCHEMA.has(/** @type {string} */ (row.kind))) {
    return row.on === null;
  }
  if (!KINDS_ON_A_TABLE.has(/** @type {string} */ (row.kind))) return false;
  return typeof row.on === "string" && row.on !== "";
}

/**
 * One probe row: a single cell holding the object as JSON.
 * @param {string[]} row
 * @param {number} position
 * @returns {ProbeRow}
 */
export function parseRow(row, position) {
  let value;
  try {
    value = JSON.parse(row[0] ?? "");
  } catch {
    throw new FingerprintError(`probe row ${position} is not JSON`);
  }
  if (!isProbeRow(value)) {
    throw new FingerprintError(`probe row ${position} has an unknown shape`);
  }
  return value;
}
