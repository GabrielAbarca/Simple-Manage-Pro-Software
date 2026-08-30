// ═══════════════════════════════════════════════════════════════
//  demoDb.js — demo-mode write sandbox for the teacher console
//
//  Wraps the admin data layer (the `db` object in admin.js) so every
//  write lands in an in-memory, per-session delta store instead of
//  Supabase, while reads keep hitting the real (read-only) backend and
//  get the session's deltas overlaid on the way out. The console's
//  write→re-fetch flows then render local changes as if they persisted;
//  a refresh discards the deltas and restores pristine demo data.
//
//  This module NEVER writes to Supabase — the few direct queries below
//  are read-only SELECTs needed where the wrapped read method doesn't
//  return enough columns to dedupe against local upserts. The server-side
//  RLS read-only policy remains the backstop for anyone bypassing the UI.
// ═══════════════════════════════════════════════════════════════

import { supabase } from "./supabaseClient.js";

// ── student_period_grades view emulation ────────────────────
// A port of the SQL view in supabase/schema/incremental_teacher_policies.sql,
// which is itself the definition the demo project runs. Keep the two in step:
// a student edited during a demo session is scored here, everyone else comes
// straight from the view, and the two sit in the same gradebook column.
//
//   · within a category: points earned ÷ points possible × 100 — NOT the
//     average of each assignment's percentage. With mixed max_scores those
//     diverge sharply (a 100-point exam and a 10-point quiz are not equal
//     halves of a grade), and this file used to do the latter.
//   · categories combine weighted by grade_categories.weight, renormalised
//     over only the categories carrying graded work
//   · uncategorised work does not enter the weighted branch at all; it
//     counts only in the fallback below, matching the view's inner join
//   · with no weighted categories, the same points ratio over every graded
//     assignment
//   · null when nothing is graded; rounded to 2dp like the view's round()
export function computePeriodScore(assignmentList, gradeRows, cats) {
  const byId = new Map(assignmentList.map((a) => [a.id, a]));
  const weightByCat = new Map(cats.map((c) => [c.id, Number(c.weight) || 0]));

  // Points earned/possible overall, and per category for the weighted branch.
  let allScore = 0;
  let allMax = 0;
  /** @type {Map<number, {score: number, max: number}>} */
  const perCat = new Map();

  gradeRows.forEach((g) => {
    if (g.score == null) return;
    const assignment = byId.get(g.assignment_id);
    const max = Number(assignment?.max_score);
    if (!assignment || !max) return;

    const score = Number(g.score);
    allScore += score;
    allMax += max;

    // A category the caller didn't hand us (deleted, or another subject's)
    // is skipped here, the way the view's join to grade_categories drops it.
    const catId = assignment.category_id;
    if (catId == null || !weightByCat.has(catId)) return;
    const bucket = perCat.get(catId) ?? { score: 0, max: 0 };
    bucket.score += score;
    bucket.max += max;
    perCat.set(catId, bucket);
  });

  if (!allMax) return null;

  let weightedSum = 0;
  let weightTotal = 0;
  perCat.forEach((bucket, catId) => {
    if (!bucket.max) return;
    const weight = weightByCat.get(catId);
    // Zero-weight categories drop out of both sides, as sum(weight) does.
    weightedSum += (bucket.score / bucket.max) * 100 * weight;
    weightTotal += weight;
  });

  const score =
    weightTotal > 0 ? weightedSum / weightTotal : (allScore / allMax) * 100;
  return Math.round(score * 100) / 100;
}

