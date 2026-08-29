import { t, formatDate } from "../i18n.js";
import { getEvents } from "../studentState.js";

export async function initEventsView() {
  const events = await getEvents();
  const container = document.getElementById("events-timeline");

  if (!events || events.length === 0) {
    container.innerHTML = `<div class="loading-cell">${t("student.events.empty")}</div>`;
    return;
  }

  const iconMap = {
    holiday: "beach_access",
    exam_period: "quiz",
    activity: "celebration",
    parent_meeting: "groups",
    suspension: "block",
    general: "event",
  };

  container.innerHTML = events
    .map((ev) => {
      const icon = iconMap[ev.type] ?? "event";
      const dateStr = ev.end_date
        ? `${formatDate(ev.start_date)} → ${formatDate(ev.end_date)}`
        : formatDate(ev.start_date);

      return `<div class="event-card event-${ev.type}">
      <div class="event-icon">
        <span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-${icon}"></use></svg></span>
      </div>
      <div class="event-body">
        <h3>${ev.title}</h3>
        <p>${ev.description ?? ""}</p>
        <div class="event-dates">
          <span class="material-symbols-outlined" style="font-size:.85rem;vertical-align:middle;"><svg aria-hidden="true"><use href="#icon-calendar_today"></use></svg></span>
          ${dateStr}
          <span class="badge badge-${eventTypeBadge(ev.type)}" style="margin-left:.5rem;">${formatEventType(ev.type)}</span>
        </div>
      </div>
    </div>`;
    })
    .join("");
}

function eventTypeBadge(type) {
  const map = {
    holiday: "danger",
    exam_period: "warning",
    activity: "success",
    parent_meeting: "primary",
    suspension: "danger",
    general: "info",
  };
  return map[type] ?? "info";
}

function formatEventType(type) {
  const known = [
    "holiday",
    "exam_period",
    "activity",
    "parent_meeting",
    "suspension",
    "general",
  ];
  return known.includes(type) ? t(`enums.eventType.${type}`) : type;
}
