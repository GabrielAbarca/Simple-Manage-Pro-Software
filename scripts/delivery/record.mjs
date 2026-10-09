import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * @typedef {object} Project
 * @property {string} name
 * @property {boolean} holdsRealData
 */

/**
 * @typedef {object} UnitFile
 * @property {string} path
 * @property {string} sha256
 */

/**
 * @typedef {object} UnitEntry
 * @property {string} id
 * @property {number} sequence
 * @property {UnitFile[]} files
 */

/**
 * @typedef {object} ProofEntry
 * @property {string} name
 * @property {boolean} ok
 */

/**
 * @typedef {object} Failure
 * @property {string} unit
 * @property {string | null} sqlstate
 */

/**
 * @typedef {object} DeliveryEntry
 * @property {"delivery"} kind
 * @property {UnitEntry[]} units
 * @property {string} startedAt
 * @property {string} endedAt
 * @property {string} approver
 * @property {{ before: string, after: string | null }} fingerprint
 * @property {ProofEntry[]} proofs
 * @property {Failure} [failure]
 */

/**
 * @typedef {object} BypassEntry
 * @property {"bypass"} kind
 * @property {string} at
 * @property {string} approver
 * @property {string} fingerprint
 * @property {string} reason
 */

/**
 * @typedef {object} ExceptionEntry
 * @property {"exception"} kind
 * @property {string} at
 * @property {string} approver
 * @property {string} object
 * @property {string} reason
 */

/** @typedef {DeliveryEntry | BypassEntry | ExceptionEntry} Entry */

/**
 * @typedef {object} RecordFile
 * @property {string} project
 * @property {Entry[]} entries
 */

/**
 * @typedef {object} ProjectState
 * @property {number} provedSequence
 * @property {{ at: string, proofs: ProofEntry[] } | null} latestProofs
 * @property {BypassEntry[]} openBypasses
 * @property {ExceptionEntry[]} exceptions
 */

export const RECORDS_DIR = "supabase/delivery/records";

export class RecordError extends Error {}

const ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const HASH = /^[0-9a-f]{64}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;
const PATH = /^supabase\/[A-Za-z0-9_][A-Za-z0-9_./-]*$/;
const APPROVER = /^[^<>\n]{1,100} <[^<>\s]+@[^<>\s]+>$/;
const SQLSTATE = /^[0-9A-Z]{5}$/;
const OBJECT = /^(?=.{3,200}$)[a-z][a-z_]*:[A-Za-z0-9_.,()]+$/;
const PROJECT = /^[a-z0-9][a-z0-9-]{0,62}$/;
const CLOSING = /\n\s*\]\n\}\n$/;

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
const isPlainObject = (value) =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;

/**
 * @param {unknown} value
 * @param {string[]} required
 * @param {string[]} optional
 * @param {string} where
 * @returns {Record<string, unknown>}
 */
function exactKeys(value, required, optional, where) {
  if (!isPlainObject(value)) throw new RecordError(`${where} is not an object`);
  for (const key of Object.keys(value)) {
    if (!required.includes(key) && !optional.includes(key)) {
      throw new RecordError(
        `${where} carries a field outside the schema: ${key}`,
      );
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      throw new RecordError(`${where} is missing ${key}`);
    }
  }
  return value;
}

/**
 * @param {unknown} value
 * @param {RegExp} pattern
 * @param {string} where
 * @returns {string}
 */
function matching(value, pattern, where) {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new RecordError(`${where} is not in the allowed format`);
  }
  return value;
}

/**
 * @param {unknown} value
 * @param {string} where
 * @returns {string}
 */
function timestamp(value, where) {
  const text = matching(value, TIMESTAMP, where);
  const parsed = new Date(text);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 19) !== text.slice(0, 19)
  ) {
    throw new RecordError(`${where} is not a real time`);
  }
  return text;
}

/**
 * @param {unknown} value
 * @param {string} where
 * @returns {boolean}
 */
function flag(value, where) {
  if (typeof value !== "boolean") {
    throw new RecordError(`${where} is not true or false`);
  }
  return value;
}

/**
 * @param {unknown} value
 * @param {string} where
 * @returns {unknown[]}
 */
function list(value, where) {
  if (!Array.isArray(value)) throw new RecordError(`${where} is not a list`);
  return value;
}

/**
 * @param {unknown} value
 * @param {string} where
 * @returns {string}
 */
function reason(value, where) {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > 500 ||
    [...value].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
  ) {
    throw new RecordError(`${where} needs a reason of 1 to 500 characters`);
  }
  return value;
}

