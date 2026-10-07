// ─────────────────────────────────────────────────────────────────
//  overview.js — the console's landing screen: who is signed in, which
//  year is active, and seven count cards over the school. Split out of
//  admin.js.
// ─────────────────────────────────────────────────────────────────
import { t, tn, formatDate } from "../../i18n.js";
import { state } from "../state.js";
import { data } from "../data.js";
import { fetchProfile } from "../auth.js";
import { todayIso, monthStartIso } from "../ui/format.js";
import { loadSchoolSettings } from "../domain/schoolProfile.js";
import { renderSetupChecklist } from "./setupChecklist.js";

export async function loadOverview() {
  const welcomeTitle = document.getElementById("overview-welcome-title");
  const yearText = document.getElementById("overview-year-text");
  try {
    const [profile, years] = await Promise.all([
      state.profile ? Promise.resolve(state.profile) : fetchProfile(),
      data.listSchoolYears(),
      loadSchoolSettings(),
    ]);
    state.profile = profile;
    state.schoolYears = years;
    state.activeYear = years.find((y) => y.is_active) ?? null;
    applySchoolHeading();

    const name = profile?.name ?? "";
    document.getElementById("admin-name").textContent =
      name || t("console.profile.admin");
    welcomeTitle.textContent = name
      ? t("console.overview.welcome", { name })
      : t("console.overview.welcomeFallback");
    yearText.textContent = state.activeYear?.name
      ? `${t("console.overview.activeYear")}: ${state.activeYear.name}`
      : t("console.overview.noActiveYear");

    await loadOverviewStats();
  } catch (err) {
    console.error("loadOverview:", err);
    yearText.textContent = t("common.loadFailed");
  }
}

/** Title the overview with the school's own name once one is configured. */
function applySchoolHeading() {
  const heading = document.getElementById("overview-heading");
  const name = String(state.school?.name ?? "").trim();
  if (heading && name) heading.textContent = name;
}

// Count cards only. Enrollment = active students; the attendance rate =
// present+late over the current month's records; at-risk = how many students
// have 3+ recorded absences (a figure, not a roster — the per-student
// breakdown is a report, not something a director needs on a school-wide
// dashboard).
const AT_RISK_THRESHOLD = 3;

/**
 * The month's attendance rate, as present+late over every record in the
 * window — the same numerator the student portal and the teacher console use,
 * so the three never disagree about what "attendance" counts.
 *
 * A month rather than a day because a single date is only meaningful once
 * that day has been taken: before homeroom it reads 0%, and on a holiday or
 * any day nobody recorded, it reads "no data" on a school that is running
 * perfectly well.
 *
 * `date` is a plain `date` column, so lexicographic comparison on
 * `YYYY-MM-DD` is the same as chronological — no parsing needed.
 *
 * @param {Array<{ date?: string, status?: string }>} rows every attendance row
 * @param {string} from inclusive `YYYY-MM-DD`
 * @param {string} to inclusive `YYYY-MM-DD`
 * @returns {{ rate: number, present: number, total: number }}
 */
function attendanceRate(rows, from, to) {
  const inWindow = rows.filter(
    (r) => typeof r.date === "string" && r.date >= from && r.date <= to,
  );
  const present = inWindow.filter(
    (r) => r.status === "present" || r.status === "late",
  ).length;
  return {
    rate: inWindow.length ? Math.round((present / inWindow.length) * 100) : 0,
    present,
    total: inWindow.length,
  };
}

/** Write a count into a stat card, guarding against markup drift. */
function setStat(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = String(value);
}

/**
 * The setup checklist above the stats. A school with nothing in it yet gets
 * the checklist instead of the stats: on a director's first login every
 * figure would be an em dash, which reads as broken rather than empty.
 *
 * @param {{ studentCount: number, teachers: any[], subjects: any[],
 *   sections: any[] }} counts
 * @param {import("../domain/setupSteps.js").SetupFacts | null} facts null
 *   when the checklist's own reads failed
 * @returns {boolean} true when the checklist replaced the stats
 */
function renderOverviewSetup(counts, facts) {
  const host = document.getElementById("overview-setup");
  const stats = document.getElementById("overview-stats");
  if (!host || !stats) return false;

  const untouched =
    Boolean(facts) &&
    !state.activeYear &&
    !counts.studentCount &&
    !counts.teachers.length &&
    !counts.subjects.length &&
    !counts.sections.length;
  stats.hidden = untouched;
  renderSetupChecklist(host, facts, { untouched });
  return untouched;
}

