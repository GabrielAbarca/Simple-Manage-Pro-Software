import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendEntry,
  readProjectState,
  readRecord,
} from "../scripts/delivery/record.mjs";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const APPROVER = "Gabriel Zelaya <gzelaya0404@gmail.com>";

const demo = { name: "demo", holdsRealData: false };
const school = { name: "liceo-norte", holdsRealData: true };

/**
 * @param {number} sequence
 * @param {{ ok?: boolean }} [options]
 */
const delivery = (sequence, { ok = true } = {}) => ({
  kind: "delivery",
  units: [
    {
      id: `unit-${sequence}`,
      sequence,
      files: [
        { path: `supabase/schema/incremental_${sequence}.sql`, sha256: HASH_A },
      ],
    },
  ],
  startedAt: `2026-10-0${sequence}T20:00:00.000Z`,
  endedAt: `2026-10-0${sequence}T20:05:00.000Z`,
  approver: APPROVER,
  fingerprint: { before: HASH_B, after: HASH_C },
  proofs: [
    { name: "audit", ok },
    { name: "demo-lock", ok: true },
    { name: "fingerprint", ok: true },
  ],
});

const bypass = (
  reason = "Hotfixed a policy from the dashboard during class",
) => ({
  kind: "bypass",
  at: "2026-10-04T18:00:00.000Z",
  approver: APPROVER,
  fingerprint: HASH_B,
  reason,
});

const exception = (
  object,
  reason = "Pilot keeps an older index on purpose",
) => ({
  kind: "exception",
  at: "2026-10-04T19:00:00.000Z",
  approver: APPROVER,
  object,
  reason,
});

let dir;
/** @param {string} name */
const fileOf = (name) => join(dir, `${name}.json`);
/** @param {string} name */
const textOf = (name) =>
  existsSync(fileOf(name)) ? readFileSync(fileOf(name), "utf8") : "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "smp-record-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("delivery record writer", () => {
  it("appends a delivery entry and never rewrites earlier ones", async () => {
    await appendEntry(dir, demo, delivery(1));
    expect(existsSync(fileOf("demo"))).toBe(true);
    const before = textOf("demo");
    const head = before.replace(/\n\s*\]\n\}\n$/, "");
    expect(head).not.toBe(before);

    await appendEntry(dir, demo, delivery(2));
    const after = textOf("demo");

    expect(after.startsWith(head)).toBe(true);
    const parsed = JSON.parse(after);
    expect(parsed.entries).toHaveLength(2);
    expect(parsed.entries[0]).toEqual(JSON.parse(before).entries[0]);
    expect(parsed.entries[1].units[0].id).toBe("unit-2");
  });

  it("rejects an entry carrying any field outside the fixed schema", async () => {
    const outside = [
      { ...delivery(2), note: "row 14 had cédula 1-2345-6789" },
      { ...delivery(2), reason: "free text on a delivery" },
      {
        ...delivery(2),
        units: [{ ...delivery(2).units[0], rows: [["1-2345-6789"]] }],
      },
      {
        ...delivery(2),
        proofs: [{ name: "audit", ok: true, detail: "Ana Mora, 7-B" }],
      },
      {
        ...delivery(2),
        proofs: [{ name: "Ana Mora 1-2345-6789", ok: true }],
      },
      { ...delivery(2), units: [{ ...delivery(2).units[0], id: "Ana Mora" }] },
      { ...delivery(2), fingerprint: { before: "Ana Mora", after: HASH_C } },
      { ...delivery(2), startedAt: "yesterday evening" },
      { ...delivery(2), proofs: [{ name: "audit", ok: "passed" }] },
      { ...bypass(), object: "public.students" },
      { ...exception("policy:public.students.select"), note: "extra" },
      { kind: "comment", at: "2026-10-04T19:00:00.000Z", reason: "hello" },
    ];

    await appendEntry(dir, demo, delivery(1));
    const before = textOf("demo");
    expect(before).not.toBe("");

    for (const entry of outside) {
      await expect(appendEntry(dir, demo, entry)).rejects.toThrow();
      expect(textOf("demo")).toBe(before);
    }

    await expect(appendEntry(dir, school, outside[0])).rejects.toThrow();
    expect(existsSync(fileOf(school.name))).toBe(false);
  });

  it("stores a failure on a real-data project as its SQLSTATE only", async () => {
    const message =
      'duplicate key value violates unique constraint "students_cedula_key": Key (cedula)=(1-2345-6789) already exists.';
    await appendEntry(dir, school, {
      ...delivery(1, { ok: false }),
      failure: { unit: "unit-1", sqlstate: "23505", message },
    });

    const { entries } = await readRecord(dir, school.name);
    expect(entries[0]?.failure).toEqual({ unit: "unit-1", sqlstate: "23505" });
    const text = textOf(school.name);
    expect(text).toContain("23505");
    expect(text).not.toContain("1-2345-6789");
    expect(text).not.toContain("students_cedula_key");
  });

  it("requires a reason on bypass and exception entries", async () => {
    const { reason: _b, ...bypassWithoutReason } = bypass();
    const { reason: _e, ...exceptionWithoutReason } = exception("index:x");
    const { object: _o, ...exceptionWithoutObject } = exception("index:x");
    const rejected = [
      bypassWithoutReason,
      bypass(""),
      bypass("   "),
      exceptionWithoutReason,
      exception("index:x", " "),
      exceptionWithoutObject,
      exception(""),
    ];

    for (const entry of rejected) {
      await expect(appendEntry(dir, demo, entry)).rejects.toThrow();
    }
    expect(existsSync(fileOf("demo"))).toBe(false);

    await appendEntry(dir, demo, bypass());
    await appendEntry(dir, demo, exception("index:public.students.cedula"));
    const { entries } = await readRecord(dir, "demo");
    expect(entries.map((e) => e.kind)).toEqual(["bypass", "exception"]);
    expect(entries[1].object).toBe("index:public.students.cedula");
    expect(entries[1].reason).toBe("Pilot keeps an older index on purpose");
  });
});

