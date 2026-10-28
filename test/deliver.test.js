import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deliver } from "../scripts/delivery/deliver.mjs";
import { AUDIT_LEFTOVERS_SQL } from "../scripts/delivery/proofs.mjs";
import {
  appendEntry,
  readProjectState,
  readRecord,
} from "../scripts/delivery/record.mjs";
import {
  APPROVER,
  DEMO_REF,
  MARKER,
  PILOT_REF,
  conducta,
  deliveryDeps,
  demo,
  fakeExecutor,
  pipedInput,
  schemaDirWith,
  ttyInput,
} from "./fixtures/delivery/fakes.js";

/**
 * @param {number} seq
 * @param {string} id
 * @param {string[]} files
 * @param {string[]} [appliesTo]
 */
const unit = (seq, id, files, appliesTo = ["demo", "school"]) => ({
  seq,
  id,
  files,
  appliesTo,
  functions: [],
  auth: [],
  checks: [],
});

const markersOf = (executor) =>
  executor
    .statementsRun()
    .map((sql) => MARKER.exec(sql.trim())?.[1])
    .filter(Boolean);

describe("the deliver command", () => {
  /** @type {string[]} */
  let dirs;
  let schemaDir;

  const freshDir = () => {
    const dir = mkdtempSync(join(tmpdir(), "smp-deliver-records-"));
    dirs.push(dir);
    return dir;
  };

  /**
   * @param {{ project?: string, recordsDir?: string, executor?: ReturnType<typeof fakeExecutor>, input?: NodeJS.ReadableStream, units?: object[] }} [options]
   */
  async function attempt({
    project = "demo",
    recordsDir = freshDir(),
    executor = fakeExecutor({ type: project === "demo" ? "demo" : "school" }),
    input = ttyInput(`${project === "demo" ? DEMO_REF : PILOT_REF}\n`),
    units,
  } = {}) {
    const run = deliveryDeps({
      recordsDir,
      schemaDir,
      executor,
      input,
      units,
    });
    const result = await deliver({ ...run.deps, project });
    return { ...run, result, executor, recordsDir };
  }

  const lastEntry = async (recordsDir, name) => {
    const { entries } = await readRecord(recordsDir, name);
    return entries[entries.length - 1];
  };

  beforeEach(() => {
    dirs = [];
    schemaDir = schemaDirWith([
      "incremental_conducta.sql",
      "zero.sql",
      "alpha_one.sql",
      "alpha_two.sql",
      "school_only.sql",
      "beta.sql",
    ]);
    dirs.push(schemaDir);
  });
  afterEach(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  it("refuses without a TTY or a matching typed ref and applies nothing", async () => {
    const recordsDir = freshDir();
    const piped = await attempt({
      recordsDir,
      input: pipedInput(`${DEMO_REF}\n`),
    });
    expect(piped.result.ok).toBe(false);
    expect(piped.result.reason).toMatch(/terminal/);

    const wrong = await attempt({
      recordsDir,
      input: ttyInput(`${PILOT_REF}\n`),
    });
    expect(wrong.result.ok).toBe(false);
    expect(wrong.result.reason).toMatch(/does not match/);

    const nothing = await attempt({ recordsDir, input: ttyInput("") });
    expect(nothing.result.ok).toBe(false);
    expect(nothing.result.reason).toMatch(/does not match/);

    for (const run of [piped, wrong, nothing]) {
      expect(run.connect).not.toHaveBeenCalled();
      expect(run.executor.calls).toEqual([]);
      expect(run.prepareCommit).not.toHaveBeenCalled();
      expect(run.result.delivered).toEqual([]);
    }
    expect(existsSync(join(recordsDir, "demo.json"))).toBe(false);

    const typed = await attempt({
      recordsDir,
      input: ttyInput(`${DEMO_REF}\n`),
    });
    expect(typed.result.ok).toBe(true);
    expect(typed.connect).toHaveBeenCalledTimes(1);
    expect(typed.executor.applied()).toContain("incremental_conducta.sql");
    expect(existsSync(join(recordsDir, "demo.json"))).toBe(true);
  });

  it("applies pending units in order and re-locks the demo after each one", async () => {
    const recordsDir = freshDir();
    const units = [
      unit(1, "zero", ["zero.sql"]),
      unit(2, "alpha", ["alpha_one.sql", "alpha_two.sql"]),
      unit(3, "school-only", ["school_only.sql"], ["school"]),
      unit(4, "beta", ["beta.sql"]),
    ];
    await appendEntry(recordsDir, demo, {
      kind: "delivery",
      units: [
        {
          id: "zero",
          sequence: 1,
          files: [{ path: "supabase/schema/zero.sql", sha256: "a".repeat(64) }],
        },
      ],
      startedAt: "2026-10-01T20:00:00.000Z",
      endedAt: "2026-10-01T20:05:00.000Z",
      approver: APPROVER,
      fingerprint: { before: "b".repeat(64), after: null },
      proofs: [{ name: "audit", ok: true }],
    });

    const run = await attempt({ recordsDir, units });

    expect(run.result.ok).toBe(true);
    expect(run.result.delivered).toEqual(["alpha", "beta"]);
    expect(run.executor.applied()).toEqual([
      "alpha_one.sql",
      "alpha_two.sql",
      "demo_lockdown.sql",
      "beta.sql",
      "demo_lockdown.sql",
    ]);
    expect(markersOf(run.executor)).toEqual(["2", "4"]);

    const sha = (file) =>
      createHash("sha256")
        .update(readFileSync(join(schemaDir, file)))
        .digest("hex");
    const { entries } = await readRecord(recordsDir, "demo");
    expect(entries).toHaveLength(3);
    expect(entries.slice(1).map((entry) => entry.units)).toEqual([
      [
        {
          id: "alpha",
          sequence: 2,
          files: [
            {
              path: "supabase/schema/alpha_one.sql",
              sha256: sha("alpha_one.sql"),
            },
            {
              path: "supabase/schema/alpha_two.sql",
              sha256: sha("alpha_two.sql"),
            },
            {
              path: "supabase/schema/demo_lockdown.sql",
              sha256: sha("demo_lockdown.sql"),
            },
          ],
        },
      ],
      [
        {
          id: "beta",
          sequence: 4,
          files: [
            { path: "supabase/schema/beta.sql", sha256: sha("beta.sql") },
            {
              path: "supabase/schema/demo_lockdown.sql",
              sha256: sha("demo_lockdown.sql"),
            },
          ],
        },
      ],
    ]);
    expect((await readProjectState(recordsDir, "demo")).provedSequence).toBe(4);
  });

  it("never locks a school project and fails if a demo lock is found there", async () => {
    const clean = await attempt({ project: "pilot" });
    expect(clean.result.ok).toBe(true);
    expect(clean.result.delivered).toEqual(["conducta"]);
    expect(clean.executor.applied()).toEqual(["incremental_conducta.sql"]);
    expect(markersOf(clean.executor)).toEqual(["1"]);
    const passed = await lastEntry(clean.recordsDir, "pilot");
    expect(passed.proofs).toContainEqual({ name: "demo-lock", ok: true });
    expect(passed.units[0].files.map((file) => file.path)).toEqual([
      "supabase/schema/incremental_conducta.sql",
    ]);

    const locked = await attempt({
      project: "pilot",
      executor: fakeExecutor({ type: "school", locks: { students: 3 } }),
    });
    expect(locked.result.ok).toBe(false);
    expect(locked.result.delivered).toEqual([]);
    expect(locked.result.failure).toEqual({
      unit: "conducta",
      proof: "demo-lock",
      sqlstate: null,
    });
    expect(locked.executor.applied()).not.toContain("demo_lockdown.sql");
    expect(markersOf(locked.executor)).toEqual([]);
    const failed = await lastEntry(locked.recordsDir, "pilot");
    expect(failed.proofs).toContainEqual({ name: "demo-lock", ok: false });
    expect(failed.failure).toEqual({ unit: "conducta", sqlstate: null });
  });

  it("writes the marker only after every proof passes and records a failure otherwise", async () => {
    const checkSql = conducta.checks[0].sql;

    const good = await attempt();
    expect(good.result.ok).toBe(true);
    const calls = good.executor.calls;
    const at = (match) => calls.findIndex(match);
    const markerAt = at((call) => "sql" in call && MARKER.test(call.sql));
    const proofsAt = [
      at((call) => "sql" in call && /pg_policies/.test(call.sql)),
      at((call) => "file" in call && call.file === "rls_audit.sql"),
      at((call) => "sql" in call && call.sql === AUDIT_LEFTOVERS_SQL),
      at((call) => "sql" in call && call.sql === checkSql),
    ];
    expect(proofsAt.every((index) => index >= 0)).toBe(true);
    expect(markerAt).toBeGreaterThan(Math.max(...proofsAt));
    expect(markersOf(good.executor)).toEqual(["1"]);
    const passed = await lastEntry(good.recordsDir, "demo");
    expect(passed.proofs).toEqual([
      { name: "apply", ok: true },
      { name: "demo-lock", ok: true },
      { name: "audit", ok: true },
      { name: "audit-leftovers", ok: true },
      { name: "check.conducta-unchanged", ok: true },
      { name: "marker", ok: true },
    ]);
    expect(passed.failure).toBeUndefined();
    expect(passed.approver).toBe(APPROVER);
    expect(passed.fingerprint.after).toBeNull();
    expect(good.prepareCommit).toHaveBeenCalledTimes(1);
    expect(good.prepareCommit.mock.calls[0][0].file).toBe(
      join(good.recordsDir, "demo.json"),
    );

    const audit = await attempt({
      executor: fakeExecutor({ type: "demo", audit: "fail" }),
    });
    expect(audit.result.ok).toBe(false);
    expect(audit.result.failure).toEqual({
      unit: "conducta",
      proof: "audit",
      sqlstate: "P0001",
    });
    expect(markersOf(audit.executor)).toEqual([]);
    expect(audit.executor.statementsRun()).not.toContain(checkSql);
    const auditEntry = await lastEntry(audit.recordsDir, "demo");
    expect(auditEntry.proofs).toEqual([
      { name: "apply", ok: true },
      { name: "demo-lock", ok: true },
      { name: "audit", ok: false },
    ]);
    expect(auditEntry.failure).toEqual({ unit: "conducta", sqlstate: "P0001" });

    const check = await attempt({
      executor: fakeExecutor({
        type: "demo",
        checkRows: { [checkSql]: [["4"]] },
      }),
    });
    expect(check.result.ok).toBe(false);
    expect(check.result.failure).toEqual({
      unit: "conducta",
      proof: "check.conducta-unchanged",
      sqlstate: null,
    });
    expect(markersOf(check.executor)).toEqual([]);
    const checkEntry = await lastEntry(check.recordsDir, "demo");
    expect(checkEntry.proofs.at(-1)).toEqual({
      name: "check.conducta-unchanged",
      ok: false,
    });

    const apply = await attempt({
      executor: fakeExecutor({
        type: "demo",
        files: {
          "incremental_conducta.sql": {
            ok: false,
            sqlstate: "42P10",
            error: "there is no unique or exclusion constraint",
          },
        },
      }),
    });
    expect(apply.result.ok).toBe(false);
    expect(apply.result.failure).toEqual({
      unit: "conducta",
      proof: "apply",
      sqlstate: "42P10",
    });
    expect(apply.executor.applied()).toEqual(["incremental_conducta.sql"]);
    expect(markersOf(apply.executor)).toEqual([]);
    const applyEntry = await lastEntry(apply.recordsDir, "demo");
    expect(applyEntry.proofs).toEqual([{ name: "apply", ok: false }]);
    expect(applyEntry.failure).toEqual({ unit: "conducta", sqlstate: "42P10" });

    for (const run of [audit, check, apply]) {
      expect(run.prepareCommit).toHaveBeenCalledTimes(1);
      expect(
        (await readProjectState(run.recordsDir, "demo")).provedSequence,
      ).toBe(0);
    }
  });
});
