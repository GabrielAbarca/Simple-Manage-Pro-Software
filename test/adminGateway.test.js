import { describe, it, expect, vi, beforeEach } from "vitest";

const server = {
  rows: [],
  maxRows: 1000,
  requests: [],
  withCount: true,
  failFrom: null,
};

// A PostgREST stand-in: filters, orders by id, honours .range() but never
// returns more than `maxRows`, and reports the exact count when asked.
function query(table, columns, opts = {}) {
  const filters = [];
  const order = [];
  let range = null;
  const builder = {
    eq: (col, val) => (filters.push((r) => r[col] === val), builder),
    in: (col, vals) => (filters.push((r) => vals.includes(r[col])), builder),
    gte: (col, val) => (filters.push((r) => r[col] >= val), builder),
    lte: (col, val) => (filters.push((r) => r[col] <= val), builder),
    order: (col, { ascending }) => (order.push([col, ascending]), builder),
    range: (from, to) => ((range = [from, to]), builder),
    then(resolve) {
      server.requests.push({ table, columns, opts, order, range });
      if (range && server.failFrom != null && range[0] >= server.failFrom) {
        return resolve({ data: null, count: null, error: { message: "boom" } });
      }
      const matched = server.rows.filter((r) => filters.every((f) => f(r)));
      const count =
        opts.count === "exact" && server.withCount ? matched.length : null;
      if (opts.head) return resolve({ data: null, count, error: null });
      const [from, to] = range ?? [0, matched.length - 1];
      const end = Math.min(to + 1, from + server.maxRows);
      return resolve({ data: matched.slice(from, end), count, error: null });
    },
  };
  return builder;
}

vi.mock("../src/js/supabaseClient.js", () => ({
  supabase: {
    from: (table) => ({
      select: (columns, opts) => query(table, columns, opts),
    }),
  },
}));

const { supabaseGateway } = await import("../src/js/adminData.js");

const seed = (n) =>
  Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    status: i % 4 ? "present" : "absent",
    date: `2026-03-${String((i % 28) + 1).padStart(2, "0")}`,
  }));

beforeEach(() => {
  server.rows = [];
  server.maxRows = 1000;
  server.requests = [];
  server.withCount = true;
  server.failFrom = null;
});

describe("supabaseGateway.select", () => {
  it("pages past the API row cap and keeps every row in order", async () => {
    server.rows = seed(2500);
    const rows = await supabaseGateway.select("attendance");
    expect(rows).toHaveLength(2500);
    expect(rows.map((r) => r.id)).toEqual(server.rows.map((r) => r.id));
    expect(server.requests.map((r) => r.range)).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it("still reads everything when the project caps rows below a page", async () => {
    server.rows = seed(1300);
    server.maxRows = 500;
    const rows = await supabaseGateway.select("attendance");
    expect(rows.map((r) => r.id)).toEqual(server.rows.map((r) => r.id));
  });

  it("breaks ties by id so page boundaries stay stable", async () => {
    server.rows = seed(3);
    await supabaseGateway.select("students", {
      order: { column: "last_name" },
    });
    await supabaseGateway.select("students", {
      order: { column: "id", ascending: false },
    });
    expect(server.requests.map((r) => r.order)).toEqual([
      [
        ["last_name", true],
        ["id", true],
      ],
      [["id", false]],
    ]);
  });

  it("keeps reading page by page when no count comes back", async () => {
    server.rows = seed(2300);
    server.withCount = false;
    const rows = await supabaseGateway.select("attendance");
    expect(rows.map((r) => r.id)).toEqual(server.rows.map((r) => r.id));
  });

  it("rejects when a later page fails instead of returning part of the table", async () => {
    server.rows = seed(2500);
    server.failFrom = 2000;
    await expect(supabaseGateway.select("attendance")).rejects.toMatchObject({
      message: "boom",
    });
  });

  it("makes a single request for a small table", async () => {
    server.rows = seed(3);
    expect(await supabaseGateway.select("attendance")).toHaveLength(3);
    expect(server.requests).toHaveLength(1);
  });

  it("applies filters and the narrowed column list to every page", async () => {
    server.rows = seed(2100);
    const rows = await supabaseGateway.select("attendance", {
      columns: "id, status",
      inList: { column: "status", values: ["absent"] },
      between: { column: "date", from: "2026-03-01", to: "2026-03-14" },
    });
    const expected = server.rows.filter(
      (r) => r.status === "absent" && r.date <= "2026-03-14",
    );
    expect(rows.map((r) => r.id)).toEqual(expected.map((r) => r.id));
    expect(server.requests.every((r) => r.columns === "id, status")).toBe(true);
  });
});

describe("supabaseGateway.count", () => {
  it("asks for an exact head count with the same filters", async () => {
    server.rows = seed(2500);
    const n = await supabaseGateway.count("attendance", {
      match: { status: "absent" },
    });
    expect(n).toBe(625);
    expect(server.requests).toEqual([
      {
        table: "attendance",
        columns: "*",
        opts: { count: "exact", head: true },
        order: [],
        range: null,
      },
    ]);
  });
});
