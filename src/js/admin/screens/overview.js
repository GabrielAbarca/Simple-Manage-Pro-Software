// ─────────────────────────────────────────────────────────────────
//  overview.js — the console's landing screen: who is signed in, which
//  year is active, and seven count cards over the school. Split out of
//  admin.js.
// ─────────────────────────────────────────────────────────────────
import { t, tn, formatDate } from "../../i18n.js";
import { state } from "../state.js";
import { data } from "../data.js";
import { fetchProfile } from "../auth.js";
import { showSection } from "../nav.js";
import { escapeHtml, todayIso, monthStartIso } from "../ui/format.js";
import { loadSchoolSettings } from "../domain/schoolProfile.js";
import { openYearForm } from "./years.js";
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
 * First-run empty state for the overview.
 *
 * Shown only when the school is genuinely untouched — no active year, no
 * students, no teachers, no subjects, no sections. In that state the seven
 * stat cards are all em dashes, which reads as "something is broken" rather
 * than "nothing has been set up yet", and offers no way forward.
 *
 * The one action offered is "Add school year", because every other tab
 * depends on a year existing (that is the dependency order the sidebar is
 * arranged in). One screen, one obvious next step.
 *
 * @returns {boolean} true when the setup panel replaced the stats
 */
function renderOverviewSetup({
  studentCount,
  teachers,
  subjects,
  sectionsList,
}) {
  const host = document.getElementById("overview-setup");
  const stats = document.getElementById("overview-stats");
  if (!host || !stats) return false;

  const untouched =
    !state.activeYear &&
    !studentCount &&
    !teachers.length &&
    !subjects.length &&
    !sectionsList.length;

  host.hidden = !untouched;
  stats.hidden = untouched;
  if (!untouched) {
    host.innerHTML = "";
    return false;
  }

  host.innerHTML = `
    <div class="console-placeholder">
      <span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-calendar_month"></use></svg></span>
      <h2>${escapeHtml(t("console.overview.setupTitle"))}</h2>
      <p>${escapeHtml(t("console.overview.setupBody"))}</p>
      <button type="button" class="btn btn-primary" id="overview-setup-cta">
        <span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-add"></use></svg></span>
        <span>${escapeHtml(t("console.years.add"))}</span>
      </button>
    </div>`;

  document
    .getElementById("overview-setup-cta")
    ?.addEventListener("click", () => {
      showSection("yearperiods");
      openYearForm();
    });
  return true;
}

async function loadOverviewStats() {
  try {
    const [
      studentCount,
      activeStudents,
      sectionsList,
      teachers,
      subjects,
      rooms,
    ] = await Promise.all([
      data.countStudents(),
      data.countStudents("active"),
      state.activeYear
        ? data.listSections(state.activeYear.id)
        : Promise.resolve([]),
      data.listTeachers(),
      data.listSubjects(),
      data.listRooms(),
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
    if (
      renderOverviewSetup({ studentCount, teachers, subjects, sectionsList })
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
