import { describe, it, expect, beforeEach, vi } from "vitest";

// demoDb imports the Supabase client at module load; stub it out (the roster /
// student methods under test overlay deltas on realDb only and never touch it).
vi.mock("../src/js/supabaseClient.js", () => ({ supabase: {} }));

const { wrapDbForDemo, computePeriodScore } =
  await import("../src/js/demoDb.js");

let realDb;
let writes;
let db;
let serverAttendance;

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
    // The sheet the overlay wraps: roster rows carrying whatever the server
    // already has for THIS subject on THIS date.
    fetchAttendanceSheet: async (classId, cstId, date) =>
      server[classId].map((s) => ({
        id: s.id,
        first_name: s.first_name,
        last_name: s.last_name,
        status: serverAttendance[`${s.id}|${cstId}|${date}`] ?? null,
        notes: "",
      })),
  };
  serverAttendance = {};
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

  describe("the attendance component (REAC 2026's 5%)", () => {
    // Mirrors the view's att_cat CTE: a category with kind "attendance" owns
    // no assignments and takes its percentage from the attendance record.
    const mepCats = [
      { id: 1, weight: 95, kind: "assignments" },
      { id: 2, weight: 5, kind: "attendance" },
    ];
    const assignments = [{ id: 1, max_score: 100, category_id: 1 }];
    const grades = [{ assignment_id: 1, score: 80 }];
    const rows = (n, status) => Array.from({ length: n }, () => ({ status }));

    it("scores it from attendance instead of from assignments", () => {
      // Coursework 80, attendance 18/20 = 90.
      // → (80*95 + 90*5) / 100 = 80.5
      const attendance = [...rows(18, "present"), ...rows(2, "absent")];
      expect(computePeriodScore(assignments, grades, mepCats, attendance)).toBe(
        80.5,
      );
    });

    it("drops the category when no attendance has been taken yet", () => {
      // Without attendance the 5% renormalises away and coursework stands
      // alone — it must not be scored as a zero.
      expect(computePeriodScore(assignments, grades, mepCats, [])).toBe(80);
    });

    it("applies the three-tardías rule through to the grade", () => {
      // 8 present + 3 late → floor(3/3)=1 absence → 10/11 = 90.909…
      // → (80*95 + 90.909…*5) / 100 = 80.55
      const attendance = [...rows(8, "present"), ...rows(3, "late")];
      expect(computePeriodScore(assignments, grades, mepCats, attendance)).toBe(
        80.55,
      );
    });

    it("ignores attendance when no category claims it", () => {
      // The same attendance against an all-assignments scheme changes nothing.
      const plain = [{ id: 1, weight: 100, kind: "assignments" }];
      const attendance = [...rows(1, "present"), ...rows(9, "absent")];
      expect(computePeriodScore(assignments, grades, plain, attendance)).toBe(
        80,
      );
    });

    it("still returns null when nothing is graded, attendance or not", () => {
      // `base` in the view needs a graded assignment to emit a row at all, so
      // attendance alone cannot conjure a period score.
      expect(
        computePeriodScore(assignments, [], mepCats, rows(10, "present")),
      ).toBeNull();
    });

    // Parity against the real thing. These rows were read out of the demo
    // project (student 83, class_subject_teacher 11, period 2) together with
    // the number public.student_period_grades returned for them. If the view
    // and this mirror ever drift, one of these two numbers moves and this
    // fails — which is the whole point of keeping the fixture verbatim.
    describe("parity with the live student_period_grades view", () => {
      const liveAssignments = [
        { id: 190, max_score: 30, category_id: 41 },
        { id: 191, max_score: 20, category_id: 42 },
        { id: 192, max_score: 100, category_id: 43 },
        { id: 193, max_score: 50, category_id: 44 },
      ];
      const liveGrades = [
        { assignment_id: 193, score: 48 },
        { assignment_id: 192, score: 94 },
        { assignment_id: 191, score: 18.4 },
        { assignment_id: 190, score: 27 },
      ];
      const liveCats = [
        { id: 44, weight: 10, kind: "assignments" },
        { id: 43, weight: 40, kind: "assignments" },
        { id: 42, weight: 15, kind: "assignments" },
        { id: 41, weight: 35, kind: "assignments" },
      ];
      // 22 days: 17 present, 1 absent, 4 late.
      const liveAttendance = [
        ...rows(17, "present"),
        ...rows(1, "absent"),
        ...rows(4, "late"),
      ];

      it("reproduces the view's score for an all-assignments scheme", () => {
        // The view returned 92.50 for this student. Attendance is present in
        // the data but no category claims it, so it must not move the score.
        expect(
          computePeriodScore(
            liveAssignments,
            liveGrades,
            liveCats,
            liveAttendance,
          ),
        ).toBe(92.5);
      });

      it("reproduces the view's score once a 5% attendance component exists", () => {
        // Same rows with an Asistencia category added. floor(4/3)=1 absence,
        // so 22-1-1 = 20 of 22 = 90.909…, and the view's att_cat CTE computes
        // 92.42 overall. Verified against the live database.
        expect(
          computePeriodScore(
            liveAssignments,
            liveGrades,
            [...liveCats, { id: 99, weight: 5, kind: "attendance" }],
            liveAttendance,
          ),
        ).toBe(92.42);
      });
    });
  });
});

