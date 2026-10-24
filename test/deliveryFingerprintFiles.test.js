import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FingerprintError,
  compareFingerprints,
  probeFingerprint,
  readExpectedFingerprint,
  serializeFingerprint,
} from "../scripts/delivery/fingerprint.mjs";

/** @param {object[]} objects */
const fingerprintOf = (objects) =>
  probeFingerprint({
    runFile: async () => ({
      ok: true,
      sqlstate: null,
      error: null,
      notices: [],
      rows: objects.map((object) => [JSON.stringify(object)]),
    }),
    runStatement: async () => {
      throw new Error("not used");
    },
  });

const STUDENTS = "public.students";
const NO_DIFFERENCES = { equal: true, added: [], removed: [], changed: [] };

const baseline = [
  { kind: "table", on: null, name: STUDENTS, definition: "r rls" },
  {
    kind: "column",
    on: STUDENTS,
    name: `${STUDENTS}.cedula`,
    definition: "text not null",
  },
  {
    kind: "constraint",
    on: STUDENTS,
    name: `${STUDENTS}.students_cedula_key`,
    definition: "UNIQUE (cedula)",
  },
  {
    kind: "policy",
    on: STUDENTS,
    name: `${STUDENTS}.Users can read their own student record`,
    definition: "select permissive {authenticated} (profile_id = auth.uid())",
  },
];

const teacherIdFunction = {
  kind: "function",
  on: null,
  name: "public.teacher_id()",
  definition: "CREATE OR REPLACE FUNCTION public.teacher_id() …",
};

const EXCEPTION_OBJECT = /^(?=.{3,200}$)[a-z][a-z_]*:[A-Za-z0-9_.,()]+$/;

