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

const TEACHER_ID = "public.teacher_id()";
const DIRECTORY = "public.teachers_directory";
const RECORDED_OBJECT = /^(?=.{3,200}$)[a-z][a-z_]*:[A-Za-z0-9_.,()]+$/;

/** @param {ProbeRow[]} rows */
const fingerprintOrRefusal = (rows) =>
  fingerprintOf(rows).catch((error) => ({
    refused: error.message,
    objects: {},
  }));

/** @param {ProbeRow[]} expectedRows @param {ProbeRow[]} liveRows */
const compareOrRefusal = async (expectedRows, liveRows) => {
  try {
    return compareFingerprints(
      await fingerprintOf(expectedRows),
      await fingerprintOf(liveRows),
    );
  } catch (error) {
    return { refused: error.message };
  }
};

/** @param {ProbeRow[]} rows @returns {Promise<Record<string, string>>} */
const keysByName = async (rows) => {
  const fingerprint = await fingerprintOrRefusal(rows);
  return Object.fromEntries(
    Object.entries(fingerprint.objects).map(([key, object]) => [
      object.name,
      key,
    ]),
  );
};

/**
 * @param {string} object @param {string} grantee @param {string} privilege
 * @returns {ProbeRow}
 */
const grant = (object, grantee, privilege) => ({
  kind: "grant",
  on: null,
  name: `${object}.${grantee}.${privilege}`,
  definition: "",
});

/** @param {string[]} labels @returns {ProbeRow} */
const roleEnum = (labels) => ({
  kind: "type",
  on: null,
  name: "public.user_role_enum",
  definition: `enum (${labels.map((label) => `'${label}'`).join(",")})`,
});

/** @param {string} name @param {number} increment @returns {ProbeRow} */
const sequence = (name, increment) => ({
  kind: "sequence",
  on: null,
  name,
  definition: `integer start 1 increment ${increment} min 1 max 2147483647`,
});

/** @param {string} name @param {string} using @returns {ProbeRow} */
const policyNamed = (name, using) => ({
  kind: "policy",
  on: STUDENTS,
  name: `${STUDENTS}.${name}`,
  definition: `select permissive {authenticated} (${using})`,
});

describe("fingerprinting grants, enum types and sequences", () => {
  it("reports a privilege the baseline revokes as an added grant", async () => {
    const revoked = [
      teacherIdFunction,
      grant(TEACHER_ID, "authenticated", "EXECUTE"),
      grant(DIRECTORY, "authenticated", "SELECT"),
    ];
    const stillGranted = [
      ...revoked,
      grant(TEACHER_ID, "anon", "EXECUTE"),
      grant(DIRECTORY, "anon", "SELECT"),
    ];

    expect(await compareOrRefusal(revoked, stillGranted)).toEqual({
      equal: false,
      added: [
        {
          key: "grant:public.teacher_id().anon.EXECUTE",
          kind: "grant",
          name: "public.teacher_id().anon.EXECUTE",
        },
        {
          key: "grant:public.teachers_directory.anon.SELECT",
          kind: "grant",
          name: "public.teachers_directory.anon.SELECT",
        },
      ],
      removed: [],
      changed: [],
    });
  });

  it("reports an enum with an extra or reordered label as changed", async () => {
    const baselineEnum = [roleEnum(["student", "teacher", "admin"])];
    const changedEnum = {
      equal: false,
      added: [],
      removed: [],
      changed: [{ kind: "type", name: "public.user_role_enum" }],
    };

    expect(
      await compareOrRefusal(baselineEnum, [
        roleEnum(["student", "teacher", "admin", "guardian"]),
      ]),
    ).toMatchObject(changedEnum);
    expect(
      await compareOrRefusal(baselineEnum, [
        roleEnum(["student", "admin", "teacher"]),
      ]),
    ).toMatchObject(changedEnum);
    expect(
      await compareOrRefusal(baselineEnum, [
        roleEnum(["student", "teacher", "admin"]),
      ]),
    ).toEqual(NO_DIFFERENCES);
  });

  it("reports added and changed sequences by kind and name", async () => {
    const ownedById = `${STUDENTS}.id`;
    const comparison = await compareOrRefusal(
      [sequence(ownedById, 1)],
      [sequence(ownedById, 10), sequence("public.receipt_number", 1)],
    );

    expect(comparison).toMatchObject({
      equal: false,
      added: [{ kind: "sequence", name: "public.receipt_number" }],
      removed: [],
      changed: [{ kind: "sequence", name: ownedById }],
    });
  });

  it("keys objects whose names slug alike the same in any row order", async () => {
    const spaced = policyNamed("Teachers read students", "true");
    const dashed = policyNamed("Teachers-read-students", "is_admin()");
    const underscored = policyNamed("Teachers_read_students", "false");

    const inProbeOrder = await keysByName([table, spaced, dashed, underscored]);
    const reversed = await keysByName([underscored, dashed, spaced, table]);

    expect(reversed).toEqual(inProbeOrder);
    expect(new Set(Object.values(inProbeOrder)).size).toBe(4);
    expect(
      compareFingerprints(
        await fingerprintOf([table, spaced, dashed, underscored]),
        await fingerprintOf([underscored, dashed, spaced, table]),
      ),
    ).toEqual(NO_DIFFERENCES);
  });

  it("grant, type and sequence keys fit the recorded object shape", async () => {
    const longArguments = Array.from(
      { length: 30 },
      (_, position) => `p${position} character varying`,
    ).join(", ");
    const rows = [
      grant(TEACHER_ID, "anon", "EXECUTE"),
      grant(`public.search_students(${longArguments})`, "anon", "EXECUTE"),
      grant(DIRECTORY, "public", "SELECT"),
      {
        kind: "type",
        on: null,
        name: "public.Role kind",
        definition: "enum ('a')",
      },
      sequence(`${STUDENTS}.id`, 1),
      sequence("public.Receipt #", 1),
    ];

    const keys = Object.keys((await fingerprintOrRefusal(rows)).objects);

    expect(keys).toHaveLength(rows.length);
    for (const key of keys) expect(key).toMatch(RECORDED_OBJECT);
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
