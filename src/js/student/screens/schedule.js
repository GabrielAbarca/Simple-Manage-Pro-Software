import { t, formatTime } from "../i18n.js";
import { fetchStudentProfile, fetchClassSchedule } from "../supabaseQueries.js";
import { DEFAULT_ACTIVE_DAYS, dayKeyShort } from "../scheduleLogic.js";
import { state } from "../studentState.js";

export async function initSchedule() {
  if (!state.classId) {
    const profile = await fetchStudentProfile(state.studentId);
    state.classId = profile?.classes?.id;
  }

  const schedule = await fetchClassSchedule(state.classId);
  const grid = document.getElementById("schedule-grid");

  if (!schedule || schedule.length === 0) {
    grid.innerHTML = `<div class="loading-cell">${t("student.schedule.empty")}</div>`;
    return;
  }

  const timeSlots = [
    ...new Map(
      schedule.map((s) => [
        `${s.start_time}-${s.end_time}`,
        { start: s.start_time, end: s.end_time },
      ]),
    ).values(),
  ].sort((a, b) => a.start.localeCompare(b.start));

  // Monday–Friday always show; a weekend column appears only when the
  // student actually has class on it, so a normal week stays five wide.
  const days = [
    ...new Set([
      ...DEFAULT_ACTIVE_DAYS,
      ...schedule.map((s) => Number(s.day_of_week)),
    ]),
  ]
    .filter((d) => d >= 1 && d <= 7)
    .sort((a, b) => a - b);

  let html = "";

  html += `<div class="sch-header">${t("student.schedule.time")}</div>`;
  days.forEach((day) => {
    html += `<div class="sch-header">${t(`common.daysShort.${dayKeyShort(day)}`)}</div>`;
  });

  timeSlots.forEach((slot) => {
    html += `<div class="sch-time">${formatTime(slot.start)}<br>${formatTime(slot.end)}</div>`;

    for (const day of days) {
      const entry = schedule.find(
        (s) =>
          s.day_of_week === day &&
          s.start_time === slot.start &&
          s.end_time === slot.end,
      );

      if (entry) {
        const color = entry.subjects?.color ?? "#7380ec";
        html += `<div class="sch-cell">
          <div class="sch-color-bar" style="background:${color}"></div>
          <span class="sch-subject">${entry.subjects?.name ?? "—"}</span>
          <span class="sch-teacher">${entry.teachers?.first_name ?? ""} ${entry.teachers?.last_name ?? ""}</span>
          <span class="sch-room">${entry.rooms?.name ?? ""}</span>
        </div>`;
      } else {
        html += '<div class="sch-cell empty">—</div>';
      }
    }
  });

  grid.style.setProperty("--sched-days", String(days.length));
  grid.innerHTML = html;
}
