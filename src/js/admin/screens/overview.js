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
import { AT_RISK_MISSED_LESSONS, atRiskStudentIds } from "../../atRisk.js";

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
    const sectionsRead = yearId
      ? data.listSections(yearId)
      : Promise.resolve([]);
    const [
      studentCount,
      activeStudents,
      sectionsList,
      teachers,
      subjects,
      rooms,
      periods,
      assignments,
      enrolledCount,
    ] = await Promise.all([
      data.countStudents(),
      data.countStudents("active"),
      sectionsRead,
      data.listTeachers(),
      data.listSubjects(),
      data.listRooms(),
      // Read only for the setup checklist: a failure hides the checklist
      // rather than the whole overview.
      yearId ? data.listPeriods(yearId).catch(() => null) : Promise.resolve([]),
      yearId
        ? data.listAssignments(yearId).catch(() => null)
        : Promise.resolve([]),
      sectionsRead
        .then((list) => data.countEnrolled(list.map((sec) => sec.id)))
        .catch(() => null),
    ]);
    state.sections = sectionsList;
    state.teachers = teachers;
    state.subjects = subjects;
    state.rooms = rooms;
    if (!state.gradeLevels.length)
      state.gradeLevels = await data.listGradeLevels();

    // A school with nothing in it yet gets guidance instead of seven em
    // dashes. This is the director's first screen on their first login, and
    // a grid of blank counters tells them nothing about what to do next.
    const facts =
      periods && assignments && enrolledCount != null
        ? {
            activeYear: state.activeYear,
            hasYears: state.schoolYears.length > 0,
            periods,
            sections: sectionsList,
            subjects,
            teachers,
            assignments,
            enrolledCount,
          }
        : null;
    if (
      renderOverviewSetup(
        {
          studentCount,
          teachers,
          subjects,
          sections: sectionsList,
        },
        facts,
      )
    ) {
      return;
    }

    setStat("stat-enrollment", activeStudents);

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

    await Promise.all([renderAttendanceStat(), renderAtRiskStat()]);
  } catch (err) {
    console.error("loadOverviewStats:", err);
  }
}

/**
 * This month's attendance rate — present + late over every record dated
 * this month, the same numerator the student portal and the teacher
 * console use — with the month named on the card so the percentage is not
 * mistaken for a running total, and the record count underneath so it
 * reads as a sample rather than a claim.
 *
 * A month rather than a day because a single date is only meaningful once
 * that day has been taken: before homeroom it reads 0%, and on a holiday it
 * reads "no data" on a school that is running perfectly well.
 */
async function renderAttendanceStat() {
  const from = monthStartIso();
  const to = todayIso();
  const [total, present] = await Promise.all([
    data.countAttendance(from, to),
    data.countAttendance(from, to, ["present", "late"]),
  ]);
  setStat(
    "stat-attendance",
    total
      ? `${Math.round((present / total) * 100)}%`
      : t("console.overview.noData"),
  );
  const monthName = formatDate(from, { month: "long", year: "numeric" });
  setStat(
    "stat-attendance-hint",
    total
      ? `${monthName} · ${tn("console.overview.attendanceRecords", total, { count: total })}`
      : monthName,
  );
}

/** How many students the shared at-risk rule flags in the active year. */
async function renderAtRiskStat() {
  setStat(
    "stat-atrisk-hint",
    t("console.overview.atRiskHint", { threshold: AT_RISK_MISSED_LESSONS }),
  );
  const year = state.activeYear;
  if (!year) {
    setStat("stat-atrisk", t("console.overview.noData"));
    return;
  }
  const rows = await data.listMissedLessons(year.start_date, year.end_date);
  setStat("stat-atrisk", atRiskStudentIds(rows).size);
}
