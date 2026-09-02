// ─────────────────────────────────────────────────────────────────
//  periods.js — the grading-periods half of the Year & Periods screen.
//  Split out of admin.js.
//
//  A year is only correctly weighted at exactly 100%. Going over is
//  blocked inline; falling short only warns, so a director can build
//  the year up one period at a time.
// ─────────────────────────────────────────────────────────────────
import { t } from "../../i18n.js";
import * as v from "../../validate.js";
import {
  TARGET_WEIGHT,
  remainingWeight,
  totalWeight,
  weightStatus,
} from "../../gradingPeriods.js";
import { state } from "../state.js";
import { data } from "../data.js";
import { escapeHtml, num, fmtDate } from "../ui/format.js";
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

export async function loadPeriods() {
  const label = document.getElementById("periods-year-label");
  const addBtn = /** @type {HTMLButtonElement} */ (
    document.getElementById("btn-add-period")
  );
  if (!state.activeYear) {
    label.textContent = t("console.periods.noYear");
    addBtn.disabled = true;
    renderWeightTotal([]);
    renderEmptyRow("periods-body", 6, t("console.periods.noYear"));
    return;
  }
  addBtn.disabled = false;
  label.textContent = state.activeYear.name;
  renderMessageRow("periods-body", 6, t("common.loading"));
  try {
    const periods = await data.listPeriods(state.activeYear.id);
    state.periods = periods;
    renderPeriods(periods);
    renderWeightTotal(periods);
  } catch (err) {
    console.error("loadPeriods:", err);
    renderErrorRow("periods-body", 6, loadPeriods);
  }
}

/**
 * Running weight total for the year on screen. A year is only correctly
 * weighted at exactly 100%, so anything else is badged as a warning — the
 * director can see the shortfall while building the periods up one at a time.
 */
function renderWeightTotal(periods) {
  const el = document.getElementById("periods-weight-total");
  if (!el) return;
  if (!periods.length) {
    el.hidden = true;
    return;
  }
  const total = totalWeight(periods);
  const status = weightStatus(total, periods.length);
  el.hidden = false;
  el.textContent = t("console.periods.totalWeight", { total });
  el.classList.remove("badge-neutral"); // the markup's placeholder styling
  el.classList.toggle("badge-success", status === "ok");
  el.classList.toggle("badge-warning", status !== "ok");
  el.title =
    status === "ok" ? "" : t("console.periods.weightWarning", { total });
}

function renderPeriods(periods) {
  const tbody = document.getElementById("periods-body");
  tbody.innerHTML = "";
  if (!periods.length) {
    renderEmptyRow("periods-body", 6, t("console.periods.empty"));
    return;
  }
  periods.forEach((p) => {
    const actions = [
      iconBtn("edit", t("common.edit"), () => openPeriodForm(p)),
      iconBtn(
        "delete",
        t("common.delete"),
        () =>
          openConfirm(
            t("console.periods.confirmDelete", { name: p.name }),
            async () => {
              await data.deletePeriod(p.id);
              showToast(t("console.periods.deleted"));
              loadPeriods();
            },
          ),
        true,
      ),
    ];
    tbody.appendChild(
      tableRow(
        [
          escapeHtml(p.period_order),
          escapeHtml(p.name),
          fmtDate(p.start_date),
          fmtDate(p.end_date),
          p.weight != null ? `${escapeHtml(p.weight)}%` : "—",
        ],
        actions,
        p.id,
      ),
    );
  });
  applySavedFlash("periods-body");
}

/**
 * A period belongs to the active year, so its dates are bounded by that
 * year's range — both as input constraints and as a validation rule (the
 * matching DB trigger is the backstop for anything bypassing this form).
 */
function yearDateBounds() {
  const year = state.activeYear;
  const bounded = year?.start_date && year?.end_date;
  const withinYear = bounded
    ? [
        v.dateWithin(year.start_date, year.end_date, {
          start: fmtDate(year.start_date),
          end: fmtDate(year.end_date),
        }),
      ]
    : [];
  return {
    withinYear,
    dateRange: {
      min: year?.start_date,
      max: year?.end_date,
      help: bounded
        ? t("validation.dateWithin", {
            start: fmtDate(year.start_date),
            end: fmtDate(year.end_date),
          })
        : undefined,
    },
  };
}

export function openPeriodForm(period = null) {
  const { withinYear, dateRange } = yearDateBounds();

  openModal({
    title: period
      ? t("console.periods.editTitle")
      : t("console.periods.addTitle"),
    fields: [
      {
        name: "name",
        maxLength: 50,
        label: t("console.periods.name"),
        value: period?.name,
        required: true,
        placeholder: t("console.periods.namePlaceholder"),
      },
      {
        name: "period_order",
        label: t("console.periods.order"),
        type: "number",
        value: period?.period_order,
        required: true,
        min: 1,
        step: "1",
        rules: [
          v.integer(),
          v.min(1),
          v.unique(
            state.periods.map((p) => p.period_order),
            { current: period?.period_order },
          ),
        ],
      },
      {
        name: "start_date",
        label: t("console.periods.start"),
        type: "date",
        value: period?.start_date,
        required: true,
        ...dateRange,
        rules: withinYear,
      },
      {
        name: "end_date",
        label: t("console.periods.end"),
        type: "date",
        value: period?.end_date,
        required: true,
        ...dateRange,
        rules: [...withinYear, v.endAfterStart("start_date")],
      },
      {
        // A new period defaults to whatever weight is still unclaimed, so
        // building a year lands on 100% without arithmetic: 50/50 for Costa
        // Rica's two periodos, 33.33/33.33/33.34 for three trimestres. A fixed
        // default could only ever be right for one period count.
        name: "weight",
        label: t("console.periods.weight"),
        type: "number",
        value:
          period?.weight ??
          remainingWeight(state.periods, { excludeId: period?.id }),
        min: 0,
        max: 100,
        step: "0.01",
        rules: [v.percent()],
      },
    ],
    // Whole-form rule: the year's weights may never exceed 100% in total.
    // Falling short is allowed while the year is still being built (it warns
    // on save instead). Per-field rules above cover everything else.
    validate: (values) => {
      const prospective = totalWeight(state.periods, {
        excludeId: period?.id ?? null,
        extraWeight: num(values.weight),
      });
      return prospective > TARGET_WEIGHT
        ? { weight: t("console.periods.weightOver", { total: prospective }) }
        : {};
    },
    onSubmit: async (values) => {
      const payload = {
        name: values.name.trim(),
        period_order: num(values.period_order),
        start_date: values.start_date,
        end_date: values.end_date,
        weight: num(values.weight),
      };
      const saved = period
        ? await data.updatePeriod(period.id, payload).then(() => period)
        : await data.createPeriod({
            ...payload,
            school_year_id: state.activeYear.id,
          });
      markSaved("periods-body", saved?.id ?? period?.id);
      showToast(t("common.saved"));

      // Re-read first, then judge the year off the stored rows rather than the
      // submitted value, and say so loudly when it still isn't 100%.
      await loadPeriods();
      const total = totalWeight(state.periods);
      if (weightStatus(total, state.periods.length) !== "ok") {
        showToast(t("console.periods.weightWarning", { total }), "error");
      }
    },
  });
}

document
  .getElementById("btn-add-period")
  .addEventListener("click", () => openPeriodForm());
