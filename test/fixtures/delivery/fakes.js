import { vi } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { PassThrough, Writable } from "node:stream";
import {
  AUDIT_LEFTOVERS_SQL,
  AUDIT_SUMMARY,
} from "../../../scripts/delivery/proofs.mjs";

export const APPROVER = "Gabriel Zelaya <gzelaya0404@gmail.com>";
export const DEMO_REF = "jgszeiccaycnpzhuwclb";
export const PILOT_REF = "wklxkntdnzshyrijvnjj";
export const LICEO_REF = "abcdefghijklmnopqrst";
export const MARKER =
  /^insert into public\.app_config \(key, value\) values \('schema_version', '(\d+)'\)\s+on conflict \(key\) do update set value = excluded\.value;?$/;
export const TABLES = ["grades", "students", "teachers"];

export const demo = {
  name: "demo",
  ref: DEMO_REF,
  type: "demo",
  site: "demo-smp-web-page",
  origin: "https://demo.simplemanagepro.com",
  holdsRealData: false,
  window: null,
};

export const pilot = {
  name: "pilot",
  ref: PILOT_REF,
  type: "school",
  site: "smp-pilot",
  origin: "https://pilot.simplemanagepro.com",
  holdsRealData: false,
  window: null,
};

export const conducta = {
  seq: 1,
  id: "conducta",
  files: ["incremental_conducta.sql"],
  appliesTo: ["demo", "school"],
  functions: [],
  auth: [],
  checks: [
    {
      id: "conducta-unchanged",
      sql: "select count(*) from public.student_period_conduct where conduct_score <> 100",
      expect: 0,
    },
  ],
};

/**
 * A schema dir holding every named file plus the lock and the audit.
 * @param {string[]} files
 */
export function schemaDirWith(files) {
  const dir = mkdtempSync(join(tmpdir(), "smp-deliver-schema-"));
  for (const file of [...files, "demo_lockdown.sql", "rls_audit.sql"]) {
    writeFileSync(join(dir, file), `-- ${file}\nselect 1;\n`);
  }
  return dir;
}

/** @param {string} sql */
const isLockCount = (sql) => /pg_policies/.test(sql) && /demo/.test(sql);

/**
 * Records every file and statement and answers each as a healthy project
 * would, unless an override says otherwise.
 * @param {{ type?: "demo" | "school", locks?: Record<string, number>, audit?: "pass" | "fail", checkRows?: Record<string, string[][]>, files?: Record<string, object>, statements?: (sql: string) => object | null }} [options]
 */
export function fakeExecutor({
  type = "school",
  locks = {},
  audit = "pass",
  checkRows = {},
  files = {},
  statements = () => null,
} = {}) {
  /** @type {({ file: string } | { sql: string })[]} */
  const calls = [];
  let locked = type === "demo";
  const result = (over = {}) => ({
    ok: true,
    sqlstate: null,
    error: null,
    notices: [],
    rows: [],
    ...over,
  });
  return {
    calls,
    applied: () =>
      calls
        .filter((call) => "file" in call)
        .map((call) => call.file)
        .filter((file) => !["rls_audit.sql", "fingerprint.sql"].includes(file)),
    statementsRun: () =>
      calls.filter((call) => "sql" in call).map((call) => call.sql),
    async runFile(path) {
      const file = basename(path);
      calls.push({ file });
      if (files[file]) return result(files[file]);
      if (file === "demo_lockdown.sql") locked = true;
      if (file === "rls_audit.sql") {
        return audit === "pass"
          ? result({ rows: [[AUDIT_SUMMARY]] })
          : result({
              ok: false,
              sqlstate: "P0001",
              error: "FAIL [student reads another student]",
            });
      }
      return result();
    },
    async runStatement(sql) {
      calls.push({ sql });
      const over = statements(sql);
      if (over) return result(over);
      if (sql === AUDIT_LEFTOVERS_SQL) return result({ rows: [["0"]] });
      if (isLockCount(sql)) {
        return result({
          rows: TABLES.map((table) => [
            table,
            String(locks[table] ?? (locked ? 3 : 0)),
          ]),
        });
      }
      if (Object.hasOwn(checkRows, sql))
        return result({ rows: checkRows[sql] });
      if (/^select /i.test(sql)) return result({ rows: [["0"]] });
      return result();
    },
  };
}

/** @param {string} text the line the owner types */
export function ttyInput(text) {
  const input = new PassThrough();
  Object.assign(input, { isTTY: true, setRawMode: () => input });
  input.end(text);
  return input;
}

/** @param {string} text */
export function pipedInput(text) {
  const input = new PassThrough();
  input.end(text);
  return input;
}

export function sink() {
  let text = "";
  const stream = new Writable({
    write(chunk, _encoding, done) {
      text += String(chunk);
      done();
    },
  });
  return { stream, text: () => text };
}

/**
 * Everything `deliver` and `main` take except the project, with spies on the
 * boundaries.
 * @param {{ recordsDir: string, schemaDir: string, executor: ReturnType<typeof fakeExecutor>, input: NodeJS.ReadableStream, now?: Date, projects?: object[], units?: object[] }} options
 */
export function deliveryDeps({
  recordsDir,
  schemaDir,
  executor,
  input,
  now = new Date("2026-10-28T20:00:00.000Z"),
  projects = [demo, pilot],
  units = [conducta],
}) {
  const lines = [];
  const output = sink();
  const connect = vi.fn(async () => executor);
  const prepareCommit = vi.fn(async ({ project }) => ({
    branch: `chore/record-${project.name}`,
  }));
  return {
    deps: {
      manifest: { units },
      projects: { projects },
      recordsDir,
      schemaDir,
      input,
      output: output.stream,
      connect,
      approver: APPROVER,
      now: () => now,
      prepareCommit,
      out: (line) => lines.push(line),
    },
    connect,
    prepareCommit,
    printed: () => `${lines.join("\n")}\n${output.text()}`,
  };
}
