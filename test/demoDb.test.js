import { describe, it, expect, beforeEach, vi } from "vitest";

// demoDb imports the Supabase client at module load; stub it out (the roster /
// student methods under test overlay deltas on realDb only and never touch it).
vi.mock("../src/js/supabaseClient.js", () => ({ supabase: {} }));

const { wrapDbForDemo, computePeriodScore } =
  await import("../src/js/demoDb.js");

let realDb;
let writes;
let db;

beforeEach(() => {
  const server = {
    21: [
      { id: 101, first_name: "Ana", last_name: "García", status: "active" },
      { id: 102, first_name: "Luis", last_name: "Martínez", status: "active" },
    ],
  };
  realDb = {
    fetchRoster: async (classId) => server[classId].map((s) => ({ ...s })),
    fetchActiveCountByClass: async () => ({ 21: 2 }),
    // MEP component templates: read-only reference data the teacher instantiates.
    fetchComponentTemplates: async () => [
      { id: 5, name: "MEP", subject_id: null, is_default: true },
    ],
    fetchTemplateItems: async () => [
      { name: "Cotidiano", weight: 35, item_order: 1 },
      { name: "Pruebas", weight: 40, item_order: 2 },
    ],
    fetchCategories: async () => [],
  };
  writes = 0;
  db = wrapDbForDemo(realDb, { onWrite: () => writes++ });
});

describe("demoDb write sandbox — student deltas overlay reads", () => {
  it("insert appears in the roster and fires onWrite", async () => {
    await db.insertStudent({
      first_name: "New",
      last_name: "Student",
      class_id: 21,
      status: "active",
    });
    const roster = await db.fetchRoster(21);
    expect(roster).toHaveLength(3);
    expect(roster.some((s) => s.last_name === "Student")).toBe(true);
    // Local rows get negative ids so they never collide with server rows.
    expect(roster.find((s) => s.last_name === "Student").id).toBeLessThan(0);
    expect(writes).toBe(1);
  });

  it("delete removes a server row from the roster", async () => {
    await db.deleteStudent(101);
    const roster = await db.fetchRoster(21);
    expect(roster.find((s) => s.id === 101)).toBeUndefined();
    expect(roster).toHaveLength(1);
    expect(writes).toBe(1);
  });

  it("update patches a server row in place", async () => {
    await db.updateStudent(102, { last_name: "Changed" });
    const roster = await db.fetchRoster(21);
    expect(roster.find((s) => s.id === 102).last_name).toBe("Changed");
  });

  it("a class move edits the student out of the old roster", async () => {
    await db.updateStudent(102, { class_id: 99 });
    const roster = await db.fetchRoster(21);
    expect(roster.find((s) => s.id === 102)).toBeUndefined();
  });

  it("active counts reflect a local insert then delete", async () => {
    // The console always loads the roster before editing; that read warms the
    // pristine status/class the delete-decrement below keys off.
    await db.fetchRoster(21);
    await db.insertStudent({ class_id: 21, status: "active" });
    expect((await db.fetchActiveCountByClass())[21]).toBe(3);
    await db.deleteStudent(101);
    expect((await db.fetchActiveCountByClass())[21]).toBe(2);
  });
});

describe("demoDb — MEP component templates instantiate locally", () => {
  it("passes template reads through to realDb without writing", async () => {
    expect(await db.fetchComponentTemplates()).toEqual([
      { id: 5, name: "MEP", subject_id: null, is_default: true },
    ]);
    expect((await db.fetchTemplateItems(5)).map((i) => i.name)).toEqual([
      "Cotidiano",
      "Pruebas",
    ]);
    expect(writes).toBe(0); // reads never write
  });

  it("applying a scheme records category deltas, never a server write", async () => {
    await db.fetchCategories(7); // warm the (empty) gradebook first
    for (const it of await db.fetchTemplateItems(5)) {
      await db.insertCategory({
        name: it.name,
        weight: it.weight,
        class_subject_teacher_id: 7,
      });
    }
    const cats = await db.fetchCategories(7);
    expect(cats.map((c) => c.name)).toEqual(["Cotidiano", "Pruebas"]);
    // Local rows carry negative ids and every write stayed in the overlay.
    expect(cats.every((c) => c.id < 0)).toBe(true);
    expect(writes).toBe(2);
  });
});

