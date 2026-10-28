import { describe, expect, it } from "vitest";
import {
  checkManifest,
  isSingleSelect,
} from "../scripts/delivery/manifest.mjs";

const SCHEMA_FILES = ["incremental_conducta.sql"];

const unitWithCheck = (sql) => ({
  units: [
    {
      seq: 1,
      id: "conducta",
      files: ["incremental_conducta.sql"],
      appliesTo: ["demo", "school"],
      functions: [],
      auth: [],
      checks: [{ id: "probe", sql, expect: 0 }],
    },
  ],
});

describe("delivery manifest: a check is a plain select", () => {
  it("rejects a select that writes its rows into a table", () => {
    const problems = checkManifest(
      unitWithCheck("select * into public.leak from public.students"),
      SCHEMA_FILES,
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/conducta.*not a single select/);
    expect(
      isSingleSelect("SELECT id INTO TEMP copy FROM public.students;"),
    ).toBe(false);
  });

  it("still accepts plain selects, including the committed conducta check", () => {
    const conductaCheck =
      "select count(*) from public.student_period_conduct where conduct_score <> 100";

    expect(checkManifest(unitWithCheck(conductaCheck), SCHEMA_FILES)).toEqual(
      [],
    );
    expect(isSingleSelect("select interval_days from public.settings;")).toBe(
      true,
    );
  });
});