export function wrapDbForDemo(realDb, { onWrite = () => {} } = {}) {
  // Local rows get negative ids: they can never collide with real rows and
  // are easy to keep out of server queries (real ids are positive integers).
  let nextLocalId = -1;
  const newId = () => nextLocalId--;

  // ── Delta stores ────────────────────────────────────────────
  // Row tables: pristine server rows pass through with deletes dropped and
  // update patches merged; local inserts are appended by each read method.
  const makeDelta = () => ({
    inserts: [],
    updates: new Map(), // id → accumulated patch
    deletes: new Set(),
  });
  const students = makeDelta();
  const assignments = makeDelta();
  const schedules = makeDelta();
  const discipline = makeDelta();
  const categories = makeDelta();

  // Upsert tables, keyed by their DB conflict key. Values hold the exact
  // payload the console sent, so reads can serve them back verbatim.
  const gradeDeltas = new Map(); //  "assignmentId|studentId"
  const attendanceDeltas = new Map(); //  "studentId|classId|date"
  const postedDeltas = new Map(); //  "studentId|cstId|periodId"

  // ── Context caches (filled as reads pass through) ───────────
  const assignmentIndex = new Map(); // assignment id → { cstId, periodId }
  const categoryIndex = new Map(); // category id → cstId
  const deletedCategoryIds = new Set(); // emulate assignments.category_id ON DELETE SET NULL
  const seenStudents = new Map(); // student id → { class_id, status } (pristine)
  const cstSubjects = new Map(); // cst id → { name, color }

  // ── Delta bookkeeping ───────────────────────────────────────
  function recordInsert(delta, row) {
    delta.inserts.push(row);
    onWrite();
  }

  function recordUpdate(delta, id, patch) {
    const local = delta.inserts.find((r) => r.id === id);
    if (local) Object.assign(local, patch);
    else delta.updates.set(id, { ...(delta.updates.get(id) ?? {}), ...patch });
    onWrite();
  }

  function recordDelete(delta, id) {
    const at = delta.inserts.findIndex((r) => r.id === id);
    if (at >= 0) delta.inserts.splice(at, 1);
    else {
      delta.updates.delete(id);
      delta.deletes.add(id);
    }
    onWrite();
  }

  // Overlay a row-table delta onto server rows. `matches` filters which local
  // inserts belong to the calling read's scope (its .eq() filters).
  /**
   * @param {any[]} serverRows
   * @param {{ deletes: Set<any>, updates: Map<any, any>, inserts: any[] }} delta
   * @param {(row: any) => boolean} [matches]
   * @returns {any[]}
   */
  function applyDelta(serverRows, delta, matches = () => true) {
    const rows = [];
    serverRows.forEach((r) => {
      if (delta.deletes.has(r.id)) return;
      const patch = delta.updates.get(r.id);
      rows.push(patch ? { ...r, ...patch } : { ...r });
    });
    delta.inserts.forEach((r) => {
      if (matches(r)) rows.push({ ...r });
    });
    return rows;
  }

  // ── Sorters mirroring each read's .order() clauses ──────────
  const byLastName = (a, b) =>
    (a.last_name ?? "").localeCompare(b.last_name ?? "");
  const byDueDate = (a, b) =>
    Number(a.due_date == null) - Number(b.due_date == null) ||
    (a.due_date ?? "").localeCompare(b.due_date ?? "") ||
    (a.created_at ?? "").localeCompare(b.created_at ?? "");
  const byDayTime = (a, b) =>
    a.day_of_week - b.day_of_week ||
    (a.start_time ?? "").localeCompare(b.start_time ?? "");
  const byDateDesc = (a, b) => (b.date ?? "").localeCompare(a.date ?? "");
  const byCatName = (a, b) => (a.name ?? "").localeCompare(b.name ?? "");

  function assignmentPeriod(aid) {
    const local = assignments.inserts.find((r) => r.id === aid);
    if (local)
      return {
        cstId: local.class_subject_teacher_id,
        periodId: local.grading_period_id,
      };
    return assignmentIndex.get(aid) ?? null;
  }

  function categoriesDirty(cstId) {
    if (categories.inserts.some((c) => c.class_subject_teacher_id === cstId))
      return true;
    for (const id of categories.updates.keys())
      if (categoryIndex.get(id) === cstId) return true;
    for (const id of categories.deletes)
      if (categoryIndex.get(id) === cstId) return true;
    return false;
  }

  // Every period of this cst the session's edits could have re-scored.
  // `knownPeriodIds` covers the categories case, which touches all periods.
  function dirtyPeriodsFor(cstId, knownPeriodIds = []) {
    const dirty = new Set();
    const add = (loc) => {
      if (loc && loc.cstId === cstId) dirty.add(loc.periodId);
    };
    assignments.inserts.forEach((r) => {
      if (r.class_subject_teacher_id === cstId) dirty.add(r.grading_period_id);
    });
    assignments.updates.forEach((_, id) => add(assignmentIndex.get(id)));
    assignments.deletes.forEach((id) => add(assignmentIndex.get(id)));
    gradeDeltas.forEach((row) => add(assignmentPeriod(row.assignment_id)));
    if (categoriesDirty(cstId)) knownPeriodIds.forEach((p) => dirty.add(p));
    return dirty;
  }

  // Rebuild the view rows for one (cst, period): pass server rows through and
  // recompute only the students whose data this session changed.
  async function computePeriodRows(cstId, periodId, serverViewRows) {
    const current = await wrapped.fetchAssignments(cstId, periodId);
    const currentIds = new Set(current.map((a) => a.id));
    const serverIds = current.map((a) => a.id).filter((id) => id > 0);

    // Grades on server assignments the session deleted still affect those
    // students' recomputed score (the rows "cascade away"), so query them too.
    const deletedServerIds = [...assignments.deletes].filter((id) => {
      const loc = assignmentIndex.get(id);
      return loc && loc.cstId === cstId && loc.periodId === periodId;
    });

    let serverGrades = [];
    const queryIds = [...serverIds, ...deletedServerIds];
    if (queryIds.length) {
      const { data, error } = await supabase
        .from("assignment_grades")
        .select("assignment_id, student_id, score")
        .in("assignment_id", queryIds);
      if (error) throw error;
      serverGrades = data ?? [];
    }

    const affected = new Set();
    gradeDeltas.forEach((row) => {
      const loc = assignmentPeriod(row.assignment_id);
      if (loc && loc.cstId === cstId && loc.periodId === periodId)
        affected.add(row.student_id);
    });
    serverGrades.forEach((g) => {
      if (deletedServerIds.includes(g.assignment_id))
        affected.add(g.student_id);
    });

    // Merge server grades + local upserts per student, current assignments only.
    const overriddenKeys = new Set(
      [...gradeDeltas.keys()].filter((k) =>
        currentIds.has(gradeDeltas.get(k).assignment_id),
      ),
    );
    const rowsByStudent = new Map();
    const push = (sid, row) => {
      if (!rowsByStudent.has(sid)) rowsByStudent.set(sid, []);
      rowsByStudent.get(sid).push(row);
    };
    serverGrades.forEach((g) => {
      if (!currentIds.has(g.assignment_id)) return;
      if (students.deletes.has(g.student_id)) return;
      if (overriddenKeys.has(`${g.assignment_id}|${g.student_id}`)) return;
      push(g.student_id, g);
    });
    gradeDeltas.forEach((row) => {
      if (currentIds.has(row.assignment_id)) push(row.student_id, row);
    });

    if (categoriesDirty(cstId))
      rowsByStudent.forEach((_, sid) => affected.add(sid));

    const cats = await wrapped.fetchCategories(cstId);
    const total = current.length;

    const out = new Map();
    (serverViewRows ?? []).forEach((r) => {
      if (students.deletes.has(r.student_id)) return;
      out.set(r.student_id, { ...r, total_assignments: total });
    });
    affected.forEach((sid) => {
      if (students.deletes.has(sid)) return;
      const rows = rowsByStudent.get(sid) ?? [];
      out.set(sid, {
        student_id: sid,
        period_score: computePeriodScore(current, rows, cats),
        graded_count: rows.filter((g) => g.score != null).length,
        total_assignments: total,
      });
    });
    return [...out.values()];
  }

  // ── The wrapped data layer ──────────────────────────────────
  const wrapped = {
    // Pure passthroughs — reference/read-only data no demo write can touch.
    getTeacherId: realDb.getTeacherId,
    fetchActiveYear: realDb.fetchActiveYear,
    fetchTeacher: realDb.fetchTeacher,
    fetchTeacherFull: realDb.fetchTeacherFull,
    fetchGradingPeriods: realDb.fetchGradingPeriods,
    fetchStudentContacts: realDb.fetchStudentContacts,
    fetchSubjects: realDb.fetchSubjects,
    fetchTeachers: realDb.fetchTeachers,
    fetchRooms: realDb.fetchRooms,
    fetchSubjectsDetailed: realDb.fetchSubjectsDetailed,
    // Admin-owned MEP schemes are read-only reference data for the teacher;
    // instantiating one writes through insertCategory, which the overlay owns.
    fetchComponentTemplates: realDb.fetchComponentTemplates,
    fetchTemplateItems: realDb.fetchTemplateItems,

    // Passthrough that also feeds the join-resolution caches.
    async fetchMyClasses(teacherId, yearId) {
      const rows = await realDb.fetchMyClasses(teacherId, yearId);
      rows.forEach((r) => {
        if (r.subjects)
          cstSubjects.set(r.id, {
            name: r.subjects.name,
            color: r.subjects.color,
          });
      });
      return rows;
    },

    // ── Students ────────────────────────────────────────────
    async fetchRoster(classId) {
      const server = await realDb.fetchRoster(classId);
      server.forEach((s) =>
        seenStudents.set(s.id, { class_id: classId, status: s.status }),
      );
      const rows = [];
      server.forEach((s) => {
        if (students.deletes.has(s.id)) return;
        const patch = students.updates.get(s.id);
        // A class move edits the student out of this roster (the server select
        // has no class_id column, so the patch is the only signal).
        if (patch?.class_id != null && patch.class_id !== classId) return;
        rows.push(patch ? { ...s, ...patch } : { ...s });
      });
      students.inserts.forEach((s) => {
        if (s.class_id === classId) rows.push({ ...s });
      });
      return rows.sort(byLastName);
    },

    async fetchActiveCountByClass() {
      const counts = await realDb.fetchActiveCountByClass();
      students.inserts.forEach((s) => {
        if (s.status === "active" && s.class_id)
          counts[s.class_id] = (counts[s.class_id] || 0) + 1;
      });
      students.deletes.forEach((id) => {
        const seen = seenStudents.get(id);
        if (seen?.status === "active" && seen.class_id)
          counts[seen.class_id] = Math.max(0, (counts[seen.class_id] || 0) - 1);
      });
      students.updates.forEach((patch, id) => {
        const seen = seenStudents.get(id);
        if (!seen) return;
        const before = seen.status === "active" ? seen.class_id : null;
        const after =
          (patch.status ?? seen.status) === "active"
            ? (patch.class_id ?? seen.class_id)
            : null;
        if (before === after) return;
        if (before) counts[before] = Math.max(0, (counts[before] || 0) - 1);
        if (after) counts[after] = (counts[after] || 0) + 1;
      });
      return counts;
    },

    async insertStudent(payload) {
      recordInsert(students, { id: newId(), national_id: null, ...payload });
    },
    async updateStudent(id, payload) {
      recordUpdate(students, id, payload);
    },
    async deleteStudent(id) {
      recordDelete(students, id);
      // Cascade the student's local grade/attendance/posted rows away too.
      [...gradeDeltas].forEach(([k, v]) => {
        if (v.student_id === id) gradeDeltas.delete(k);
      });
      [...attendanceDeltas].forEach(([k, v]) => {
        if (v.student_id === id) attendanceDeltas.delete(k);
      });
      [...postedDeltas].forEach(([k, v]) => {
        if (v.student_id === id) postedDeltas.delete(k);
      });
    },

    // ── Assignments ─────────────────────────────────────────
    async fetchAssignments(cstId, periodId) {
      const server = await realDb.fetchAssignments(cstId, periodId);
      server.forEach((a) => assignmentIndex.set(a.id, { cstId, periodId }));
      const rows = applyDelta(
        server,
        assignments,
        (a) =>
          a.class_subject_teacher_id === cstId &&
          a.grading_period_id === periodId,
      );
      rows.forEach((a) => {
        if (a.category_id != null && deletedCategoryIds.has(a.category_id))
          a.category_id = null;
      });
      return rows.sort(byDueDate);
    },

    async insertAssignment(payload) {
      recordInsert(assignments, {
        id: newId(),
        created_at: new Date().toISOString(),
        ...payload,
      });
    },
    async updateAssignment(id, payload) {
      recordUpdate(assignments, id, payload);
    },
    async deleteAssignment(id) {
      recordDelete(assignments, id);
      // assignment_grades cascade: local rows for it disappear with it.
      [...gradeDeltas].forEach(([k, v]) => {
        if (v.assignment_id === id) gradeDeltas.delete(k);
      });
    },

    // ── Assignment grades ───────────────────────────────────
    async fetchStudentAssignmentGrades(assignmentIds, studentId) {
      if (!assignmentIds.length) return [];
      const serverIds = assignmentIds.filter((id) => id > 0);
      const server = serverIds.length
        ? await realDb.fetchStudentAssignmentGrades(serverIds, studentId)
        : [];
      const out = [];
      const covered = new Set();
      server.forEach((g) => {
        const d = gradeDeltas.get(`${g.assignment_id}|${studentId}`);
        // Local upserts win, but the pristine created_at survives (the real
        // upsert never sends created_at either).
        out.push(d ? { ...g, ...d, created_at: g.created_at } : g);
        covered.add(g.assignment_id);
      });
      assignmentIds.forEach((aid) => {
        if (covered.has(aid)) return;
        const d = gradeDeltas.get(`${aid}|${studentId}`);
        if (d)
          out.push({
            assignment_id: aid,
            score: d.score,
            note: d.note ?? null,
            graded_at: d.graded_at ?? null,
            created_at: d.created_at,
          });
      });
      return out;
    },

    async fetchAssignmentColumn(assignmentId) {
      const server =
        assignmentId > 0
          ? await realDb.fetchAssignmentColumn(assignmentId)
          : [];
      const out = [];
      const covered = new Set();
      server.forEach((g) => {
        const d = gradeDeltas.get(`${assignmentId}|${g.student_id}`);
        out.push(
          d
            ? {
                ...g,
                score: d.score,
                note: d.note ?? null,
                graded_at: d.graded_at ?? null,
              }
            : g,
        );
        covered.add(g.student_id);
      });
      gradeDeltas.forEach((d) => {
        if (d.assignment_id !== assignmentId || covered.has(d.student_id))
          return;
        out.push({
          student_id: d.student_id,
          score: d.score,
          note: d.note ?? null,
          graded_at: d.graded_at ?? null,
        });
      });
      return out.filter((g) => !students.deletes.has(g.student_id));
    },

    async upsertAssignmentGrades(rows) {
      const now = new Date().toISOString();
      rows.forEach((r) => {
        const key = `${r.assignment_id}|${r.student_id}`;
        const prev = gradeDeltas.get(key);
        gradeDeltas.set(key, { ...r, created_at: prev?.created_at ?? now });
      });
      onWrite();
    },

    // ── Period grades (server-computed view) ────────────────
    async fetchPeriodGrades(cstId, periodId) {
      const server = await realDb.fetchPeriodGrades(cstId, periodId);
      if (!dirtyPeriodsFor(cstId, [periodId]).has(periodId)) return server;
      return computePeriodRows(cstId, periodId, server);
    },

    async fetchAllPeriodGrades(cstId) {
      const server = await realDb.fetchAllPeriodGrades(cstId);
      const knownPeriods = [...new Set(server.map((r) => r.grading_period_id))];
      const dirty = dirtyPeriodsFor(cstId, knownPeriods);
      if (!dirty.size)
        return server.filter((r) => !students.deletes.has(r.student_id));

      const out = server.filter(
        (r) =>
          !dirty.has(r.grading_period_id) &&
          !students.deletes.has(r.student_id),
      );
      for (const periodId of dirty) {
        const baseline = server.filter((r) => r.grading_period_id === periodId);
        const rows = await computePeriodRows(cstId, periodId, baseline);
        rows.forEach((r) =>
          out.push({
            student_id: r.student_id,
            grading_period_id: periodId,
            period_score: r.period_score,
          }),
        );
      }
      return out;
    },

    // ── Attendance ──────────────────────────────────────────
    async fetchAttendanceSheet(classId, date) {
      const sheet = await realDb.fetchAttendanceSheet(classId, date);
      sheet.forEach((row) =>
        seenStudents.set(row.id, { class_id: classId, status: "active" }),
      );
      const rows = [];
      sheet.forEach((row) => {
        if (students.deletes.has(row.id)) return;
        const patch = students.updates.get(row.id);
        if (patch) {
          // `status` on a sheet row is the ATTENDANCE status — only names and
          // membership changes may come from the student patch.
          if (patch.class_id != null && patch.class_id !== classId) return;
          if (patch.status != null && patch.status !== "active") return;
          rows.push({
            ...row,
            first_name: patch.first_name ?? row.first_name,
            last_name: patch.last_name ?? row.last_name,
          });
        } else rows.push({ ...row });
      });
      students.inserts.forEach((s) => {
        if (s.class_id === classId && s.status === "active")
          rows.push({
            id: s.id,
            first_name: s.first_name,
            last_name: s.last_name,
            status: null,
            notes: "",
          });
      });
      rows.forEach((row) => {
        const d = attendanceDeltas.get(`${row.id}|${classId}|${date}`);
        if (d) {
          row.status = d.status;
          row.notes = d.notes ?? "";
        }
      });
      return rows.sort(byLastName);
    },

    async upsertAttendance(classId, date, rows, recordedBy) {
      rows.forEach((r) => {
        attendanceDeltas.set(`${r.id}|${classId}|${date}`, {
          student_id: r.id,
          class_id: classId,
          date,
          status: r.status,
          notes: r.notes || null,
          recorded_by: recordedBy ?? null,
        });
      });
      onWrite();
    },

    // The wrapped reads below select too few columns to dedupe local upserts
    // (attendance is keyed by student+class+date), so they run their own
    // read-only SELECT with the key columns included.
    async fetchStudentAttendance(studentId) {
      let server = [];
      if (studentId > 0) {
        const { data, error } = await supabase
          .from("attendance")
          .select("status, date, class_id")
          .eq("student_id", studentId);
        if (error) throw error;
        server = data ?? [];
      }
      const out = [];
      const covered = new Set();
      server.forEach((r) => {
        const key = `${studentId}|${r.class_id}|${r.date}`;
        const d = attendanceDeltas.get(key);
        out.push({ status: d ? d.status : r.status });
        if (d) covered.add(key);
      });
      attendanceDeltas.forEach((d, key) => {
        if (d.student_id === studentId && !covered.has(key))
          out.push({ status: d.status });
      });
      return out;
    },

    async fetchClassAttendance(classId) {
      const { data, error } = await supabase
        .from("attendance")
        .select("student_id, status, date")
        .eq("class_id", classId);
      if (error) throw error;
      const out = [];
      const covered = new Set();
      (data ?? []).forEach((r) => {
        if (students.deletes.has(r.student_id)) return;
        const key = `${r.student_id}|${classId}|${r.date}`;
        const d = attendanceDeltas.get(key);
        out.push({ student_id: r.student_id, status: d ? d.status : r.status });
        if (d) covered.add(key);
      });
      attendanceDeltas.forEach((d, key) => {
        if (
          d.class_id === classId &&
          !covered.has(key) &&
          !students.deletes.has(d.student_id)
        )
          out.push({ student_id: d.student_id, status: d.status });
      });
      return out;
    },

    // ── Schedule ────────────────────────────────────────────
    async fetchScheduleByClass(classId) {
      const server = await realDb.fetchScheduleByClass(classId);
      const rows = applyDelta(server, schedules, (e) => e.class_id === classId);
      return rows.sort(byDayTime);
    },

    async fetchScheduleToday(teacherId, dayOfWeek) {
      const server = await realDb.fetchScheduleToday(teacherId, dayOfWeek);
      const rows = applyDelta(
        server,
        schedules,
        (e) => e.teacher_id === teacherId && e.day_of_week === dayOfWeek,
      );
      return rows.sort((a, b) =>
        (a.start_time ?? "").localeCompare(b.start_time ?? ""),
      );
    },

    // ── Discipline ──────────────────────────────────────────
    async fetchStudentDiscipline(studentId) {
      const server = await realDb.fetchStudentDiscipline(studentId);
      const rows = applyDelta(
        server,
        discipline,
        (r) => r.student_id === studentId,
      );
      return rows.sort(byDateDesc);
    },

    async insertDiscipline(payload) {
      recordInsert(discipline, {
        id: newId(),
        resolved: false,
        resolution: null,
        ...payload,
      });
    },
    async updateDiscipline(id, payload) {
      recordUpdate(discipline, id, payload);
    },

    // ── Posted period grades (student_grades) ───────────────
    async fetchPostedGrades(cstId, periodId) {
      const server = await realDb.fetchPostedGrades(cstId, periodId);
      const out = [];
      const covered = new Set();
      server.forEach((r) => {
        const key = `${r.student_id}|${cstId}|${periodId}`;
        const d = postedDeltas.get(key);
        out.push(
          d
            ? {
                student_id: r.student_id,
                score: d.score,
                notes: d.notes,
                submitted_at: d.submitted_at,
              }
            : r,
        );
        if (d) covered.add(key);
      });
      postedDeltas.forEach((d, key) => {
        if (
          d.class_subject_teacher_id === cstId &&
          d.grading_period_id === periodId &&
          !covered.has(key)
        )
          out.push({
            student_id: d.student_id,
            score: d.score,
            notes: d.notes,
            submitted_at: d.submitted_at,
          });
      });
      return out.filter((r) => !students.deletes.has(r.student_id));
    },

    // Same dedupe problem as attendance: the wrapped selects omit the cst id,
    // which is half of the upsert key — so query with it included.
    async fetchStudentSubjectGrades(studentId, periodId) {
      let server = [];
      if (studentId > 0) {
        const { data, error } = await supabase
          .from("student_grades")
          .select(
            "score, class_subject_teacher_id, class_subject_teachers!class_subject_teacher_id(subjects!subject_id(name, color))",
          )
          .eq("student_id", studentId)
          .eq("grading_period_id", periodId);
        if (error) throw error;
        server = data ?? [];
      }
      const out = [];
      const covered = new Set();
      server.forEach((r) => {
        const key = `${studentId}|${r.class_subject_teacher_id}|${periodId}`;
        const d = postedDeltas.get(key);
        out.push({
          score: d ? d.score : r.score,
          class_subject_teachers: r.class_subject_teachers,
        });
        if (d) covered.add(key);
      });
      postedDeltas.forEach((d, key) => {
        if (
          d.student_id !== studentId ||
          d.grading_period_id !== periodId ||
          covered.has(key)
        )
          return;
        const subj = cstSubjects.get(d.class_subject_teacher_id);
        out.push({
          score: d.score,
          class_subject_teachers: {
            subjects: { name: subj?.name ?? "—", color: subj?.color ?? null },
          },
        });
      });
      return out;
    },

    async fetchStudentAllSubjectGrades(studentId) {
      let server = [];
      if (studentId > 0) {
        const { data, error } = await supabase
          .from("student_grades")
          .select(
            "score, grading_period_id, notes, class_subject_teacher_id, class_subject_teachers!class_subject_teacher_id(subjects!subject_id(name))",
          )
          .eq("student_id", studentId);
        if (error) throw error;
        server = data ?? [];
      }
      const out = [];
      const covered = new Set();
      server.forEach((r) => {
        const key = `${studentId}|${r.class_subject_teacher_id}|${r.grading_period_id}`;
        const d = postedDeltas.get(key);
        out.push({
          score: d ? d.score : r.score,
          grading_period_id: r.grading_period_id,
          notes: d ? d.notes : r.notes,
          class_subject_teachers: r.class_subject_teachers,
        });
        if (d) covered.add(key);
      });
      postedDeltas.forEach((d, key) => {
        if (d.student_id !== studentId || covered.has(key)) return;
        const subj = cstSubjects.get(d.class_subject_teacher_id);
        out.push({
          score: d.score,
          grading_period_id: d.grading_period_id,
          notes: d.notes,
          class_subject_teachers: { subjects: { name: subj?.name ?? "—" } },
        });
      });
      return out;
    },

    async upsertStudentGrades(rows) {
      rows.forEach((r) => {
        postedDeltas.set(
          `${r.student_id}|${r.class_subject_teacher_id}|${r.grading_period_id}`,
          { ...r },
        );
      });
      onWrite();
    },

    // ── Grade categories ────────────────────────────────────
    async fetchCategories(cstId) {
      const server = await realDb.fetchCategories(cstId);
      server.forEach((c) => categoryIndex.set(c.id, cstId));
      categories.inserts.forEach((c) => {
        if (c.class_subject_teacher_id === cstId)
          categoryIndex.set(c.id, cstId);
      });
      const rows = applyDelta(
        server,
        categories,
        (c) => c.class_subject_teacher_id === cstId,
      );
      return rows.sort(byCatName);
    },

    async insertCategory(payload) {
      recordInsert(categories, { id: newId(), ...payload });
    },
    async updateCategory(id, payload) {
      recordUpdate(categories, id, payload);
    },
    async deleteCategory(id) {
      recordDelete(categories, id);
      // assignments.category_id is ON DELETE SET NULL: null it on local rows
      // here; fetchAssignments nulls it on server rows via deletedCategoryIds.
      deletedCategoryIds.add(id);
      assignments.inserts.forEach((a) => {
        if (a.category_id === id) a.category_id = null;
      });
      assignments.updates.forEach((patch) => {
        if (patch.category_id === id) patch.category_id = null;
      });
    },
  };

  return wrapped;
}
