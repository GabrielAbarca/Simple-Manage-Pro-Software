import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  compareFingerprints,
  probeFingerprint,
} from "../scripts/delivery/fingerprint.mjs";

const PROBE = fileURLToPath(
  new URL("../supabase/delivery/fingerprint.sql", import.meta.url),
);

/**
 * @typedef {object} ProbeRow
 * @property {string} kind
 * @property {string | null} on
 * @property {string} name
 * @property {string} definition
 */

/** @param {ProbeRow[]} objects */
const executorReturning = (objects) => {
  const result = {
    ok: true,
    sqlstate: null,
    error: null,
    notices: [],
    rows: objects.map((object) => [JSON.stringify(object)]),
  };
  return { runFile: async () => result, runStatement: async () => result };
};

/** @param {ProbeRow[]} objects */
const fingerprintOf = (objects) => probeFingerprint(executorReturning(objects));

const STUDENTS = "public.students";

/** @type {ProbeRow} */
const table = {
  kind: "table",
  on: null,
  name: STUDENTS,
  definition: "r rls",
};

/** @param {string} type @returns {ProbeRow} */
const cedula = (type) => ({
  kind: "column",
  on: STUDENTS,
  name: `${STUDENTS}.cedula`,
  definition: `${type} not null`,
});

/** @param {string} name @param {string} column @returns {ProbeRow[]} */
const uniqueOn = (name, column) => [
  {
    kind: "constraint",
    on: STUDENTS,
    name: `${STUDENTS}.${name}`,
    definition: `UNIQUE (${column})`,
  },
  {
    kind: "index",
    on: STUDENTS,
    name: `${STUDENTS}.${name}`,
    definition: `CREATE UNIQUE INDEX ${name} ON public.students USING btree (${column})`,
  },
];

/** @type {ProbeRow} */
const ownRowPolicy = {
  kind: "policy",
  on: STUDENTS,
  name: `${STUDENTS}.Users can read their own student record`,
  definition: "select permissive {authenticated} (profile_id = auth.uid())",
};

/** @type {ProbeRow} */
const teacherIdFunction = {
  kind: "function",
  on: null,
  name: "public.teacher_id()",
  definition:
    "CREATE OR REPLACE FUNCTION public.teacher_id()\n RETURNS uuid\n LANGUAGE sql\nAS $function$ select 1 $function$\n",
};

const NO_DIFFERENCES = { equal: true, added: [], removed: [], changed: [] };

const baseline = [
  table,
  cedula("text"),
  ...uniqueOn("students_cedula_key", "cedula"),
  ownRowPolicy,
];
const drifted = [
  table,
  cedula("character varying(20)"),
  ...uniqueOn("students_cedula_key", "cedula"),
  teacherIdFunction,
];

const DRIFT = {
  removed: [{ kind: "policy", name: ownRowPolicy.name }],
  changed: [{ kind: "column", name: `${STUDENTS}.cedula` }],
  added: [{ kind: "function", name: "public.teacher_id()" }],
};

describe("comparing fingerprints", () => {
  it("treats a renamed constraint with the same definition as unchanged", async () => {
    const named = await fingerprintOf([
      table,
      ...uniqueOn("students_cedula_key", "cedula"),
    ]);
    const renamed = await fingerprintOf([
      table,
      ...uniqueOn("students_cedula_unique", "cedula"),
    ]);
    const otherColumn = await fingerprintOf([
      table,
      ...uniqueOn("students_cedula_key", "email"),
    ]);

    expect(compareFingerprints(named, renamed)).toEqual(NO_DIFFERENCES);
    expect(compareFingerprints(named, otherColumn).equal).toBe(false);
  });

  it("reports dropped, changed and added objects by kind and name", async () => {
    const comparison = compareFingerprints(
      await fingerprintOf(baseline),
      await fingerprintOf(drifted),
    );

    expect(comparison).toMatchObject({ equal: false, ...DRIFT });
  });

  it("subtracts recorded exceptions before comparing", async () => {
    const expected = await fingerprintOf(baseline);
    const live = await fingerprintOf(drifted);
    const all = compareFingerprints(expected, live);
    const keyOf = (/** @type {string} */ kind) =>
      [...all.added, ...all.removed, ...all.changed].find(
        (difference) => difference.kind === kind,
      )?.key ?? `${kind}:missing`;

    const withoutPolicy = compareFingerprints(expected, live, [
      { key: keyOf("policy"), reason: "Dropped on the pilot by hand" },
    ]);
    const withoutAny = compareFingerprints(
      expected,
      live,
      ["policy", "column", "function"].map((kind) => ({
        key: keyOf(kind),
        reason: "Known difference",
      })),
    );

    expect(withoutPolicy).toMatchObject({
      equal: false,
      removed: [],
      changed: DRIFT.changed,
      added: DRIFT.added,
    });
    expect(withoutAny).toEqual(NO_DIFFERENCES);
  });
});

const WRITES =
  /\b(insert|update|delete|merge|truncate|create|alter|drop|grant|revoke|copy|call|do|execute|set|reset|lock|vacuum|analyze|cluster|reindex|refresh|comment|listen|notify|prepare|begin|commit|rollback|savepoint|discard|import|into|nextval|setval|set_config|pg_terminate_backend|pg_cancel_backend|pg_reload_conf|lo_import|lo_export|dblink\w*)\b/i;

/** @param {string} sql */
const withoutCommentsAndLiterals = (sql) =>
  sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, "''")
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, '""');

describe("the fingerprint probe", () => {
  it("the fingerprint probe only reads", () => {
    expect(existsSync(PROBE)).toBe(true);

    const code = withoutCommentsAndLiterals(readFileSync(PROBE, "utf8"));
    const statements = code
      .split(";")
      .map((statement) => statement.trim())
      .filter(Boolean);

    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatch(/^(select|with)\b/i);
    expect(statements[0].match(WRITES)).toBeNull();
  });
});
