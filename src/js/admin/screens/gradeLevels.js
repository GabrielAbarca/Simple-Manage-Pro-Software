// ─────────────────────────────────────────────────────────────────
//  gradeLevels.js — the grade-levels table on the Grades & Sections
//  screen. Split out of admin.js.
// ─────────────────────────────────────────────────────────────────
import { t } from "../../i18n.js";
import * as v from "../../validate.js";
import { state } from "../state.js";
import { data } from "../data.js";
import { escapeHtml, num } from "../ui/format.js";
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

export async function loadGradeLevels() {
  renderMessageRow("grades-body", 3, t("common.loading"));
  try {
    state.gradeLevels = await data.listGradeLevels();
    const tbody = document.getElementById("grades-body");
    tbody.innerHTML = "";
    if (!state.gradeLevels.length) {
      renderEmptyRow("grades-body", 3, t("console.grades.empty"));
      return;
    }
    state.gradeLevels.forEach((g) => {
      tbody.appendChild(
        tableRow(
          [escapeHtml(g.numeric_level), escapeHtml(g.name)],
          [
            iconBtn("edit", t("common.edit"), () => openGradeForm(g)),
            iconBtn("delete", t("common.delete"), () => confirmDelete(g), true),
          ],
          g.id,
        ),
      );
    });
    applySavedFlash("grades-body");
  } catch (err) {
    console.error("loadGradeLevels:", err);
    renderErrorRow("grades-body", 3, loadGradeLevels);
  }
}

function confirmDelete(grade) {
  openConfirm(
    t("console.grades.confirmDelete", { name: grade.name }),
    async () => {
      await data.deleteGradeLevel(grade.id);
      showToast(t("common.deleted"));
      loadGradeLevels();
    },
  );
}

export function openGradeForm(grade = null) {
  openModal({
    title: grade ? t("console.grades.editTitle") : t("console.grades.addTitle"),
    fields: [
      {
        name: "numeric_level",
        label: t("console.grades.level"),
        type: "number",
        value: grade?.numeric_level,
        required: true,
        min: 1,
        rules: [
          v.integer(),
          v.min(1),
          v.unique(
            state.gradeLevels.map((g) => g.numeric_level),
            { current: grade?.numeric_level },
          ),
        ],
      },
      {
        name: "name",
        maxLength: 50,
        label: t("console.grades.name"),
        value: grade?.name,
        required: true,
        placeholder: t("console.grades.namePlaceholder"),
        rules: [
          v.unique(
            state.gradeLevels.map((g) => g.name),
            { current: grade?.name },
          ),
        ],
      },
    ],
    onSubmit: async (values) => {
      const payload = {
        numeric_level: num(values.numeric_level),
        name: values.name.trim(),
      };
      const saved = grade
        ? await data.updateGradeLevel(grade.id, payload).then(() => grade)
        : await data.createGradeLevel(payload);
      markSaved("grades-body", saved?.id ?? grade?.id);
      showToast(t("common.saved"));
      loadGradeLevels();
    },
  });
}

document
  .getElementById("btn-add-grade")
  .addEventListener("click", () => openGradeForm());