// The demo overlay scores students edited during a session; everyone else
// comes from the SQL view. They share a gradebook column, so they must agree.
//
// The numeric expectations were checked by running the same rows through the
// real view definition on PostgreSQL 16 — weighted 72.27, renormalised 60.00,
// no-categories 66.67, uncategorised-excluded 90.00, rounding 33.33, and no
// row at all for a student with nothing graded (which the gradebook renders
// the same way this function's null does).
//
// The last two cases have no SQL counterpart: a foreign key stops a dangling
// category_id, and the view joins grades to assignments by id. They guard
// states only the demo overlay can reach mid-session, after a local delete.
describe("computePeriodScore matches the student_period_grades view", () => {
  const cats = [
    { id: 1, weight: 70 }, // Exams
    { id: 2, weight: 30 }, // Homework
  ];

  it("weights categories by points earned over points possible", () => {
    const assignments = [
      { id: 1, max_score: 100, category_id: 1 }, // big exam
      { id: 2, max_score: 10, category_id: 1 }, // small exam
      { id: 3, max_score: 100, category_id: 2 }, // homework
    ];
    const grades = [
      { assignment_id: 1, score: 90 },
      { assignment_id: 2, score: 0 },
      { assignment_id: 3, score: 50 },
    ];
    // Exams: (90+0)/(100+10) = 81.8182 ; Homework: 50/100 = 50
    // → (81.8182*70 + 50*30) / 100 = 72.27
    expect(computePeriodScore(assignments, grades, cats)).toBe(72.27);
  });

  it("does not average per-assignment percentages", () => {
    // The old implementation averaged 90% and 0% to 45, giving 46.50 overall —
    // 26 points adrift on identical marks. This pins the difference.
    const assignments = [
      { id: 1, max_score: 100, category_id: 1 },
      { id: 2, max_score: 10, category_id: 1 },
      { id: 3, max_score: 100, category_id: 2 },
    ];
    const grades = [
      { assignment_id: 1, score: 90 },
      { assignment_id: 2, score: 0 },
      { assignment_id: 3, score: 50 },
    ];
    expect(computePeriodScore(assignments, grades, cats)).not.toBe(46.5);
  });

  it("renormalises over only the categories that have graded work", () => {
    const assignments = [
      { id: 1, max_score: 100, category_id: 1 },
      { id: 3, max_score: 100, category_id: 2 },
    ];
    // Only the exam is marked, so it carries the whole grade.
    const grades = [{ assignment_id: 1, score: 60 }];
    expect(computePeriodScore(assignments, grades, cats)).toBe(60);
  });

  it("falls back to the overall points ratio when no categories exist", () => {
    const assignments = [
      { id: 1, max_score: 100, category_id: null },
      { id: 2, max_score: 50, category_id: null },
    ];
    const grades = [
      { assignment_id: 1, score: 80 },
      { assignment_id: 2, score: 20 },
    ];
    // (80+20) / (100+50) = 66.67 — not avg(80%, 40%) = 60.
    expect(computePeriodScore(assignments, grades, [])).toBe(66.67);
  });

  it("leaves uncategorised work out of the weighted branch", () => {
    const assignments = [
      { id: 1, max_score: 100, category_id: 1 }, // Exams, weight 70
      { id: 2, max_score: 100, category_id: null }, // uncategorised
    ];
    const grades = [
      { assignment_id: 1, score: 90 },
      { assignment_id: 2, score: 10 },
    ];
    // The view's inner join drops the uncategorised row, so the exam alone
    // decides the grade — the loose 10/100 does not drag it down.
    expect(computePeriodScore(assignments, grades, cats)).toBe(90);
  });

  it("ignores a category the caller no longer knows about", () => {
    const assignments = [{ id: 1, max_score: 100, category_id: 99 }];
    const grades = [{ assignment_id: 1, score: 40 }];
    // Category 99 is gone, so this behaves as uncategorised work: fallback.
    expect(computePeriodScore(assignments, grades, cats)).toBe(40);
  });

  it("returns null when nothing is graded", () => {
    const assignments = [{ id: 1, max_score: 100, category_id: 1 }];
    expect(computePeriodScore(assignments, [], cats)).toBeNull();
    expect(
      computePeriodScore(
        assignments,
        [{ assignment_id: 1, score: null }],
        cats,
      ),
    ).toBeNull();
  });

  it("rounds to two decimals like the view", () => {
    const assignments = [{ id: 1, max_score: 3, category_id: null }];
    const grades = [{ assignment_id: 1, score: 1 }];
    expect(computePeriodScore(assignments, grades, [])).toBe(33.33);
  });

  it("skips grades whose assignment is not in the period", () => {
    const assignments = [{ id: 1, max_score: 100, category_id: null }];
    const grades = [
      { assignment_id: 1, score: 75 },
      { assignment_id: 999, score: 0 }, // deleted/other period
    ];
    expect(computePeriodScore(assignments, grades, [])).toBe(75);
  });
});
