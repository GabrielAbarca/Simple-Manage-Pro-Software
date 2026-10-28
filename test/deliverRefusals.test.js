import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkoutProblem,
  deliver,
  markerStatement,
  prepareRecordCommit,
  recordBranch,
} from "../scripts/delivery/deliver.mjs";
import { readRecord } from "../scripts/delivery/record.mjs";
import {
  DEMO_REF,
  LICEO_REF,
  MARKER,
  conducta,
  deliveryDeps,
  demo,
  fakeExecutor,
  pilot,
  schemaDirWith,
  ttyInput,
} from "./fixtures/delivery/fakes.js";

const liceo = {
  name: "liceo-norte",
  ref: LICEO_REF,
  type: "school",
  site: "liceo-norte",
  origin: "https://liceo-norte.example.com",
  holdsRealData: true,
  window: {
    timezone: "America/Costa_Rica",
    slots: [{ days: [6], from: "08:00", to: "12:00" }],
  },
};

describe("deliver refusals and helpers", () => {
  let recordsDir;
  let schemaDir;
  beforeEach(() => {
    recordsDir = mkdtempSync(join(tmpdir(), "smp-deliver-refusals-"));
    schemaDir = schemaDirWith(["incremental_conducta.sql", "later.sql"]);
  });
  afterEach(() => {
    rmSync(recordsDir, { recursive: true, force: true });
    rmSync(schemaDir, { recursive: true, force: true });
  });

  const attempt = async (project, overrides = {}) => {
    const executor = fakeExecutor({ type: "demo" });
    const run = deliveryDeps({
      recordsDir,
      schemaDir,
      executor,
      input: ttyInput(`${DEMO_REF}\n`),
    });
    const result = await deliver({ ...run.deps, ...overrides, project });
    return { ...run, executor, result };
  };

  it("refuses an unknown project before asking for anything", async () => {
    const run = await attempt("staging");
    expect(run.result.ok).toBe(false);
    expect(run.result.reason).toMatch(/unknown project "staging"/);
    expect(run.connect).not.toHaveBeenCalled();
  });

  it("refuses an approver the record would reject before connecting", async () => {
    const run = await attempt("demo", { approver: "someone" });
    expect(run.result.ok).toBe(false);
    expect(run.result.reason).toMatch(/record would refuse/);
    expect(run.connect).not.toHaveBeenCalled();
    expect(existsSync(join(recordsDir, "demo.json"))).toBe(false);
  });

  it("connects to nothing when no unit is pending", async () => {
    const first = await attempt("demo");
    expect(first.result.ok).toBe(true);
    const again = await attempt("demo");
    expect(again.result.ok).toBe(true);
    expect(again.result.delivered).toEqual([]);
    expect(again.connect).not.toHaveBeenCalled();
    expect(again.printed()).toMatch(/Nothing pending for demo/);
  });

  it("names the record branch by the branch rule", () => {
    expect(recordBranch("demo")).toBe("chore/record-demo");
    expect(recordBranch("liceo-norte")).toBe("chore/record-liceo-norte");
    expect(recordBranch("colegio-san-jose")).toBeNull();
  });

  it("writes the marker as the architecture's single upsert", () => {
    expect(markerStatement(3)).toBe(
      "insert into public.app_config (key, value) values ('schema_version', '3') on conflict (key) do update set value = excluded.value;",
    );
  });

  it("stops before the next unit once the delivery window has closed", async () => {
    let closed = false;
    const executor = fakeExecutor({
      type: "school",
      statements: (sql) => {
        if (MARKER.test(sql)) closed = true;
        return null;
      },
    });
    const run = deliveryDeps({
      recordsDir,
      schemaDir,
      executor,
      input: ttyInput(`${LICEO_REF}\n`),
      projects: [pilot, liceo],
      units: [
        conducta,
        { ...conducta, seq: 2, id: "later", files: ["later.sql"] },
      ],
    });
    const result = await deliver({
      ...run.deps,
      project: "liceo-norte",
      now: () =>
        new Date(
          closed ? "2026-10-31T19:00:00.000Z" : "2026-10-31T15:00:00.000Z",
        ),
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/outside its delivery window/);
    expect(result.delivered).toEqual(["conducta"]);
    expect(executor.applied()).toEqual(["incremental_conducta.sql"]);
    const { entries } = await readRecord(recordsDir, "liceo-norte");
    expect(entries.map((entry) => entry.units[0].id)).toEqual(["conducta"]);
    expect(run.prepareCommit).toHaveBeenCalledTimes(1);
    expect(run.prepareCommit.mock.calls[0][0].units).toEqual(["conducta"]);
  });

  it("says the marker was written when the record entry then fails", async () => {
    let clock = Date.parse("2026-10-28T20:00:00.000Z");
    const run = await attempt("demo", {
      now: () => new Date((clock -= 60_000)),
    });
    expect(run.result.ok).toBe(false);
    expect(
      run.executor.statementsRun().filter((sql) => MARKER.test(sql)),
    ).toHaveLength(1);
    expect(run.printed()).toMatch(/marker for conducta was written/);
    expect(run.printed()).not.toMatch(/No marker was written/);
  });

  it("cuts the record branch from origin/main and commits only the record", async () => {
    const calls = [];
    const git = (...args) => {
      calls.push(args);
      if (args[0] === "rev-parse") throw new Error("absent");
      return "";
    };
    const file = join(recordsDir, "demo.json");
    const commit = await prepareRecordCommit(
      { project: demo, file, units: ["conducta"] },
      git,
    );
    expect(commit).toEqual({ branch: "chore/record-demo", reason: null });
    expect(calls).toEqual([
      ["rev-parse", "--verify", "--quiet", "refs/heads/chore/record-demo"],
      ["fetch", "origin", "main"],
      ["switch", "-c", "chore/record-demo", "origin/main"],
      ["add", "--", file],
      [
        "commit",
        "-m",
        "Record the delivery of conducta to demo",
        "--only",
        "--",
        file,
      ],
    ]);

    const taken = await prepareRecordCommit(
      { project: demo, file, units: ["conducta"] },
      () => "",
    );
    expect(taken).toEqual({
      branch: null,
      reason: "branch chore/record-demo already exists",
    });
  });

  it("records a step that throws as a failed proof", async () => {
    const base = fakeExecutor({ type: "demo" });
    const executor = {
      ...base,
      runFile: async (path) => {
        if (basename(path) === "rls_audit.sql") {
          throw new Error("socket hang up");
        }
        return base.runFile(path);
      },
    };
    const run = deliveryDeps({
      recordsDir,
      schemaDir,
      executor,
      input: ttyInput(`${DEMO_REF}\n`),
    });
    const result = await deliver({ ...run.deps, project: "demo" });

    expect(result.ok).toBe(false);
    expect(result.failure).toEqual({
      unit: "conducta",
      proof: "audit",
      sqlstate: null,
    });
    expect(base.statementsRun().filter((sql) => MARKER.test(sql))).toEqual([]);
    const { entries } = await readRecord(recordsDir, "demo");
    expect(entries).toHaveLength(1);
    expect(entries[0].proofs).toEqual([
      { name: "apply", ok: true },
      { name: "demo-lock", ok: true },
      { name: "audit", ok: false },
    ]);
    expect(entries[0].failure).toEqual({ unit: "conducta", sqlstate: null });
    expect(run.printed()).toMatch(/audit: FAIL: socket hang up/);
  });

  it("refuses before the ref prompt when the checkout is not origin/main", async () => {
    const run = await attempt("demo", {
      verifyCheckout: () => "HEAD is not origin/main",
    });
    expect(run.result.ok).toBe(false);
    expect(run.result.reason).toBe("HEAD is not origin/main");
    expect(run.connect).not.toHaveBeenCalled();
    expect(run.printed()).not.toMatch(/Type demo's project ref/);
    expect(existsSync(join(recordsDir, "demo.json"))).toBe(false);
  });

  it("checks the checkout and the record branch before anything runs", () => {
    const gitWith = (answers) => {
      const calls = [];
      const git = (...args) => {
        calls.push(args.join(" "));
        const key = args.join(" ");
        if (key in answers) {
          if (answers[key] instanceof Error) throw answers[key];
          return answers[key];
        }
        if (args[0] === "rev-parse" && args[1] === "--verify") {
          throw new Error("absent");
        }
        return "";
      };
      return { git, calls };
    };
    const healthy = {
      "rev-parse HEAD": "a1b2c3",
      "rev-parse origin/main": "a1b2c3",
      "status --porcelain -- supabase/": "",
    };

    const good = gitWith(healthy);
    expect(checkoutProblem(demo, good.git)).toBeNull();
    expect(good.calls[0]).toBe("fetch origin main");

    expect(
      checkoutProblem(
        demo,
        gitWith({ ...healthy, "rev-parse HEAD": "d4e5f6" }).git,
      ),
    ).toMatch(/HEAD is not origin\/main/);
    expect(
      checkoutProblem(
        demo,
        gitWith({
          ...healthy,
          "status --porcelain -- supabase/":
            "?? supabase/delivery/records/demo.json",
        }).git,
      ),
    ).toMatch(/supabase\/ has uncommitted changes/);
    expect(
      checkoutProblem(
        demo,
        gitWith({
          ...healthy,
          "rev-parse --verify --quiet refs/heads/chore/record-demo": "a1b2c3",
        }).git,
      ),
    ).toMatch(/chore\/record-demo already exists/);
    expect(
      checkoutProblem(
        { ...demo, name: "colegio-san-jose" },
        gitWith(healthy).git,
      ),
    ).toMatch(/does not fit the branch rule/);
  });

  it("tells the owner the checkout moved to the record branch", async () => {
    const run = await attempt("demo");
    expect(run.result.ok).toBe(true);
    expect(run.printed()).toMatch(
      /Record committed on chore\/record-demo \(now checked out\)/,
    );
  });
});