async function loadOverviewStats() {
  try {
    const yearId = state.activeYear?.id;
    const [
      students,
      sectionsList,
      allAttendance,
      teachers,
      subjects,
      rooms,
      periods,
      assignments,
    ] = await Promise.all([
      data.listStudents(),
      yearId ? data.listSections(yearId) : Promise.resolve([]),
      // One unfiltered read serves both attendance figures below: the
      // at-risk count needs every record anyway, so the month is a filter
      // over a payload already in hand rather than a second round trip.
      data.listAllAttendance(),
      data.listTeachers(),
      data.listSubjects(),
      data.listRooms(),
      // Read only for the setup checklist: a failure hides the checklist
      // rather than the whole overview.
      yearId ? data.listPeriods(yearId).catch(() => null) : Promise.resolve([]),
      yearId
        ? data.listAssignments(yearId).catch(() => null)
        : Promise.resolve([]),
    ]);
    state.students = students;
    state.sections = sectionsList;
    state.teachers = teachers;
    state.subjects = subjects;
    state.rooms = rooms;
    if (!state.gradeLevels.length)
      state.gradeLevels = await data.listGradeLevels();

    // A school with nothing in it yet gets guidance instead of seven em
    // dashes. This is the director's first screen on their first login, and
    // a grid of blank counters tells them nothing about what to do next.
    const sectionIds = new Set(sectionsList.map((sec) => sec.id));
    const facts =
      periods && assignments
        ? {
            activeYear: state.activeYear,
            hasYears: state.schoolYears.length > 0,
            periods,
            sections: sectionsList,
            subjects,
            teachers,
            assignments,
            enrolledCount: students.filter(
              (st) => st.status === "active" && sectionIds.has(st.class_id),
            ).length,
          }
        : null;
    if (
      renderOverviewSetup(
        {
          studentCount: students.length,
          teachers,
          subjects,
          sections: sectionsList,
        },
        facts,
      )
    ) {
      return;
    }

    // Enrollment (active students).
    const active = students.filter((s) => s.status === "active");
    setStat("stat-enrollment", active.length);

    // Structure counts. Teachers are counted as staff on the books (active
    // ones); sections belong to the active year.
    setStat(
      "stat-teachers",
      teachers.filter((x) => x.status !== "inactive").length,
    );
    setStat("stat-subjects", subjects.length);
    setStat("stat-sections", sectionsList.length);

    // Room utilization: how many rooms this year's sections actually occupy,
    // out of all rooms on file — "8/12" answers "do we have room to grow?".
    const roomsInUse = new Set(
      sectionsList.map((s) => s.room_id).filter((id) => id != null),
    );
    setStat(
      "stat-rooms",
      rooms.length
        ? `${roomsInUse.size}/${rooms.length}`
        : t("console.overview.noData"),
    );

    renderAttendanceStat(allAttendance);
    renderAtRiskStat(allAttendance, students);
  } catch (err) {
    console.error("loadOverviewStats:", err);
  }
}

/**
 * This month's attendance rate, with the month named on the card so the
 * percentage is not mistaken for a running total, and the record count
 * underneath so it reads as a sample rather than a claim.
 *
 * The card's label is static ("Attendance this month") and translated by
 * applyTranslations; the month itself goes in the hint, where Intl can name
 * it per locale without a dictionary entry per month.
 */
function renderAttendanceStat(allAttendance) {
  const monthFrom = monthStartIso();
  const month = attendanceRate(allAttendance, monthFrom, todayIso());
  setStat(
    "stat-attendance",
    month.total ? `${month.rate}%` : t("console.overview.noData"),
  );
  const monthName = formatDate(monthFrom, { month: "long", year: "numeric" });
  setStat(
    "stat-attendance-hint",
    month.total
      ? `${monthName} · ${tn("console.overview.attendanceRecords", month.total, { count: month.total })}`
      : monthName,
  );
}

/**
 * How many students have crossed the absence threshold. Only students still
 * on the roster count.
 */
function renderAtRiskStat(allAttendance, students) {
  const absencesByStudent = new Map();
  allAttendance.forEach((r) => {
    if (r.status === "absent")
      absencesByStudent.set(
        r.student_id,
        (absencesByStudent.get(r.student_id) ?? 0) + 1,
      );
  });
  const atRiskCount = [...absencesByStudent.entries()].filter(
    ([studentId, n]) =>
      n >= AT_RISK_THRESHOLD && students.some((s) => s.id === studentId),
  ).length;
  setStat("stat-atrisk", atRiskCount);
}
