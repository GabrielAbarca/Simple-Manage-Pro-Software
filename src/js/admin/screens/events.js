// ─────────────────────────────────────────────────────────────────
//  events.js — the school calendar students see in their portal:
//  holidays, exam weeks, activities, parent meetings.
// ─────────────────────────────────────────────────────────────────
import { t } from "../../i18n.js";
import * as v from "../../validate.js";
import { state } from "../state.js";
import { data } from "../data.js";
import { escapeHtml, fmtDate, nullable } from "../ui/format.js";
import { showToast, openConfirm } from "../ui/feedback.js";
import { openModal } from "../ui/modal.js";
import {
  renderMessageRow,
  renderEmptyRow,
  renderErrorRow,
  iconBtn,
  markSaved,
  applySavedFlash,
  tableRow,
} from "../ui/tables.js";
import { EVENT_TYPES } from "../domain/enums.js";

const EVENTS_COLS = 4;

export async function loadEvents() {
  renderMessageRow("events-body", EVENTS_COLS, t("common.loading"));
  try {
    state.events = await data.listEvents();
    const tbody = document.getElementById("events-body");
    tbody.innerHTML = "";
    if (!state.events.length) {
      renderEmptyRow("events-body", EVENTS_COLS, t("console.events.empty"));
      return;
    }
    state.events.forEach((ev) => {
      const dates = ev.end_date
        ? `${fmtDate(ev.start_date)} → ${fmtDate(ev.end_date)}`
        : fmtDate(ev.start_date);
      tbody.appendChild(
        tableRow(
          [
            escapeHtml(ev.title),
            escapeHtml(dates),
            `<span class="badge badge-neutral">${escapeHtml(typeLabel(ev.type))}</span>`,
          ],
          [
            iconBtn("edit", t("common.edit"), () => openEventForm(ev)),
            iconBtn(
              "delete",
              t("common.delete"),
              () => confirmDelete(ev),
              true,
            ),
          ],
          ev.id,
        ),
      );
    });
    applySavedFlash("events-body");
  } catch (err) {
    console.error("loadEvents:", err);
    renderErrorRow("events-body", EVENTS_COLS, loadEvents);
  }
}

function typeLabel(type) {
  return EVENT_TYPES.includes(type)
    ? t(`enums.eventType.${type}`)
    : (type ?? "—");
}

function confirmDelete(ev) {
  openConfirm(
    t("console.events.confirmDelete", { name: ev.title }),
    async () => {
      await data.deleteEvent(ev.id);
      showToast(t("common.deleted"));
      loadEvents();
    },
  );
}

export function openEventForm(ev = null) {
  openModal({
    title: ev ? t("console.events.editTitle") : t("console.events.addTitle"),
    fields: [
      {
        name: "title",
        maxLength: 200,
        label: t("console.events.name"),
        value: ev?.title,
        required: true,
      },
      {
        name: "type",
        label: t("console.events.type"),
        type: "select",
        value: ev?.type ?? "general",
        required: true,
        options: EVENT_TYPES.map((type) => ({
          value: type,
          label: t(`enums.eventType.${type}`),
        })),
      },
      {
        name: "start_date",
        label: t("console.events.start"),
        type: "date",
        value: ev?.start_date,
        required: true,
      },
      {
        name: "end_date",
        label: t("console.events.end"),
        type: "date",
        value: ev?.end_date,
        help: t("console.events.endHelp"),
        rules: [v.endNotBeforeStart("start_date")],
      },
      {
        name: "description",
        label: t("console.events.description"),
        type: "textarea",
        value: ev?.description,
      },
    ],
    onSubmit: async (values) => {
      const payload = {
        title: values.title.trim(),
        type: values.type,
        start_date: values.start_date,
        end_date:
          values.end_date === values.start_date
            ? null
            : nullable(values.end_date),
        description: nullable(values.description),
      };
      const saved = ev
        ? await data.updateEvent(ev.id, payload).then(() => ev)
        : await data.createEvent(payload);
      markSaved("events-body", saved?.id ?? ev?.id);
      showToast(t("common.saved"));
      loadEvents();
    },
  });
}

document
  .getElementById("btn-add-event")
  .addEventListener("click", () => openEventForm());
