// ─────────────────────────────────────────────────────────────────
//  forms.js — the schedules tab's three dialogs: add/edit one class
//  period, choose the school's teaching days, and copy another
//  section's week. Split out of admin.js.
//
//  Conflicts come back typed: a `section` clash is rejected inline, a
//  `teacher`/`room` clash is a warning the director can override —
//  co-teaching and shared rooms are real.
// ─────────────────────────────────────────────────────────────────
import { t } from "../../i18n.js";
import * as v from "../../validate.js";
import * as sched from "../../scheduleLogic.js";
import { state } from "../state.js";
import { data } from "../data.js";
import { showToast, openConfirm } from "../ui/feedback.js";
import { openModal } from "../ui/modal.js";
import { optionsFrom } from "../ui/tables.js";
import { sectionName } from "../domain/lookups.js";
import { repaint } from "./tabState.js";
import {
  dayLabel,
  conflictText,
  entryFromValues,
  currentSchedSection,
  reloadYearSchedules,
} from "./helpers.js";

/**
 * Add or edit one class period.
 * @param {any} [entry] the row being edited, if any
 * @param {any} [prefill] day/time to start from (clicking an empty slot)
 */
export function openScheduleEntryForm(entry = null, prefill = null) {
  const section = currentSchedSection();
  if (!section) {
    showToast(t("console.schedules.editor.pickSection"), "error");
    return;
  }
  const days = sched.resolveActiveDays(state.scheduleConfig);
  const source = entry ?? prefill ?? {};

  openModal({
    title: entry
      ? t("console.schedules.editor.editTitle")
      : t("console.schedules.editor.addTitle"),
    fields: [
      {
        name: "day_of_week",
        label: t("console.schedules.day"),
        type: "select",
        required: true,
        value: source.day_of_week ?? days[0],
        options: days.map((d) => ({ value: d, label: dayLabel(d) })),
      },
      {
        name: "start_time",
        label: t("console.schedules.start"),
        type: "time",
        required: true,
        value: sched.normalizeTime(source.start_time),
      },
      {
        name: "end_time",
        label: t("console.schedules.end"),
        type: "time",
        required: true,
        value: sched.normalizeTime(source.end_time),
        rules: [v.endAfterStart("start_time")],
      },
      {
        name: "subject_id",
        label: t("console.schedules.subject"),
        type: "select",
        required: true,
        value: source.subject_id,
        options: optionsFrom(state.subjects, (s) => s.name),
      },
      {
        name: "teacher_id",
        label: t("console.schedules.teacher"),
        type: "select",
        required: true,
        value: source.teacher_id,
        options: optionsFrom(
          state.teachers,
          (tch) => `${tch.first_name} ${tch.last_name}`,
        ),
      },
      {
        name: "room_id",
        label: t("console.schedules.room"),
        type: "select",
        value: source.room_id ?? "",
        options: optionsFrom(state.rooms, (r) => r.name),
      },
    ],
    // The section clashing with itself is rejected inline; a teacher or
    // room clash is confirmed instead (see below), never silently blocked.
    validate: (values) => {
      const own = clashesFor(values, section, entry).find(
        (c) => c.type === "section",
      );
      return own ? { start_time: conflictText(own) } : {};
    },
    onSubmit: async (values) => {
      const candidate = entryFromValues(values, section.id);
      const warnings = clashesFor(values, section, entry).filter(
        (c) => c.type !== "section",
      );

      const write = async () => {
        if (entry) await data.updateSchedule(entry.id, candidate);
        else await data.createSchedule(candidate);
        showToast(
          t(
            entry
              ? "console.schedules.editor.updated"
              : "console.schedules.editor.added",
          ),
        );
        await reloadYearSchedules();
      };

      if (!warnings.length) {
        await write();
        return;
      }
      // Deliberately not a hard stop: co-teaching, assemblies and split
      // rooms are legitimate, so the director gets the facts and decides.
      openConfirm(
        `${t("console.schedules.conflicts.reviewIntro")}\n\n${warnings
          .map(conflictText)
          .join("\n")}`,
        write,
        {
          title: t("console.schedules.conflicts.reviewTitle"),
          confirmLabel: t("console.schedules.conflicts.saveAnyway"),
          danger: false,
        },
      );
    },
  });
}