describe("fingerprint keys and files", () => {
  it("keys every object in the shape a recorded exception names", async () => {
    const fingerprint = await fingerprintOf([
      ...baseline,
      teacherIdFunction,
      {
        kind: "function",
        on: null,
        name: "public.grade_between(numeric, timestamp with time zone)",
        definition: "CREATE FUNCTION …",
      },
      {
        kind: "policy",
        on: STUDENTS,
        name: `${STUDENTS}.${"a very long policy name ".repeat(12)}`,
        definition: "select",
      },
    ]);

    const keys = Object.keys(fingerprint.objects);
    expect(keys).toHaveLength(baseline.length + 3);
    for (const key of keys) expect(key).toMatch(EXCEPTION_OBJECT);
    expect(keys).toContainEqual(
      expect.stringMatching(
        /^function:public\.grade_between\(numeric,timestamp_with_time_zone\)\.[0-9a-f]{8}$/,
      ),
    );
    expect(keys).toContain("function:public.teacher_id()");
  });

  it("treats columns whose defaults differ only by sequence name as equal", async () => {
    const serial = (/** @type {string} */ sequence) => ({
      kind: "column",
      on: STUDENTS,
      name: `${STUDENTS}.id`,
      definition: `integer not null default nextval('${sequence}'::regclass)`,
    });

    expect(
      compareFingerprints(
        await fingerprintOf([serial("students_id_seq")]),
        await fingerprintOf([serial("students_id_seq1")]),
      ),
    ).toEqual(NO_DIFFERENCES);
  });

  it("rejects a failed probe with its SQLSTATE", async () => {
    const failing = {
      runFile: async () => ({
        ok: false,
        sqlstate: "42501",
        error: "permission denied for table pg_authid",
        notices: [],
        rows: [],
      }),
      runStatement: async () => {
        throw new Error("not used");
      },
    };

    await expect(probeFingerprint(failing)).rejects.toThrow(FingerprintError);
    await expect(probeFingerprint(failing)).rejects.toThrow("(42501)");
  });

  it("refuses a malformed probe row without echoing it", async () => {
    const leaked = "1-2345-6789";
    const run = probeFingerprint({
      runFile: async () => ({
        ok: true,
        sqlstate: null,
        error: null,
        notices: [],
        rows: [[JSON.stringify({ kind: "table", cedula: leaked })]],
      }),
      runStatement: async () => {
        throw new Error("not used");
      },
    });

    await expect(run).rejects.toThrow(FingerprintError);
    await expect(run).rejects.not.toThrow(leaked);
  });

  it("round-trips a committed file and refuses a hand-edited one", async () => {
    const dir = mkdtempSync(join(tmpdir(), "smp-fingerprint-"));
    const fingerprint = await fingerprintOf(baseline);
    writeFileSync(join(dir, "school.json"), serializeFingerprint(fingerprint));

    expect(readExpectedFingerprint("school", dir)).toEqual(fingerprint);
    expect(serializeFingerprint(fingerprint)).toBe(
      readFileSync(join(dir, "school.json"), "utf8"),
    );

    const edited = JSON.parse(serializeFingerprint(fingerprint));
    const [firstKey] = Object.keys(edited.objects);
    edited.objects[firstKey].hash = "0".repeat(64);
    writeFileSync(join(dir, "demo.json"), JSON.stringify(edited));
    expect(() => readExpectedFingerprint("demo", dir)).toThrow(
      "does not match its digest",
    );
    expect(() => readExpectedFingerprint("pilot", dir)).toThrow(
      FingerprintError,
    );
  });

  it("refuses a committed file whose object kind or name was edited", async () => {
    const dir = mkdtempSync(join(tmpdir(), "smp-fingerprint-"));
    const committed = JSON.parse(
      serializeFingerprint(await fingerprintOf(baseline)),
    );
    const [firstKey] = Object.keys(committed.objects);
    const editedName = structuredClone(committed);
    editedName.objects[firstKey].name = "public.students.hand_edited";
    const editedKind = structuredClone(committed);
    editedKind.objects[firstKey].kind = "view";
    writeFileSync(join(dir, "school.json"), JSON.stringify(editedName));
    writeFileSync(join(dir, "demo.json"), JSON.stringify(editedKind));

    expect(() => readExpectedFingerprint("school", dir)).toThrow(
      "does not match its digest",
    );
    expect(() => readExpectedFingerprint("demo", dir)).toThrow(
      "does not match its digest",
    );
  });

  it("keeps a function key free of a hash when only its argument spacing changes", async () => {
    const fingerprint = await fingerprintOf([
      {
        kind: "function",
        on: null,
        name: "public.grade_of(integer, text)",
        definition: "CREATE FUNCTION …",
      },
    ]);

    expect(Object.keys(fingerprint.objects)).toEqual([
      "function:public.grade_of(integer,text)",
    ]);
  });

  it("keys identical constraints the same in either row order", async () => {
    const duplicate = (/** @type {string} */ name) => ({
      kind: "constraint",
      on: STUDENTS,
      name: `${STUDENTS}.${name}`,
      definition: "UNIQUE (cedula)",
    });
    const rows = [duplicate("students_cedula_key"), duplicate("cedula_unique")];

    const forward = await fingerprintOf(rows);
    const backward = await fingerprintOf([...rows].reverse());

    expect(Object.keys(forward.objects)).toHaveLength(2);
    expect(backward).toEqual(forward);
  });

  it("leaves the probe's rows in the order they came", async () => {
    const rows = [...baseline].reverse().map((row) => [JSON.stringify(row)]);
    const before = structuredClone(rows);

    await probeFingerprint({
      runFile: async () => ({
        ok: true,
        sqlstate: null,
        error: null,
        notices: [],
        rows,
      }),
      runStatement: async () => {
        throw new Error("not used");
      },
    });

    expect(rows).toEqual(before);
  });

  it("folds a grantee's privileges into one grant in any order, marking grant options", async () => {
    const privilege = (
      /** @type {string} */ name,
      /** @type {string} */ definition,
    ) => ({
      kind: "grant",
      on: null,
      name: `${STUDENTS}.authenticated.${name}`,
      definition,
    });
    const plain = await fingerprintOf([
      privilege("SELECT", ""),
      privilege("INSERT", ""),
    ]);
    const reordered = await fingerprintOf([
      privilege("INSERT", ""),
      privilege("SELECT", ""),
    ]);
    const withGrantOption = await fingerprintOf([
      privilege("SELECT", "grantable"),
      privilege("INSERT", ""),
    ]);

    expect(Object.keys(plain.objects)).toEqual([
      "grant:public.students.authenticated",
    ]);
    expect(reordered).toEqual(plain);
    expect(compareFingerprints(plain, withGrantOption).changed).toEqual([
      {
        key: "grant:public.students.authenticated",
        kind: "grant",
        name: "public.students.authenticated",
      },
    ]);
  });
});
