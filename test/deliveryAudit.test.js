import { describe, expect, it, vi } from "vitest";
import { runAudit } from "../scripts/delivery/audit.mjs";
import {
  AUDIT_LEFTOVERS_SQL,
  AUDIT_SUMMARY,
} from "../scripts/delivery/proofs.mjs";

const REF = "abcdefghijklmnopqrst";
const TOKEN = "fake-access-token-for-unit-tests";

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/**
 * @param {{ audit: Response, leftovers: Response }} replies
 */
const api = (replies) =>
  vi.fn(async (_url, init) =>
    JSON.parse(init.body).query === AUDIT_LEFTOVERS_SQL
      ? replies.leftovers
      : replies.audit,
  );

const run = async (fetch, options = {}) => {
  const lines = [];
  const prompt = vi.fn(async () => TOKEN);
  const ok = await runAudit({
    projectRef: REF,
    holdsRealData: false,
    prompt,
    fetch,
    out: (line) => lines.push(line),
    ...options,
  });
  return { ok, lines, prompt };
};

const auditFailure = () =>
  json(400, {
    message:
      "Failed to run sql query: ERROR:  P0001: FAIL [teacher reads X]: expected 1 row(s), got 0\n",
  });

describe("runAudit", () => {
  it("passes when the audit ends in its summary row and nothing is left", async () => {
    const fetch = api({
      audit: json(201, [{ rls_audit: AUDIT_SUMMARY }]),
      leftovers: json(201, [{ leftovers: 0 }]),
    });
    const { ok, lines, prompt } = await run(fetch);

    expect(ok).toBe(true);
    expect(lines).toEqual([
      `RLS audit on ${REF}: PASS`,
      "Audit fixture rows left behind: 0",
    ]);
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(lines.join("\n")).not.toContain(TOKEN);
  });

  it("names the failed check on a test project", async () => {
    const { ok, lines } = await run(
      api({ audit: auditFailure(), leftovers: json(201, [{ leftovers: 0 }]) }),
    );
    expect(ok).toBe(false);
    expect(lines[0]).toBe(
      `RLS audit on ${REF}: FAIL (SQLSTATE P0001): FAIL [teacher reads X]: expected 1 row(s), got 0`,
    );
  });

  it("shows only the SQLSTATE on a real-data project", async () => {
    const { ok, lines } = await run(
      api({ audit: auditFailure(), leftovers: json(201, [{ leftovers: 0 }]) }),
      { holdsRealData: true },
    );
    expect(ok).toBe(false);
    expect(lines[0]).toContain("(SQLSTATE P0001)");
    expect(lines[0]).not.toContain("teacher reads X");
  });

  it("fails when fixture rows are left behind", async () => {
    const { ok, lines } = await run(
      api({
        audit: json(201, [{ rls_audit: AUDIT_SUMMARY }]),
        leftovers: json(201, [{ leftovers: 2 }]),
      }),
    );
    expect(ok).toBe(false);
    expect(lines[1]).toBe("Audit fixture rows left behind: 2");
  });

  it("refuses a bad project ref before asking for the token", async () => {
    const fetch = vi.fn();
    const { ok, lines, prompt } = await run(fetch, { projectRef: "nope" });
    expect(ok).toBe(false);
    expect(lines[0]).toMatch(/^usage: /);
    expect(prompt).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
