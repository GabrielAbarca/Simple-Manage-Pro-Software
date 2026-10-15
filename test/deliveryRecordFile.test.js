import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { format, resolveConfig } from "prettier";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  RecordError,
  appendEntry,
  readRecord,
  validateEntry,
} from "../scripts/delivery/record.mjs";

const HASH = "d".repeat(64);
const demo = { name: "demo", holdsRealData: false };

const delivery = (overrides = {}) => ({
  kind: "delivery",
  units: [
    {
      id: "conducta",
      sequence: 1,
      files: [
        { path: "supabase/schema/incremental_conducta.sql", sha256: HASH },
      ],
    },
  ],
  startedAt: "2026-10-09T20:00:00Z",
  endedAt: "2026-10-09T20:05:00Z",
  approver: "Gabriel Zelaya <gzelaya0404@gmail.com>",
  fingerprint: { before: HASH, after: HASH },
  proofs: [{ name: "audit", ok: true }],
  ...overrides,
});

let dir;
const file = () => join(dir, "demo.json");

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "smp-record-file-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("delivery record file", () => {
  it("refuses to append to or read a record edited by hand", async () => {
    await appendEntry(dir, demo, delivery());
    const original = readFileSync(file(), "utf8");

    writeFileSync(file(), JSON.stringify(JSON.parse(original)));
    await expect(appendEntry(dir, demo, delivery())).rejects.toThrow(
      RecordError,
    );
    await expect(readRecord(dir, "demo")).rejects.toThrow(RecordError);

    const smuggled = JSON.parse(original);
    smuggled.entries[0].note = "Ana Mora";
    writeFileSync(file(), `${JSON.stringify(smuggled, null, 2)}\n`);
    await expect(readRecord(dir, "demo")).rejects.toThrow(/outside the schema/);
  });

  it("rejects a delivery that ends before it starts, or a path outside supabase/", () => {
    expect(() =>
      validateEntry(demo, delivery({ endedAt: "2026-10-09T19:00:00Z" })),
    ).toThrow(RecordError);
    expect(() =>
      validateEntry(demo, delivery({ startedAt: "2026-02-30T20:00:00Z" })),
    ).toThrow(RecordError);
    const escaping = delivery();
    escaping.units[0].files[0].path = "supabase/../.env";
    expect(() => validateEntry(demo, escaping)).toThrow(RecordError);
  });

  it("drops a failure's message on a project without real data too", () => {
    const stored = validateEntry(
      demo,
      delivery({
        proofs: [{ name: "audit", ok: false }],
        failure: { unit: "conducta", sqlstate: null, message: "Ana Mora" },
      }),
    );
    expect(stored.failure).toEqual({ unit: "conducta", sqlstate: null });
    expect(JSON.stringify(stored)).not.toContain("Ana Mora");
  });

  it("accepts only an identifier as an exception's object", () => {
    const exception = (object) => ({
      kind: "exception",
      at: "2026-10-09T21:00:00Z",
      approver: "Gabriel Zelaya <gzelaya0404@gmail.com>",
      object,
      reason: "Recorded on purpose",
    });
    for (const object of [
      "Ana Mora cedula 1-2345-6789",
      "index: public.students",
      "public.students.cedula",
      "index:Ana Mora",
    ]) {
      expect(() => validateEntry(demo, exception(object))).toThrow(RecordError);
    }
    for (const object of [
      "index:public.students.cedula",
      "policy:public.students.students_select_own",
      "function:public.is_admin()",
      "function:public.grade_of(uuid,text)",
    ]) {
      expect(validateEntry(demo, exception(object)).object).toBe(object);
    }
  });

  it("accepts only a name and an email as the approver", () => {
    for (const approver of [
      "Ana Mora 1-2345-6789 cedula, 7-B <a@b.c>",
      "X\r\u0000\t <a@b.c>",
      "Gabriel Zelaya",
    ]) {
      expect(() => validateEntry(demo, delivery({ approver }))).toThrow(
        RecordError,
      );
    }
    for (const approver of [
      "Gabriel Zelaya <gzelaya0404@gmail.com>",
      "María José O'Neill-Núñez <mj@escuela.cr>",
    ]) {
      expect(validateEntry(demo, delivery({ approver })).approver).toBe(
        approver,
      );
    }
  });

  it("writes a record Prettier leaves unchanged", async () => {
    await appendEntry(dir, demo, delivery());
    await appendEntry(dir, demo, {
      kind: "exception",
      at: "2026-10-09T21:00:00Z",
      approver: "Gabriel Zelaya <gzelaya0404@gmail.com>",
      object: "index:public.students.cedula",
      reason: "Índice heredado del piloto",
    });
    expect(existsSync(`${file()}.tmp`)).toBe(false);
    const text = readFileSync(file(), "utf8");
    const options = await resolveConfig(join(process.cwd(), "demo.json"));
    expect(await format(text, { ...options, parser: "json" })).toBe(text);
  });
});
