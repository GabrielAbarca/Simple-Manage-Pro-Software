import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FingerprintError,
  foldGrants,
  normaliseDefinition,
  objectKey,
  parseRow,
  sha256,
} from "./fingerprintKeys.mjs";

/** @typedef {import("./executors/psql.mjs").Executor} Executor */
/** @typedef {import("./proofs.mjs").Shape} Shape */

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

export const PROBE_FILE = fileURLToPath(
  new URL("../../supabase/delivery/fingerprint.sql", import.meta.url),
);

export const EXPECTED_DIR = fileURLToPath(
  new URL("../../supabase/delivery/expected/", import.meta.url),
);

export { FingerprintError };

const SHAPES = new Set(["school", "demo"]);
const HASH = /^[0-9a-f]{64}$/;

/**
 * @param {Map<string, FingerprintObject>} objects
 * @param {string} key
 */
function unusedKey(objects, key) {
  if (!objects.has(key)) return key;
  let copy = 2;
  while (objects.has(`${key}.${copy}`)) copy += 1;
  return `${key}.${copy}`;
}

/**
 * @param {Iterable<[string, FingerprintObject]>} entries
 * @returns {Fingerprint}
 */
function fingerprintFrom(entries) {
  const sorted = [...entries].sort(([a], [b]) => (a < b ? -1 : 1));
  const lines = sorted.map(
    ([key, { kind, name, hash }]) =>
      `${JSON.stringify([key, kind, name, hash])}\n`,
  );
  return {
    digest: sha256(lines.join("")),
    objects: Object.fromEntries(
      sorted.map(([key, { kind, name, hash }]) => [key, { kind, name, hash }]),
    ),
  };
}

/**
 * @param {import("./fingerprintKeys.mjs").ProbeRow} a
 * @param {import("./fingerprintKeys.mjs").ProbeRow} b
 */
const inProbeKeyOrder = (a, b) => {
  const left = [a.kind, a.name, a.definition];
  const right = [b.kind, b.name, b.definition];
  const differing = left.findIndex((value, at) => value !== right[at]);
  if (differing < 0) return 0;
  return left[differing] < right[differing] ? -1 : 1;
};

/**
 * Keys rows in a fixed order, so a key never depends on the order the probe
 * returned them in.
 * @param {string[][]} rows the probe's rows, one JSON object per row
 * @returns {Fingerprint}
 */
export function buildFingerprint(rows) {
  const probed = foldGrants(rows.map((row, index) => parseRow(row, index + 1)));
  /** @type {Map<string, FingerprintObject>} */
  const objects = new Map();
  for (const row of probed.sort(inProbeKeyOrder)) {
    const hash = sha256(normaliseDefinition(row.kind, row.definition));
    const key = unusedKey(objects, objectKey(row, hash));
    objects.set(key, { kind: row.kind, name: row.name, hash });
  }
  return fingerprintFrom(objects);
}

/**
 * Runs the read-only probe through an executor and fingerprints the result.
 * @param {Executor} executor
 * @param {string} [probeFile]
 * @returns {Promise<Fingerprint>}
 */
export async function probeFingerprint(executor, probeFile = PROBE_FILE) {
  const run = await executor.runFile(probeFile);
  if (!run.ok) {
    const state = run.sqlstate ? ` (${run.sqlstate})` : "";
    const reason = run.error ?? "no error was reported";
    throw new FingerprintError(
      `the fingerprint probe failed${state}: ${reason}`,
    );
  }
  return buildFingerprint(run.rows);
}

/**
 * @param {string} key
 * @param {FingerprintObject} object
 * @returns {FingerprintDifference}
 */
const differenceOf = (key, object) => ({
  key,
  kind: object.kind,
  name: object.name,
});

/** @param {FingerprintDifference[]} list */
const byKey = (list) => list.sort((a, b) => (a.key < b.key ? -1 : 1));

/**
 * Objects added, removed or changed between two fingerprints, leaving out
 * every object a recorded exception names.
 * @param {Fingerprint} expected
 * @param {Fingerprint} actual
 * @param {FingerprintException[]} [exceptions]
 * @returns {FingerprintComparison}
 */
export function compareFingerprints(expected, actual, exceptions = []) {
  const excepted = new Set(exceptions.map((exception) => exception.key));
  /** @type {FingerprintDifference[]} */
  const removed = [];
  /** @type {FingerprintDifference[]} */
  const changed = [];
  for (const [key, object] of Object.entries(expected.objects)) {
    const live = Object.hasOwn(actual.objects, key)
      ? actual.objects[key]
      : null;
    if (excepted.has(key) || live?.hash === object.hash) continue;
    if (live) changed.push(differenceOf(key, live));
    else removed.push(differenceOf(key, object));
  }
  const added = Object.entries(actual.objects)
    .filter(([key]) => !excepted.has(key))
    .filter(([key]) => !Object.hasOwn(expected.objects, key))
    .map(([key, object]) => differenceOf(key, object));
  const equal = !added.length && !removed.length && !changed.length;
  return {
    equal,
    added: byKey(added),
    removed: byKey(removed),
    changed: byKey(changed),
  };
}

/**
 * The committed form: sorted keys, two-space JSON, a final newline.
 * @param {Fingerprint} fingerprint
 * @returns {string}
 */
export function serializeFingerprint(fingerprint) {
  const { digest, objects } = fingerprintFrom(
    Object.entries(fingerprint.objects),
  );
  return `${JSON.stringify({ digest, objects }, null, 2)}\n`;
}

/**
 * @param {unknown} value
 * @returns {value is FingerprintObject}
 */
function isStoredObject(value) {
  if (!value || typeof value !== "object") return false;
  const object = /** @type {Record<string, unknown>} */ (value);
  return (
    typeof object.kind === "string" &&
    typeof object.name === "string" &&
    typeof object.hash === "string" &&
    HASH.test(object.hash)
  );
}

/**
 * @param {unknown} value
 * @param {string} where
 * @returns {Fingerprint}
 */
function checkedFingerprint(value, where) {
  const stored = /** @type {Partial<Fingerprint>} */ (value ?? {});
  if (typeof stored.digest !== "string" || !HASH.test(stored.digest)) {
    throw new FingerprintError(`${where} has no valid digest`);
  }
  if (!stored.objects || typeof stored.objects !== "object") {
    throw new FingerprintError(`${where} has no objects`);
  }
  if (Array.isArray(stored.objects)) {
    throw new FingerprintError(`${where} has no objects`);
  }
  const entries = Object.entries(stored.objects);
  const malformed = entries.find(([, object]) => !isStoredObject(object));
  if (malformed) {
    throw new FingerprintError(
      `${where} has a malformed object: ${malformed[0]}`,
    );
  }
  const fingerprint = fingerprintFrom(entries);
  if (fingerprint.digest !== stored.digest) {
    throw new FingerprintError(`${where} does not match its digest`);
  }
  return fingerprint;
}

/**
 * Reads a committed expected fingerprint and refuses a hand-edited one.
 * @param {Shape} shape
 * @param {string} [dir]
 * @returns {Fingerprint}
 */
export function readExpectedFingerprint(shape, dir = EXPECTED_DIR) {
  if (!SHAPES.has(shape)) {
    throw new FingerprintError("the shape is not school or demo");
  }
  const where = `${shape}.json`;
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(join(dir, where), "utf8"));
  } catch (error) {
    throw new FingerprintError(`${where} could not be read: ${error.message}`);
  }
  return checkedFingerprint(parsed, where);
}
