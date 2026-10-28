import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  deliver,
  markerStatement,
  recordBranch,
} from "../scripts/delivery/deliver.mjs";
import {
  DEMO_REF,
  deliveryDeps,
  fakeExecutor,
  schemaDirWith,
  ttyInput,
} from "./fixtures/delivery/fakes.js";

describe("deliver refusals and helpers", () => {
  let recordsDir;
  let schemaDir;
  beforeEach(() => {
    recordsDir = mkdtempSync(join(tmpdir(), "smp-deliver-refusals-"));
    schemaDir = schemaDirWith(["incremental_conducta.sql"]);
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
});
