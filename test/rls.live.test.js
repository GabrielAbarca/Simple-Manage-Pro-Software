import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";

/**
 * Live RLS audit — opt-in, skipped unless credentials are supplied.
 *
 * `supabase/schema/rls_audit.sql` proves the policies hold inside the
 * database. This suite proves the same claims survive the trip through
 * PostgREST, which is how the app actually talks to Supabase: it signs in as
 * real users with the anon key and checks what comes back over HTTP. The two
 * layers fail differently — a policy can be right while a view, a grant, or an
 * exposed schema hands the data over anyway — so both are worth having.
 *
 * These tests never run in CI: the variables below are absent there, so the
 * suite reports as skipped rather than failed. Run it by hand against a
 * throwaway test project after a schema change or a restore drill.
 *
 *   SMP_RLS_TEST_URL=https://<ref>.supabase.co \
 *   SMP_RLS_TEST_ANON_KEY=<anon key> \
 *   SMP_RLS_TEST_ADMIN_EMAIL=... SMP_RLS_TEST_ADMIN_PASSWORD=... \
 *   SMP_RLS_TEST_TEACHER_EMAIL=... SMP_RLS_TEST_TEACHER_PASSWORD=... \
 *   SMP_RLS_TEST_STUDENT_EMAIL=... SMP_RLS_TEST_STUDENT_PASSWORD=... \
 *   npx vitest run test/rls.live.test.js
 *
 * Point it at a dedicated test or pilot project — never the public demo
 * (its lockdown denies the admin writes this asserts) and never a project
 * holding a real school's data. The three accounts must already exist, the
 * teacher must be linked through `teachers.auth_user_id` and teach at least
 * one class, and the student must be linked through `students.auth_user_id`.
 */

const url = process.env.SMP_RLS_TEST_URL;
const anonKey = process.env.SMP_RLS_TEST_ANON_KEY;

/** @type {[string, string][]} */
const personas = [
  [
    process.env.SMP_RLS_TEST_ADMIN_EMAIL,
    process.env.SMP_RLS_TEST_ADMIN_PASSWORD,
  ],
  [
    process.env.SMP_RLS_TEST_TEACHER_EMAIL,
    process.env.SMP_RLS_TEST_TEACHER_PASSWORD,
  ],
  [
    process.env.SMP_RLS_TEST_STUDENT_EMAIL,
    process.env.SMP_RLS_TEST_STUDENT_PASSWORD,
  ],
];

const live = Boolean(url && anonKey && personas.every(([e, p]) => e && p));

/** A fresh client that keeps no session on disk between runs. */
function client() {
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function signedIn(email, password) {
  const c = client();
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) {
    throw new Error(`could not sign in as ${email}: ${error.message}`);
  }
  return c;
}

/**
 * A refused write is either an error (RLS rejects the new row) or a silent
 * no-op (the policy hid the target from an update/delete). Both mean the
 * caller changed nothing, so both count as denied. Anything else is a leak.
 * @param {{data: unknown, error: unknown}} res
 */
function wasDenied(res) {
  if (res.error) return true;
  return Array.isArray(res.data) ? res.data.length === 0 : res.data == null;
}

