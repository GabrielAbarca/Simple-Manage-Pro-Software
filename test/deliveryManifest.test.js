import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkManifest,
  checkProjects,
  loadManifest,
  loadProjects,
  requiredSequence,
  unitsFor,
} from "../scripts/delivery/manifest.mjs";

const SCHEMA_FILES = readdirSync(join(process.cwd(), "supabase", "schema"));

const CONDUCTA_CHECK =
  "select count(*) from public.student_period_conduct where conduct_score <> 100";

const unit = (overrides = {}) => ({
  seq: 1,
  id: "conducta",
  files: ["incremental_conducta.sql"],
  appliesTo: ["demo", "school"],
  functions: [],
  auth: [],
  checks: [{ id: "conducta-unchanged", sql: CONDUCTA_CHECK, expect: 0 }],
  ...overrides,
});

const project = (overrides = {}) => ({
  name: "pilot",
  ref: "wklxkntdnzshyrijvnjj",
  type: "school",
  site: "smp-pilot",
  origin: "https://pilot.simplemanagepro.com",
  holdsRealData: false,
  window: null,
  ...overrides,
});

const saturdayWindow = {
  timezone: "America/Costa_Rica",
  slots: [{ days: [6, 7], from: "14:00", to: "20:00" }],
};

describe("delivery manifest", () => {
  it("accepts the committed manifest and project list", () => {
    const manifest = loadManifest();
    expect(manifest.units).toEqual([
      {
        seq: 1,
        id: "conducta",
        files: ["incremental_conducta.sql"],
        appliesTo: ["demo", "school"],
        functions: [],
        auth: [],
        checks: [{ id: "conducta-unchanged", sql: CONDUCTA_CHECK, expect: 0 }],
      },
    ]);

    const { projects } = loadProjects();
    expect(
      projects.map(({ name, type, site, holdsRealData }) => ({
        name,
        type,
        site,
        holdsRealData,
      })),
    ).toEqual([
      {
        name: "demo",
        type: "demo",
        site: "demo-smp-web-page",
        holdsRealData: false,
      },
      {
        name: "pilot",
        type: "school",
        site: "smp-pilot",
        holdsRealData: false,
      },
    ]);
    for (const { ref, origin } of projects) {
      expect(ref).toMatch(/^[a-z]{20}$/);
      expect(origin).toMatch(/^https:\/\//);
    }
  });

  it("refuses to load a malformed manifest or project list, with the reason", () => {
    const root = mkdtempSync(join(tmpdir(), "smp-manifest-"));
    mkdirSync(join(root, "supabase", "delivery"), { recursive: true });
    mkdirSync(join(root, "supabase", "schema"), { recursive: true });
    writeFileSync(
      join(root, "supabase", "schema", "incremental_conducta.sql"),
      "",
    );
    writeFileSync(
      join(root, "supabase", "delivery", "manifest.json"),
      JSON.stringify({ units: [unit(), unit({ seq: 2 })] }),
    );
    writeFileSync(
      join(root, "supabase", "delivery", "projects.json"),
      JSON.stringify({ projects: [project({ type: "staging" })] }),
    );

    expect(() => loadManifest(root)).toThrow(/manifest\.json[\s\S]*conducta/);
    expect(() => loadProjects(root)).toThrow(/projects\.json[\s\S]*staging/);
  });

  it("rejects units out of sequence or with a repeated id", () => {
    expect(
      checkManifest(
        { units: [unit(), unit({ seq: 2, id: "schema-version" })] },
        SCHEMA_FILES,
      ),
    ).toEqual([]);

    const outOfOrder = checkManifest(
      { units: [unit({ seq: 2 }), unit({ seq: 1, id: "schema-version" })] },
      SCHEMA_FILES,
    );
    expect(outOfOrder).toHaveLength(1);
    expect(outOfOrder[0]).toMatch(/schema-version/);
    expect(outOfOrder[0]).toMatch(/sequence/i);

    const sameSeq = checkManifest(
      { units: [unit(), unit({ id: "schema-version" })] },
      SCHEMA_FILES,
    );
    expect(sameSeq).toHaveLength(1);
    expect(sameSeq[0]).toMatch(/sequence/i);

    const repeated = checkManifest(
      { units: [unit(), unit({ seq: 2 })] },
      SCHEMA_FILES,
    );
    expect(repeated).toHaveLength(1);
    expect(repeated[0]).toMatch(/conducta/);
    expect(repeated[0]).toMatch(/repeat|duplicate/i);
  });

  it("rejects a unit with a missing schema file or a check that is not a single select", () => {
    const missing = checkManifest(
      { units: [unit({ files: ["incremental_nothing_here.sql"] })] },
      SCHEMA_FILES,
    );
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatch(/incremental_nothing_here\.sql/);

    const escaping = checkManifest(
      { units: [unit({ files: ["../schema/incremental_conducta.sql"] })] },
      SCHEMA_FILES,
    );
    expect(escaping).toHaveLength(1);

    for (const sql of [
      "delete from public.student_conduct_grades",
      `${CONDUCTA_CHECK}; drop table public.students`,
      "",
    ]) {
      const bad = checkManifest(
        { units: [unit({ checks: [{ id: "bad", sql, expect: 0 }] })] },
        SCHEMA_FILES,
      );
      expect(bad, sql).toHaveLength(1);
      expect(bad[0], sql).toMatch(/select/i);
    }

    expect(
      checkManifest(
        {
          units: [
            unit({
              checks: [
                { id: "trailing", sql: `  SELECT 1;  `, expect: 1 },
                { id: "conducta-unchanged", sql: CONDUCTA_CHECK, expect: 0 },
              ],
            }),
          ],
        },
        SCHEMA_FILES,
      ),
    ).toEqual([]);
  });

  it("rejects an unknown project type and a real-data project without a delivery window", () => {
    expect(
      checkProjects({
        projects: [
          project({ name: "demo", ref: "jgszeiccaycnpzhuwclb", type: "demo" }),
          project(),
          project({
            name: "school-a",
            ref: "abcdefghijabcdefghij",
            holdsRealData: true,
            window: saturdayWindow,
          }),
        ],
      }),
    ).toEqual([]);

    const unknown = checkProjects({ projects: [project({ type: "staging" })] });
    expect(unknown).toHaveLength(1);
    expect(unknown[0]).toMatch(/staging/);

    const noWindow = checkProjects({
      projects: [project({ holdsRealData: true, window: null })],
    });
    expect(noWindow).toHaveLength(1);
    expect(noWindow[0]).toMatch(/pilot/);
    expect(noWindow[0]).toMatch(/window/i);

    const badDay = checkProjects({
      projects: [
        project({
          holdsRealData: true,
          window: {
            ...saturdayWindow,
            slots: [{ days: [0], from: "14:00", to: "20:00" }],
          },
        }),
      ],
    });
    expect(badDay).toHaveLength(1);
    expect(badDay[0]).toMatch(/window/i);
  });

  it("derives the required sequence and a project's pending units", () => {
    const manifest = {
      units: [
        unit(),
        unit({ seq: 2, id: "schema-version" }),
        unit({ seq: 5, id: "demo-only", appliesTo: ["demo"] }),
        unit({ seq: 7, id: "school-only", appliesTo: ["school"] }),
      ],
    };

    expect(requiredSequence(manifest)).toBe(7);
    expect(requiredSequence({ units: [] })).toBe(0);

    const ids = (/** @type {{ id: string }[]} */ units) =>
      units.map((u) => u.id);
    expect(ids(unitsFor(manifest, "school", 0))).toEqual([
      "conducta",
      "schema-version",
      "school-only",
    ]);
    expect(ids(unitsFor(manifest, "demo", 1))).toEqual([
      "schema-version",
      "demo-only",
    ]);
    expect(ids(unitsFor(manifest, "school", 7))).toEqual([]);
  });
});
