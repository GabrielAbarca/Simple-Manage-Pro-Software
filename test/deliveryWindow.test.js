import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main } from "../scripts/delivery/deliver.mjs";
import { windowOpen, windowRefusal } from "../scripts/delivery/window.mjs";
import {
  LICEO_REF,
  deliveryDeps,
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
    slots: [
      { days: [6], from: "08:00", to: "12:00" },
      { days: [1, 2, 3, 4, 5], from: "19:00", to: "22:00" },
    ],
  },
};

const SATURDAY_0900 = new Date("2026-10-31T15:00:00.000Z");
const WEDNESDAY_2030 = new Date("2026-10-29T02:30:00.000Z");
const SATURDAY_1300 = new Date("2026-10-31T19:00:00.000Z");
const SUNDAY_0900 = new Date("2026-11-01T15:00:00.000Z");
const WEDNESDAY_2200 = new Date("2026-10-29T04:00:00.000Z");
const WEDNESDAY_1859 = new Date("2026-10-29T00:59:00.000Z");

describe("the delivery window", () => {
  let recordsDir;
  let schemaDir;
  beforeEach(() => {
    recordsDir = mkdtempSync(join(tmpdir(), "smp-window-records-"));
    schemaDir = schemaDirWith(["incremental_conducta.sql"]);
  });
  afterEach(() => {
    rmSync(recordsDir, { recursive: true, force: true });
    rmSync(schemaDir, { recursive: true, force: true });
  });

  /** @param {Date} now */
  const runWith = (now) => {
    const executor = fakeExecutor({ type: "school" });
    const run = deliveryDeps({
      recordsDir,
      schemaDir,
      executor,
      input: ttyInput(`${LICEO_REF}\n`),
      now,
      projects: [pilot, liceo],
    });
    return { ...run, executor };
  };

  it("refuses a real-data project outside its delivery window with no override", async () => {
    for (const inside of [SATURDAY_0900, WEDNESDAY_2030]) {
      expect(windowOpen(liceo.window, inside)).toBe(true);
      expect(windowRefusal(liceo, inside)).toBeNull();
    }
    for (const outside of [
      SATURDAY_1300,
      SUNDAY_0900,
      WEDNESDAY_2200,
      WEDNESDAY_1859,
    ]) {
      expect(windowOpen(liceo.window, outside)).toBe(false);
      expect(windowRefusal(liceo, outside)).toMatch(
        /outside its delivery window/,
      );
    }
    expect(windowRefusal({ ...liceo, window: null }, SATURDAY_0900)).toMatch(
      /no delivery window/,
    );
    expect(windowRefusal(pilot, SUNDAY_0900)).toBeNull();

    for (const argv of [
      ["liceo-norte"],
      ["liceo-norte", "--force"],
      ["liceo-norte", "--override-window"],
      ["--ignore-window", "liceo-norte"],
    ]) {
      const run = runWith(SUNDAY_0900);
      expect(await main(argv, run.deps)).toBe(false);
      expect(run.connect).not.toHaveBeenCalled();
      expect(run.executor.calls).toEqual([]);
      expect(run.prepareCommit).not.toHaveBeenCalled();
      expect(existsSync(join(recordsDir, "liceo-norte.json"))).toBe(false);
      if (argv.length === 1) {
        expect(run.printed()).toMatch(/outside its delivery window/);
      }
    }

    const open = runWith(SATURDAY_0900);
    expect(await main(["liceo-norte"], open.deps)).toBe(true);
    expect(open.connect).toHaveBeenCalledTimes(1);
    expect(open.executor.applied()).toEqual(["incremental_conducta.sql"]);
  });
});
