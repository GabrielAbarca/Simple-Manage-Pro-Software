import { describe, expect, it } from "vitest";
import {
  AUDIT_SUMMARY,
  proveAudit,
  proveDemoLock,
} from "../scripts/delivery/proofs.mjs";
import {
  connectionEnv,
  parseMessages,
} from "../scripts/delivery/executors/psql.mjs";

/** @param {Partial<import("../scripts/delivery/executors/psql.mjs").ExecResult>} result */
const executor = (result) => {
  const full = {
    ok: true,
    sqlstate: null,
    error: null,
    notices: [],
    rows: [],
    ...result,
  };
  return { runFile: async () => full, runStatement: async () => full };
};

describe("proveAudit", () => {
  it("passes only when the run reaches the summary line", async () => {
    expect(
      await proveAudit(executor({ notices: [` ${AUDIT_SUMMARY}`] }), "a.sql"),
    ).toEqual({ ok: true, check: null, sqlstate: null, error: null });

    expect(await proveAudit(executor({ notices: [] }), "a.sql")).toEqual({
      ok: false,
      check: null,
      sqlstate: null,
      error: "the audit ended without its summary line",
    });
  });

  it("names the failed check from the FAIL label", async () => {
    const proof = await proveAudit(
      executor({
        ok: false,
        sqlstate: "P0001",
        error: "FAIL [teacher reads X]: expected 1 row(s), got 0 — query: …",
      }),
      "a.sql",
    );
    expect(proof).toMatchObject({
      ok: false,
      check: "teacher reads X",
      sqlstate: "P0001",
    });
  });
});

describe("proveDemoLock", () => {
  const counts = (rows) => executor({ rows });

  it("expects zero locks on a school shape and three on a demo shape", async () => {
    const rows = [
      ["rooms", "3"],
      ["students", "0"],
    ];
    expect(await proveDemoLock(counts(rows), "school")).toEqual({
      ok: false,
      counts: { rooms: 3, students: 0 },
      tables: ["rooms"],
      error: null,
    });
    expect(await proveDemoLock(counts(rows), "demo")).toMatchObject({
      ok: false,
      tables: ["students"],
    });
  });

  it("fails with no public tables or a failed query", async () => {
    expect(await proveDemoLock(counts([]), "school")).toMatchObject({
      ok: false,
      tables: [],
    });
    expect(
      await proveDemoLock(executor({ ok: false, error: "boom" }), "demo"),
    ).toMatchObject({ ok: false, error: "boom" });
  });
});

describe("psql executor parsing", () => {
  it("reads verbose notices and the first error with its SQLSTATE", () => {
    const stderr = [
      "psql:rls_audit.sql:328: NOTICE:  00000: PASS [anon cannot read students]  (0 row(s))",
      "LOCATION:  exec_stmt_raise, pl_exec.c:3911",
      "psql:rls_audit.sql:432: ERROR:  P0001: FAIL [student sees X]: expected 1 row(s), got 0 — query: select 1",
      "             from public.students",
      "CONTEXT:  PL/pgSQL function pg_temp_3._expect_rows(text,text,bigint) line 6 at RAISE",
    ].join("\n");

    expect(parseMessages(stderr)).toEqual({
      notices: ["PASS [anon cannot read students]  (0 row(s))"],
      error: {
        sqlstate: "P0001",
        message:
          "FAIL [student sees X]: expected 1 row(s), got 0 — query: select 1\n             from public.students",
      },
    });
  });

  it("leaves a connection failure to the caller", () => {
    expect(
      parseMessages(
        'psql: error: connection to server at "127.0.0.1", port 1 failed: Connection refused',
      ),
    ).toEqual({ notices: [], error: null });
  });

  it("keeps the password out of the command line", () => {
    expect(
      connectionEnv(
        "postgresql://postgres:p%40ss@db.example.test:6543/postgres?sslmode=require",
      ),
    ).toEqual({
      PGHOST: "db.example.test",
      PGPORT: "6543",
      PGUSER: "postgres",
      PGPASSWORD: "p@ss",
      PGDATABASE: "postgres",
      PGSSLMODE: "require",
    });
  });
});
