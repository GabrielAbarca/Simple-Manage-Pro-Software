// ─────────────────────────────────────────────────────────────────
//  years.js — the school-years half of the Year & Periods screen.
//  Split out of admin.js.
//
//  Every structural table hangs off school_years, so this is where the
//  console is most careful: activating a year warns when its grading
//  weights do not add up, and deleting one refuses outright while
//  anything still depends on it.
// ─────────────────────────────────────────────────────────────────
import { t } from "../../i18n.js";
import * as v from "../../validate.js";
import { totalWeight, weightStatus } from "../../gradingPeriods.js";
import { state } from "../state.js";
import { data } from "../data.js";
import { escapeHtml, fmtDate } from "../ui/format.js";
import {
  showToast,
  errorText,
  openConfirm,
  openNotice,
} from "../ui/feedback.js";
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
import { loadPeriods } from "./periods.js";

export async function loadYearPeriods() {
  renderMessageRow("years-body", 5, t("common.loading"));
  try {
    const years = await data.listSchoolYears();
    state.schoolYears = years; // the year form's name-uniqueness check
    state.activeYear = years.find((y) => y.is_active) ?? null;
    renderYears(years);
    await loadPeriods();
  } catch (err) {
    console.error("loadYearPeriods:", err);
    renderErrorRow("years-body", 5, loadYearPeriods);
  }
}

function renderYears(years) {
  const tbody = document.getElementById("years-body");
  tbody.innerHTML = "";
  if (!years.length) {
    renderEmptyRow("years-body", 5, t("console.years.empty"));
    return;
  }
  const activeIds = years.filter((y) => y.is_active).map((y) => y.id);
  years.forEach((y) => {
    const status = y.is_active
      ? `<span class="badge badge-success">${t("console.years.active")}</span>`
      : `<span class="badge badge-neutral">${t("console.years.inactive")}</span>`;
    const actions = [];
    if (!y.is_active) {
      actions.push(
        iconBtn("check_circle", t("console.years.setActive"), () =>
          activateYear(y, activeIds),
        ),
      );
    }
    actions.push(iconBtn("edit", t("common.edit"), () => openYearForm(y)));
    actions.push(
      iconBtn("delete", t("common.delete"), () => requestDeleteYear(y), true),
    );
    tbody.appendChild(
      tableRow(
        [
          escapeHtml(y.name),
          fmtDate(y.start_date),
          fmtDate(y.end_date),
          status,
        ],
        actions,
        y.id,
      ),
    );
  });
  applySavedFlash("years-body");
}

/**
 * Delete a school year, but only once nothing hangs off it.
 *
 * Every structural table cascades from school_years — grading_periods, classes
 * and class_subject_teachers directly, and through classes the enrolments,
 * schedules, attendance and grades. Deleting a populated year therefore erases
 * the school in a single click. The dialog has always told the Director its
 * periods and sections must go first; this makes that true.
 * @param {any} year
 */
async function requestDeleteYear(year) {
  /** @type {any[]} */
  let periods;
  /** @type {any[]} */
  let sections;
  try {
    [periods, sections] = await Promise.all([
      data.listPeriods(year.id),
      data.listSections(year.id),
    ]);
  } catch (err) {
    // Deliberately the opposite of activateYear's fall-through below: that one
    // is harmless when its pre-read fails, this one is irreversible, so a count
    // we could not verify has to stop the delete rather than wave it through.
    console.error("requestDeleteYear: could not count dependents:", err);
    showToast(t("console.years.deleteCheckFailed"), "error");
    return;
  }

  if (periods.length || sections.length) {
    openNotice(
      t("console.years.deleteBlocked", {
        name: year.name,
        periods: periods.length,
        sections: sections.length,
      }),
      { title: t("console.years.deleteBlockedTitle") },
    );
    return;
  }

  openConfirm(
    t("console.years.confirmDelete", { name: year.name }),
    async () => {
      await data.deleteSchoolYear(year.id);
      showToast(t("console.years.deleted"));
      loadYearPeriods();
    },
  );
}

/**
 * Make one year the active one. A year whose grading periods don't add up to
 * 100% is the state that silently breaks reporting downstream, so activating
 * one asks for confirmation first (and names the actual total) instead of
 * going through quietly.
 * @param {any} year
 * @param {number[]} previouslyActive
 */
async function activateYear(year, previouslyActive) {
  const commit = async () => {
    try {
      await data.setActiveYear(year.id, previouslyActive);
      showToast(t("console.years.activated"));
      loadYearPeriods();
    } catch (err) {
      showToast(errorText(err), "error");
    }
  };

  /** @type {any[]} */
  let periods;
  try {
    periods = await data.listPeriods(year.id);
  } catch (err) {
    // Can't verify the weights — don't block the activation on a read failure.
    console.error("activateYear: could not read periods:", err);
    await commit();
    return;
  }

  const total = totalWeight(periods);
  if (weightStatus(total, periods.length) === "ok") {
    await commit();
    return;
  }
  openConfirm(t("console.years.activateWeightWarn", { total }), commit, {
    title: t("console.years.setActive"),
    confirmLabel: t("console.years.activateAnyway"),
    danger: false,
  });
}

export function openYearForm(year = null) {
  openModal({
    title: year ? t("console.years.editTitle") : t("console.years.addTitle"),
    fields: [
      {
        name: "name",
        maxLength: 20,
        label: t("console.years.name"),
        value: year?.name,
        required: true,
        placeholder: "2025-2026",
        rules: [
          v.unique(
            state.schoolYears.map((y) => y.name),
            { current: year?.name },
          ),
        ],
      },
      {
        name: "start_date",
        label: t("console.years.start"),
        type: "date",
        value: year?.start_date,
        required: true,
      },
      {
        name: "end_date",
        label: t("console.years.end"),
        type: "date",
        value: year?.end_date,
        required: true,
        rules: [v.endAfterStart("start_date")],
      },
    ],
    onSubmit: async (values) => {
      const payload = {
        name: values.name.trim(),
        start_date: values.start_date,
        end_date: values.end_date,
      };
      const saved = year
        ? await data.updateSchoolYear(year.id, payload).then(() => year)
        : await data.createSchoolYear({ ...payload, is_active: false });
      markSaved("years-body", saved?.id ?? year?.id);
      showToast(t("common.saved"));
      loadYearPeriods();
    },
  });
}

document
  .getElementById("btn-add-year")
  .addEventListener("click", () => openYearForm());