describe("delivery record reader", () => {
  it("reads a project's proved sequence, latest proofs, bypasses and exceptions", async () => {
    const empty = await readProjectState(dir, "demo");
    expect(empty).toEqual({
      provedSequence: 0,
      latestProofs: null,
      openBypasses: [],
      exceptions: [],
    });

    const first = delivery(1);
    first.units.push({ id: "unit-2", sequence: 2, files: [] });
    await appendEntry(dir, demo, first);
    await appendEntry(dir, demo, bypass());
    await appendEntry(dir, demo, delivery(3, { ok: false }));
    await appendEntry(dir, demo, exception("index:a", "first reason"));
    await appendEntry(dir, demo, exception("index:b", "other object"));
    await appendEntry(dir, demo, exception("index:a", "second reason"));

    const state = await readProjectState(dir, "demo");
    expect(state.provedSequence).toBe(2);
    expect(state.latestProofs).toEqual({
      at: "2026-10-03T20:05:00.000Z",
      proofs: [
        { name: "audit", ok: false },
        { name: "demo-lock", ok: true },
        { name: "fingerprint", ok: true },
      ],
    });
    expect(state.openBypasses).toHaveLength(1);
    expect(state.openBypasses[0].reason).toBe(
      "Hotfixed a policy from the dashboard during class",
    );
    expect(state.exceptions.map((e) => [e.object, e.reason]).sort()).toEqual([
      ["index:a", "second reason"],
      ["index:b", "other object"],
    ]);

    await appendEntry(dir, demo, delivery(4));
    const closed = await readProjectState(dir, "demo");
    expect(closed.provedSequence).toBe(4);
    expect(closed.latestProofs.at).toBe("2026-10-04T20:05:00.000Z");
    expect(closed.openBypasses).toEqual([]);
    expect(closed.exceptions).toHaveLength(2);
  });
});