function clashesFor(values, section, entry) {
  return sched.findConflicts(
    entryFromValues(values, section.id),
    state.yearSchedules,
    { excludeId: entry?.id ?? null },
  );
}

/** Which days the school teaches on — drives the grid's columns. */
export function openConfigureDaysModal() {
  const current = sched.resolveActiveDays(state.scheduleConfig);
  openModal({
    title: t("console.schedules.days.title"),
    fields: [
      {
        name: "active_days",
        label: t("console.schedules.days.configure"),
        type: "checkboxes",
        value: current.map(String),
        help: t("console.schedules.days.help"),
        options: sched.ALL_DAYS.map((d) => ({ value: d, label: dayLabel(d) })),
      },
    ],
    validate: (values) =>
      values.active_days?.length
        ? {}
        : { active_days: t("console.schedules.days.atLeastOne") },
    onSubmit: async (values) => {
      const active_days = values.active_days.map(Number).sort((a, b) => a - b);
      if (state.scheduleConfig?.id) {
        await data.updateScheduleConfig(state.scheduleConfig.id, {
          active_days,
        });
        state.scheduleConfig = { ...state.scheduleConfig, active_days };
      } else {
        state.scheduleConfig = await data.createScheduleConfig({
          school_year_id: state.activeYear.id,
          structure_type: "section",
          active_days,
        });
      }
      showToast(t("console.schedules.days.saved"));
      repaint();
    },
  });
}

/** Spell out what a copy will and will not do, before writing anything. */
function copySummaryLines(plan, target) {
  const lines = [
    t("console.schedules.copy.summary", {
      count: plan.rows.length,
      section: sectionName(target),
    }),
  ];
  if (plan.skipped.length) {
    lines.push(
      t("console.schedules.copy.skipped", {
        count: plan.skipped.length,
        section: sectionName(target),
      }),
    );
  }
  if (plan.conflicts.length) {
    lines.push(
      t("console.schedules.copy.warnings", { count: plan.conflicts.length }),
    );
  }
  return lines;
}

/** Copy another section's week onto the one being edited. */
export function openCopyScheduleModal() {
  const target = currentSchedSection();
  if (!target) {
    showToast(t("console.schedules.copy.needTarget"), "error");
    return;
  }
  const sources = state.sections.filter(
    (s) =>
      s.id !== target.id &&
      state.yearSchedules.some((e) => e.class_id === s.id),
  );
  if (!sources.length) {
    showToast(t("console.schedules.copy.noSource"), "error");
    return;
  }

  openModal({
    title: t("console.schedules.copy.title"),
    submitLabel: t("common.continue"),
    fields: [
      {
        name: "source_id",
        label: t("console.schedules.copy.source"),
        type: "select",
        required: true,
        help: t("console.schedules.copy.help"),
        options: optionsFrom(sources, sectionName),
      },
    ],
    onSubmit: async (values) => {
      const sourceId = Number(values.source_id);
      const plan = sched.copySchedulePlan(
        state.yearSchedules.filter((e) => e.class_id === sourceId),
        target.id,
        state.yearSchedules,
      );
      if (!plan.rows.length) {
        showToast(t("console.schedules.copy.nothing"), "error");
        return;
      }
      openConfirm(
        copySummaryLines(plan, target).join("\n"),
        async () => {
          await data.bulkInsert("schedules", plan.rows);
          showToast(
            t("console.schedules.copy.done", { count: plan.rows.length }),
          );
          await reloadYearSchedules();
        },
        {
          title: t("console.schedules.copy.title"),
          confirmLabel: t("common.confirm"),
          danger: false,
        },
      );
    },
  });
}