/**
 * @param {unknown} value
 * @param {number} index
 * @returns {UnitEntry}
 */
function unit(value, index) {
  const where = `units[${index}]`;
  const raw = exactKeys(value, ["id", "sequence", "files"], [], where);
  if (!Number.isSafeInteger(raw.sequence) || Number(raw.sequence) < 1) {
    throw new RecordError(`${where}.sequence is not a positive integer`);
  }
  return {
    id: matching(raw.id, ID, `${where}.id`),
    sequence: Number(raw.sequence),
    files: list(raw.files, `${where}.files`).map((file, i) => {
      const at = `${where}.files[${i}]`;
      const f = exactKeys(file, ["path", "sha256"], [], at);
      const path = matching(f.path, PATH, `${at}.path`);
      if (path.split("/").includes("..")) {
        throw new RecordError(`${at}.path leaves supabase/`);
      }
      return { path, sha256: matching(f.sha256, HASH, `${at}.sha256`) };
    }),
  };
}

/**
 * @param {unknown} value
 * @param {number} index
 * @returns {ProofEntry}
 */
function proof(value, index) {
  const where = `proofs[${index}]`;
  const raw = exactKeys(value, ["name", "ok"], [], where);
  return {
    name: matching(raw.name, ID, `${where}.name`),
    ok: flag(raw.ok, `${where}.ok`),
  };
}

/**
 * @param {Record<string, unknown>} raw
 * @returns {DeliveryEntry}
 */
function delivery(raw) {
  exactKeys(
    raw,
    [
      "kind",
      "units",
      "startedAt",
      "endedAt",
      "approver",
      "fingerprint",
      "proofs",
    ],
    ["failure"],
    "delivery",
  );
  const startedAt = timestamp(raw.startedAt, "delivery.startedAt");
  const endedAt = timestamp(raw.endedAt, "delivery.endedAt");
  if (Date.parse(startedAt) > Date.parse(endedAt)) {
    throw new RecordError("delivery.startedAt is after delivery.endedAt");
  }
  const fp = exactKeys(
    raw.fingerprint,
    ["before", "after"],
    [],
    "delivery.fingerprint",
  );
  const proofs = list(raw.proofs, "delivery.proofs").map(proof);
  if (proofs.length === 0) throw new RecordError("delivery.proofs is empty");
  /** @type {DeliveryEntry} */
  const entry = {
    kind: "delivery",
    units: list(raw.units, "delivery.units").map(unit),
    startedAt,
    endedAt,
    approver: matching(raw.approver, APPROVER, "delivery.approver"),
    fingerprint: {
      before: matching(fp.before, HASH, "delivery.fingerprint.before"),
      after:
        fp.after === null
          ? null
          : matching(fp.after, HASH, "delivery.fingerprint.after"),
    },
    proofs,
  };
  if (raw.failure !== undefined) {
    const failure = exactKeys(
      raw.failure,
      ["unit", "sqlstate"],
      ["message"],
      "delivery.failure",
    );
    entry.failure = {
      unit: matching(failure.unit, ID, "delivery.failure.unit"),
      sqlstate:
        failure.sqlstate === null
          ? null
          : matching(failure.sqlstate, SQLSTATE, "delivery.failure.sqlstate"),
    };
  }
  return entry;
}

/**
 * @param {Record<string, unknown>} raw
 * @returns {BypassEntry}
 */
function bypass(raw) {
  exactKeys(
    raw,
    ["kind", "at", "approver", "fingerprint", "reason"],
    [],
    "bypass",
  );
  return {
    kind: "bypass",
    at: timestamp(raw.at, "bypass.at"),
    approver: matching(raw.approver, APPROVER, "bypass.approver"),
    fingerprint: matching(raw.fingerprint, HASH, "bypass.fingerprint"),
    reason: reason(raw.reason, "bypass"),
  };
}

/**
 * @param {Record<string, unknown>} raw
 * @returns {ExceptionEntry}
 */
function exception(raw) {
  exactKeys(
    raw,
    ["kind", "at", "approver", "object", "reason"],
    [],
    "exception",
  );
  return {
    kind: "exception",
    at: timestamp(raw.at, "exception.at"),
    approver: matching(raw.approver, APPROVER, "exception.approver"),
    object: matching(raw.object, OBJECT, "exception.object"),
    reason: reason(raw.reason, "exception"),
  };
}

/**
 * @param {Project} project
 * @returns {string}
 */