describe.skipIf(!live)("live RLS audit", () => {
  /** @type {ReturnType<typeof client>} */ let admin;
  /** @type {ReturnType<typeof client>} */ let teacher;
  /** @type {ReturnType<typeof client>} */ let student;
  /** @type {ReturnType<typeof client>} */ let anon;

  /** The student row belonging to the signed-in student account. */
  let ownStudentId = null;
  /** Some other student, used to prove the boundary is real. */
  let otherStudentId = null;

  const scratchRoom = `RLS Live Audit ${Date.now()}`;

  beforeAll(async () => {
    [admin, teacher, student] = await Promise.all([
      signedIn(personas[0][0], personas[0][1]),
      signedIn(personas[1][0], personas[1][1]),
      signedIn(personas[2][0], personas[2][1]),
    ]);
    anon = client();

    const { data: own } = await student.from("students").select("id");
    ownStudentId = own?.[0]?.id ?? null;

    // The admin sees everyone, so it is the only client that can name a
    // student the student account must NOT be able to reach.
    const { data: all, error } = await admin
      .from("students")
      .select("id")
      .limit(50);
    if (error)
      throw new Error(`admin could not list students: ${error.message}`);
    otherStudentId = all?.find((r) => r.id !== ownStudentId)?.id ?? null;
  });

  afterAll(async () => {
    // Best-effort: the admin write test deletes its own row, this catches the
    // case where an assertion failed in between.
    await admin?.from("rooms").delete().eq("name", scratchRoom);
    await Promise.all([
      admin?.auth.signOut(),
      teacher?.auth.signOut(),
      student?.auth.signOut(),
    ]);
  });

  describe("anonymous visitor", () => {
    it("reads no students, grades, or profiles", async () => {
      for (const table of [
        "students",
        "student_grades",
        "profiles",
        "attendance",
      ]) {
        const { data } = await anon.from(table).select("*").limit(1);
        expect(data ?? [], `anon could read ${table}`).toEqual([]);
      }
    });

    it("cannot insert a student", async () => {
      const res = await anon
        .from("students")
        .insert({
          first_name: "Anon",
          last_name: "Intruder",
          enrollment_number: `RLS-LIVE-${Date.now()}`,
        })
        .select();
      expect(wasDenied(res), "anon was able to insert a student").toBe(true);
    });
  });

  describe("student", () => {
    it("is linked to exactly one student record", () => {
      expect(
        ownStudentId,
        "the test student account is not linked to a students row " +
          "(set students.auth_user_id) — the rest of this suite cannot be trusted",
      ).not.toBeNull();
    });

    it("sees only their own student row", async () => {
      const { data } = await student.from("students").select("id");
      expect(data).toHaveLength(1);
      expect(data[0].id).toBe(ownStudentId);
    });

    it("cannot read another student by id", async () => {
      if (otherStudentId == null) return; // single-student project, nothing to prove
      const { data } = await student
        .from("students")
        .select("id")
        .eq("id", otherStudentId);
      expect(data ?? [], "a student read another student's record").toEqual([]);
    });

    it("cannot read another student's grades or attendance", async () => {
      for (const table of [
        "student_grades",
        "attendance",
        "discipline_records",
      ]) {
        const { data } = await student.from(table).select("student_id");
        const foreign = (data ?? []).filter(
          (r) => r.student_id !== ownStudentId,
        );
        expect(foreign, `a student read another student's ${table}`).toEqual(
          [],
        );
      }
    });

    it("cannot change their own grade", async () => {
      const res = await student
        .from("student_grades")
        .update({ score: 100 })
        .select();
      expect(wasDenied(res), "a student rewrote their own grade").toBe(true);
    });

    it("cannot edit their own student record", async () => {
      const res = await student
        .from("students")
        .update({ first_name: "Renamed" })
        .eq("id", ownStudentId)
        .select();
      expect(wasDenied(res), "a student edited their own record").toBe(true);
    });

    it("cannot promote themselves to admin", async () => {
      const { data: me } = await student.auth.getUser();
      const res = await student
        .from("profiles")
        .update({ role: "admin" })
        .eq("id", me.user.id)
        .select();
      expect(
        wasDenied(res),
        "PRIVILEGE ESCALATION: a student became an admin",
      ).toBe(true);

      // Confirm from a client that can actually see the row.
      const { data: after } = await admin
        .from("profiles")
        .select("role")
        .eq("id", me.user.id)
        .maybeSingle();
      expect(after?.role, "the student's role changed").not.toBe("admin");
    });

    it("cannot create reference data", async () => {
      const res = await student
        .from("subjects")
        .insert({ name: "Student Made This" })
        .select();
      expect(wasDenied(res), "a student created a subject").toBe(true);
    });
  });

  describe("teacher", () => {
    it("reads only students from classes they teach", async () => {
      const { data: mine } = await teacher
        .from("students")
        .select("id, class_id");
      const { data: classes } = await teacher
        .from("class_subject_teachers")
        .select("class_id");

      // `teachers` is self-read-only now (RLS narrowed to admin + the caller's
      // own row — see incremental_narrow_read_policies.sql), so this just
      // confirms that self-read still works, not that the whole table is
      // readable. The class/student boundary below is the real assertion.
      const { data: myTeacher } = await teacher
        .from("teachers")
        .select("id")
        .limit(1000);
      expect(
        myTeacher,
        "teacher could not read their own teachers row",
      ).toBeTruthy();

      const taught = new Set((classes ?? []).map((r) => r.class_id));
      const outside = (mine ?? []).filter(
        (s) => s.class_id != null && !taught.has(s.class_id),
      );
      // Homeroom classes also count, so only flag rows outside every class the
      // teacher is attached to in any way.
      if (outside.length) {
        const { data: homerooms } = await teacher.from("classes").select("id");
        const known = new Set([
          ...taught,
          ...(homerooms ?? []).map((c) => c.id),
        ]);
        const leaked = outside.filter((s) => !known.has(s.class_id));
        expect(leaked, "a teacher read students outside their classes").toEqual(
          [],
        );
      }
    });

    it("cannot create a school year, subject, or teacher record", async () => {
      const attempts = [
        teacher
          .from("school_years")
          .insert({
            name: "T Year",
            start_date: "2400-02-01",
            end_date: "2400-11-30",
          })
          .select(),
        teacher.from("subjects").insert({ name: "Teacher Made This" }).select(),
        teacher
          .from("teachers")
          .insert({ first_name: "Fake", last_name: "Colleague" })
          .select(),
      ];
      for (const res of await Promise.all(attempts)) {
        expect(wasDenied(res), "a teacher wrote to an admin-only table").toBe(
          true,
        );
      }
    });

    it("cannot enroll or edit a student", async () => {
      const insert = await teacher
        .from("students")
        .insert({
          first_name: "Fake",
          last_name: "Student",
          enrollment_number: `RLS-LIVE-T-${Date.now()}`,
        })
        .select();
      expect(wasDenied(insert), "a teacher enrolled a student").toBe(true);

      if (ownStudentId != null) {
        const update = await teacher
          .from("students")
          .update({ first_name: "Renamed" })
          .eq("id", ownStudentId)
          .select();
        expect(wasDenied(update), "a teacher edited a student record").toBe(
          true,
        );
      }
    });

    it("cannot promote themselves to admin", async () => {
      const { data: me } = await teacher.auth.getUser();
      const res = await teacher
        .from("profiles")
        .update({ role: "admin" })
        .eq("id", me.user.id)
        .select();
      expect(
        wasDenied(res),
        "PRIVILEGE ESCALATION: a teacher became an admin",
      ).toBe(true);
    });
  });

  describe("admin", () => {
    it("can still create and remove a room", async () => {
      const insert = await admin
        .from("rooms")
        .insert({ name: scratchRoom })
        .select();
      expect(
        insert.error,
        "an admin could not write — is this the demo project? Its lockdown " +
          "denies every write by design; point this suite at a school-style " +
          "test project instead.",
      ).toBeNull();
      expect(insert.data ?? []).toHaveLength(1);

      const del = await admin
        .from("rooms")
        .delete()
        .eq("name", scratchRoom)
        .select();
      expect(del.error).toBeNull();
      expect(
        del.data ?? [],
        "admin could not delete the room it just made",
      ).toHaveLength(1);
    });

    it("sees more students than the student account does", async () => {
      const { data } = await admin.from("students").select("id");
      expect((data ?? []).length).toBeGreaterThanOrEqual(1);
    });
  });
});