// The defect this suite exists to pin: before attendance carried a subject,
// the overlay keyed its deltas on (student, class, date). Two teachers sharing
// a section therefore wrote to the same key, and whoever saved second silently
// replaced the first one's register. The demo reproduced that faithfully
// because demoDb mirrored the schema's old constraint.
describe("demoDb attendance overlay — one register per subject", () => {
  const DATE = "2026-09-07";

  it("keeps two subjects' registers for the same student and day apart", async () => {
    await db.upsertAttendance(21, 11, DATE, [{ id: 101, status: "absent" }], 7);
    await db.upsertAttendance(
      21,
      12,
      DATE,
      [{ id: 101, status: "present" }],
      8,
    );

    const maths = await db.fetchAttendanceSheet(21, 11, DATE);
    const spanish = await db.fetchAttendanceSheet(21, 12, DATE);

    expect(maths.find((r) => r.id === 101).status).toBe("absent");
    expect(spanish.find((r) => r.id === 101).status).toBe("present");
    expect(writes).toBe(2);
  });

  it("does not leak one subject's edit into another subject's sheet", async () => {
    await db.upsertAttendance(21, 11, DATE, [{ id: 101, status: "absent" }], 7);
    const spanish = await db.fetchAttendanceSheet(21, 12, DATE);
    expect(spanish.find((r) => r.id === 101).status).toBeNull();
  });

  it("still overwrites within the same subject", async () => {
    await db.upsertAttendance(21, 11, DATE, [{ id: 101, status: "absent" }], 7);
    await db.upsertAttendance(21, 11, DATE, [{ id: 101, status: "late" }], 7);
    const maths = await db.fetchAttendanceSheet(21, 11, DATE);
    expect(maths.find((r) => r.id === 101).status).toBe("late");
  });

  it("overlays a delta on top of a status the server already had", async () => {
    serverAttendance[`101|11|${DATE}`] = "present";
    expect(
      (await db.fetchAttendanceSheet(21, 11, DATE)).find((r) => r.id === 101)
        .status,
    ).toBe("present");
    await db.upsertAttendance(
      21,
      11,
      DATE,
      [{ id: 101, status: "excused" }],
      7,
    );
    expect(
      (await db.fetchAttendanceSheet(21, 11, DATE)).find((r) => r.id === 101)
        .status,
    ).toBe("excused");
  });

  it("refuses a null subject, exactly like the real writer", async () => {
    await expect(
      db.upsertAttendance(21, null, DATE, [{ id: 101, status: "absent" }], 7),
    ).rejects.toThrow(/class_subject_teacher_id/);
    expect(writes).toBe(0);
  });
});