function projectName(project) {
  if (!isPlainObject(project) || typeof project.holdsRealData !== "boolean") {
    throw new RecordError("the project needs a name and holdsRealData");
  }
  return matching(project.name, PROJECT, "project.name");
}

/**
 * Builds the stored form of an entry from the allowed keys only. A failure's
 * Postgres message is dropped on every project, `holdsRealData` or not.
 * @param {Project} project
 * @param {unknown} entry
 * @returns {Entry}
 */
export function validateEntry(project, entry) {
  projectName(project);
  if (!isPlainObject(entry))
    throw new RecordError("the entry is not an object");
  if (entry.kind === "delivery") return delivery(entry);
  if (entry.kind === "bypass") return bypass(entry);
  if (entry.kind === "exception") return exception(entry);
  throw new RecordError("the entry kind is not delivery, bypass or exception");
}

/**
 * @param {RecordFile} record
 * @returns {string}
 */
const serialize = (record) => `${JSON.stringify(record, null, 2)}\n`;

/**
 * @param {string} dir
 * @param {string} name
 * @returns {Promise<{ record: RecordFile, text: string | null }>}
 */
async function load(dir, name) {
  let text;
  try {
    text = await readFile(join(dir, `${name}.json`), "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { record: { project: name, entries: [] }, text: null };
    }
    throw error;
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new RecordError(`${name}.json is not valid JSON`);
  }
  const raw = exactKeys(parsed, ["project", "entries"], [], `${name}.json`);
  if (raw.project !== name) {
    throw new RecordError(`${name}.json belongs to another project`);
  }
  const project = { name, holdsRealData: false };
  /** @type {RecordFile} */
  const record = {
    project: name,
    entries: list(raw.entries, `${name}.json entries`).map((entry) =>
      validateEntry(project, entry),
    ),
  };
  if (serialize(record) !== text) {
    throw new RecordError(`${name}.json was edited outside the record writer`);
  }
  return { record, text };
}

/**
 * Appends one entry to `<dir>/<project>.json`, keeping every earlier byte.
 * Nothing is written when the entry or the existing record is refused.
 * @param {string} dir
 * @param {Project} project
 * @param {unknown} entry
 * @returns {Promise<Entry>}
 */
export async function appendEntry(dir, project, entry) {
  const name = projectName(project);
  const stored = validateEntry(project, entry);
  const { record, text } = await load(dir, name);
  const next = serialize({
    project: name,
    entries: [...record.entries, stored],
  });
  if (text !== null && !next.startsWith(text.replace(CLOSING, ""))) {
    throw new RecordError(`${name}.json would not stay append-only`);
  }
  await mkdir(dir, { recursive: true });
  const file = join(dir, `${name}.json`);
  await writeFile(`${file}.tmp`, next, "utf8");
  await rename(`${file}.tmp`, file);
  return stored;
}

/**
 * @param {string} dir
 * @param {string} name
 * @returns {Promise<RecordFile>}
 */
export async function readRecord(dir, name) {
  matching(name, PROJECT, "project.name");
  return (await load(dir, name)).record;
}

/**
 * @param {DeliveryEntry} entry
 * @returns {boolean}
 */
const isProved = (entry) => !entry.failure && entry.proofs.every((p) => p.ok);

/**
 * A bypass stays open until a later proved delivery; a reconcile is a
 * delivery of reconcile units, so it closes bypasses the same way.
 * @param {Entry[]} entries
 * @returns {ProjectState}
 */
export function projectState(entries) {
  let provedSequence = 0;
  /** @type {ProjectState["latestProofs"]} */
  let latestProofs = null;
  /** @type {BypassEntry[]} */
  let openBypasses = [];
  /** @type {Map<string, ExceptionEntry>} */
  const exceptions = new Map();
  for (const entry of entries) {
    if (entry.kind === "delivery") {
      latestProofs = { at: entry.endedAt, proofs: entry.proofs };
      if (isProved(entry)) {
        for (const u of entry.units) {
          provedSequence = Math.max(provedSequence, u.sequence);
        }
        openBypasses = [];
      }
    } else if (entry.kind === "bypass") {
      openBypasses.push(entry);
    } else {
      exceptions.delete(entry.object);
      exceptions.set(entry.object, entry);
    }
  }
  return {
    provedSequence,
    latestProofs,
    openBypasses,
    exceptions: [...exceptions.values()],
  };
}

/**
 * @param {string} dir
 * @param {string} name
 * @returns {Promise<ProjectState>}
 */
export async function readProjectState(dir, name) {
  return projectState((await readRecord(dir, name)).entries);
}
