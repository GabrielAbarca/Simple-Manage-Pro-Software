import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Writable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promptSecret } from "../scripts/delivery/credential.mjs";
import { createManagementApiExecutor } from "../scripts/delivery/executors/managementApi.mjs";

const REF = "abcdefghijklmnopqrst";
const TOKEN = "fake-access-token-for-unit-tests";
const QUERY_URL = `https://api.supabase.com/v1/projects/${REF}/database/query`;

const reply = (status, body) =>
  vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
  );

const requestOf = (fetch, n) => {
  const [url, init] = fetch.mock.calls[n];
  return {
    url: String(url),
    method: init.method,
    body: init.body,
    authorization: new Headers(init.headers).get("authorization"),
  };
};

describe("Management API executor", () => {
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "smp-executor-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("runs each SQL file as one unit with the credential confined to that call", async () => {
    const sql =
      "begin;\nset local role anon;\nselect 1;\nrollback;\n\nselect 'RLS AUDIT: ALL CHECKS PASSED' as rls_audit;\n";
    const file = join(dir, "audit.sql");
    writeFileSync(file, sql);
    const fetch = reply(201, [{ rls_audit: "RLS AUDIT: ALL CHECKS PASSED" }]);
    const executor = createManagementApiExecutor({
      projectRef: REF,
      token: TOKEN,
      holdsRealData: false,
      fetch,
    });

    const result = await executor.runFile(file);

    expect(fetch).toHaveBeenCalledTimes(1);
    const first = requestOf(fetch, 0);
    expect(first.url).toBe(QUERY_URL);
    expect(first.method).toBe("POST");
    expect(JSON.parse(first.body)).toEqual({ query: sql });
    expect(first.authorization).toBe(`Bearer ${TOKEN}`);
    expect(first.url).not.toContain(TOKEN);
    expect(first.body).not.toContain(TOKEN);
    expect(result).toEqual({
      ok: true,
      sqlstate: null,
      error: null,
      notices: [],
      rows: [["RLS AUDIT: ALL CHECKS PASSED"]],
    });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
    expect(Object.values(process.env)).not.toContain(TOKEN);

    await executor.runStatement("select count(*) from public.subjects");

    expect(fetch).toHaveBeenCalledTimes(2);
    const second = requestOf(fetch, 1);
    expect(second.url).toBe(QUERY_URL);
    expect(JSON.parse(second.body)).toEqual({
      query: "select count(*) from public.subjects",
    });
    expect(second.authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("returns only the SQLSTATE for a failure on a real-data project", async () => {
    const message =
      'Failed to run sql query: ERROR:  23505: duplicate key value violates unique constraint "students_enrollment_number_key"\nDETAIL:  Key (enrollment_number)=(CR-2027-0042) already exists.\n';
    const insert =
      "insert into public.students (enrollment_number) values ('CR-2027-0042')";

    const real = await createManagementApiExecutor({
      projectRef: REF,
      token: TOKEN,
      holdsRealData: true,
      fetch: reply(400, { message }),
    }).runStatement(insert);

    expect(real.ok).toBe(false);
    expect(real.sqlstate).toBe("23505");
    expect(JSON.stringify(real)).not.toContain("CR-2027-0042");
    expect(JSON.stringify(real)).not.toContain("duplicate key");
    expect(JSON.stringify(real)).not.toContain("enrollment_number");

    const testProject = await createManagementApiExecutor({
      projectRef: REF,
      token: TOKEN,
      holdsRealData: false,
      fetch: reply(400, { message }),
    }).runStatement(insert);

    expect(testProject).toMatchObject({ ok: false, sqlstate: "23505" });
    expect(testProject.error).toContain(
      "duplicate key value violates unique constraint",
    );
  });

  it("never reads the credential from the environment or prints it", async () => {
    const decoy = "fake-decoy-token-from-the-environment";
    const originalEnv = process.env;
    const envReads = [];
    const record = (key) => {
      if (typeof key === "string" && /SUPABASE|TOKEN|SECRET|PAT$/i.test(key))
        envReads.push(key);
    };
    const printed = [];
    const output = new Writable({
      write(chunk, _encoding, done) {
        printed.push(String(chunk));
        done();
      },
    });
    const input = Object.assign(new PassThrough(), {
      isTTY: true,
      setRawMode: vi.fn(),
    });
    const spies = [
      vi.spyOn(process.stdout, "write"),
      vi.spyOn(process.stderr, "write"),
      vi.spyOn(console, "log"),
      vi.spyOn(console, "info"),
      vi.spyOn(console, "warn"),
      vi.spyOn(console, "error"),
    ];
    process.env = new Proxy(
      {
        ...originalEnv,
        SUPABASE_ACCESS_TOKEN: decoy,
        SMP_SUPABASE_TOKEN: decoy,
      },
      {
        get(target, key) {
          record(key);
          return Reflect.get(target, key);
        },
        has(target, key) {
          record(key);
          return Reflect.has(target, key);
        },
      },
    );

    try {
      const pending = promptSecret("Supabase personal access token: ", {
        input,
        output,
      });
      input.write(`${TOKEN}\r`);
      const token = await pending;

      expect(token).toBe(TOKEN);

      const fetch = vi
        .fn()
        .mockImplementationOnce(
          async () =>
            new Response(JSON.stringify([{ ok: 1 }]), { status: 201 }),
        )
        .mockImplementationOnce(
          async () =>
            new Response(
              JSON.stringify({
                message:
                  'Failed to run sql query: ERROR:  42P01: relation "public.nothing" does not exist\n',
              }),
              { status: 400 },
            ),
        );
      const executor = createManagementApiExecutor({
        projectRef: REF,
        token,
        holdsRealData: false,
        fetch,
      });
      await executor.runStatement("select 1 as ok");
      await executor.runStatement("select * from public.nothing");

      expect(requestOf(fetch, 0).authorization).toBe(`Bearer ${TOKEN}`);
      expect(requestOf(fetch, 1).authorization).toBe(`Bearer ${TOKEN}`);
      expect(printed.join("")).toContain("Supabase personal access token: ");
      const everything = [
        ...printed,
        ...spies.flatMap((spy) => spy.mock.calls.flat().map(String)),
      ].join("\n");
      expect(everything).not.toContain(TOKEN);
      expect(everything).not.toContain(decoy);
      expect(envReads).toEqual([]);
    } finally {
      process.env = originalEnv;
      for (const spy of spies) spy.mockRestore();
    }
  });
});

describe("hidden prompt and executor edges", () => {
  const terminal = () =>
    Object.assign(new PassThrough(), { isTTY: true, setRawMode: vi.fn() });
  const sink = () => {
    const printed = [];
    const output = new Writable({
      write(chunk, _encoding, done) {
        printed.push(String(chunk));
        done();
      },
    });
    return { output, printed };
  };

  it("refuses an input that isn't a terminal", async () => {
    const input = new PassThrough();
    await expect(
      promptSecret("Token: ", { input, output: sink().output }),
    ).rejects.toThrow("a hidden prompt needs a terminal");
  });

  it("applies Backspace, echoes nothing and restores the terminal", async () => {
    const input = terminal();
    const { output, printed } = sink();
    const pending = promptSecret("Token: ", { input, output });
    input.write("abcx\u007fd\r");
    expect(await pending).toBe("abcd");
    expect(printed.join("")).toBe("Token: \n");
    expect(input.setRawMode.mock.calls).toEqual([[true], [false]]);
  });

  it("rejects on Ctrl-C and on an empty answer", async () => {
    const cancelled = terminal();
    const pending = promptSecret("Token: ", {
      input: cancelled,
      output: sink().output,
    });
    cancelled.write("abc\u0003");
    await expect(pending).rejects.toThrow("cancelled");

    const empty = terminal();
    const blank = promptSecret("Token: ", {
      input: empty,
      output: sink().output,
    });
    empty.write("   \r");
    await expect(blank).rejects.toThrow("no token entered");
  });

  it("refuses a bad ref, an empty token or a missing holdsRealData", () => {
    const fetch = vi.fn();
    const make = (options) => () =>
      createManagementApiExecutor({
        projectRef: REF,
        token: TOKEN,
        holdsRealData: false,
        fetch,
        ...options,
      });
    expect(make({ projectRef: "../../v1/organizations" })).toThrow(TypeError);
    expect(make({ token: "" })).toThrow(TypeError);
    expect(make({ holdsRealData: undefined })).toThrow(TypeError);
    for (const options of [{ projectRef: "bad" }, { holdsRealData: "no" }]) {
      try {
        make(options)();
      } catch (error) {
        expect(String(error)).not.toContain(TOKEN);
      }
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reports an HTTP failure without a SQLSTATE on a test project", async () => {
    const result = await createManagementApiExecutor({
      projectRef: REF,
      token: TOKEN,
      holdsRealData: false,
      fetch: reply(401, { message: "Unauthorized" }),
    }).runStatement("select 1");
    expect(result).toEqual({
      ok: false,
      sqlstate: null,
      error: "HTTP 401: Unauthorized",
      notices: [],
      rows: [],
    });
  });

  it("keeps the failed audit check's label at the start of the error", async () => {
    const result = await createManagementApiExecutor({
      projectRef: REF,
      token: TOKEN,
      holdsRealData: false,
      fetch: reply(400, {
        message:
          "Failed to run sql query: ERROR:  P0001: FAIL [teacher reads X]: expected 1 row(s), got 0\nCONTEXT:  PL/pgSQL function inline_code_block line 1 at RAISE\n",
      }),
    }).runStatement("select 1");
    expect(result.sqlstate).toBe("P0001");
    expect(result.error).toBe(
      "FAIL [teacher reads X]: expected 1 row(s), got 0",
    );
  });

  it("withholds a network error on a real-data project", async () => {
    const result = await createManagementApiExecutor({
      projectRef: REF,
      token: TOKEN,
      holdsRealData: true,
      fetch: vi.fn(async () => {
        throw new Error("getaddrinfo ENOTFOUND api.supabase.com");
      }),
    }).runStatement("select 1");
    expect(result).toMatchObject({ ok: false, sqlstate: null });
    expect(result.error).not.toContain("ENOTFOUND");
  });

  it("prints cells the way psql -A -t does", async () => {
    const result = await createManagementApiExecutor({
      projectRef: REF,
      token: TOKEN,
      holdsRealData: false,
      fetch: reply(201, [
        { a: true, b: false, c: null, d: 3, e: { k: 1 }, f: "x" },
      ]),
    }).runStatement("select 1");
    expect(result.rows).toEqual([["t", "f", "", "3", '{"k":1}', "x"]]);
  });
});
