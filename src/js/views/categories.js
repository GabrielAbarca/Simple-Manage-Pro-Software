// ─────────────────────────────────────────────────────────────────
//  categories.js — grade categories modal (item 8) and applying an
//  admin-owned MEP component scheme to the current gradebook.
// ─────────────────────────────────────────────────────────────────
import { registerDialog } from "../dialog.js";
import { t } from "../i18n.js";
import { db } from "../teacherData/index.js";
import { state } from "../teacherState.js";
import { openModal } from "../teacherModal.js";
import { showToast, openConfirm, errorText } from "../teacherFeedback.js";
import { makeActionBtn, escapeHtml } from "../teacherTableHelpers.js";
import { getGradebookState, loadGradebook } from "./gradebook.js";

// ── Grade categories modal (item 8) ────────────────────────────
const categoriesOverlay = document.getElementById("categories-overlay");
const categoriesTitle = document.getElementById("categories-title");
const categoriesBody = document.getElementById("categories-body");
const categoriesTotal = document.getElementById("categories-total");

document
  .getElementById("categories-close")
  .addEventListener("click", closeCategoriesModal);
document
  .getElementById("categories-done")
  .addEventListener("click", closeCategoriesModal);
document
  .getElementById("categories-add")
  .addEventListener("click", () => openCategoryForm());
document
  .getElementById("categories-apply-template")
  ?.addEventListener("click", () => openApplyTemplate());

export function openCategoriesModal() {
  if (!state.currentClass) return;
  categoriesTitle.textContent = t("admin.categories.title", {
    subject: state.currentClass.subjectName,
    class: state.currentClass.className,
  });
  renderCategories();
  categoriesOverlay.classList.add("active");
}

function closeCategoriesModal() {
  categoriesOverlay.classList.remove("active");
}

function renderCategories() {
  const cats = getGradebookState()?.categories ?? [];
  if (!cats.length) {
    categoriesBody.innerHTML = `<p class="drawer-muted">${t("admin.categories.empty")}</p>`;
    categoriesTotal.textContent = "";
    return;
  }

  categoriesBody.innerHTML = "";
  cats.forEach((c) => {
    const item = document.createElement("div");
    item.className = "manage-item";
    const info = document.createElement("div");
    info.className = "manage-item-info";
    info.innerHTML = `<b>${escapeHtml(c.name)}</b><span class="manage-item-meta">${t("admin.categories.weight", { weight: Number(c.weight) })}</span>`;
    const actions = document.createElement("div");
    actions.className = "manage-item-actions";
    actions.appendChild(
      makeActionBtn("edit", t("common.edit"), () => openCategoryForm(c)),
    );
    actions.appendChild(
      makeActionBtn(
        "delete",
        t("common.delete"),
        () => confirmDeleteCategory(c),
        true,
      ),
    );
    item.append(info, actions);
    categoriesBody.appendChild(item);
  });

  const total = cats.reduce((s, c) => s + Number(c.weight || 0), 0);
  const off = Math.round(total * 100) / 100 !== 100;
  categoriesTotal.innerHTML = `${t("admin.categories.total")}<b class="${off ? "score-mid" : "score-high"}">${total}%</b>${
    off ? t("admin.categories.totalOff") : ""
  }`;
}

function openCategoryForm(category = null) {
  const editing = !!category;
  openModal({
    title: editing
      ? t("admin.categories.editTitle")
      : t("admin.categories.addTitle"),
    submitLabel: editing ? t("common.save") : t("admin.categories.add"),
    fields: [
      {
        name: "name",
        label: t("admin.form.name"),
        type: "text",
        required: true,
        value: category?.name ?? "",
        placeholder: t("admin.categories.namePlaceholder"),
      },
      {
        name: "weight",
        label: t("admin.form.weightPct"),
        type: "number",
        required: true,
        value: category?.weight ?? "",
        min: 0,
        step: "0.01",
      },
    ],
    onSubmit: async (formData) => {
      const payload = {
        name: formData.name.trim(),
        weight: Number(formData.weight),
      };
      if (editing) {
        await db.updateCategory(category.id, payload);
      } else {
        await db.insertCategory({
          ...payload,
          class_subject_teacher_id: state.currentClass.cstId,
        });
      }
      showToast(
        editing
          ? t("admin.toast.categoryUpdated", { name: payload.name })
          : t("admin.toast.categoryAdded", { name: payload.name }),
      );
      await refreshAfterCategoryChange();
    },
  });
}

function confirmDeleteCategory(category) {
  openConfirm(
    t("admin.confirm.deleteCategory", { name: category.name }),
    async () => {
      await db.deleteCategory(category.id);
      showToast(t("admin.toast.categoryDeleted", { name: category.name }));
      await refreshAfterCategoryChange();
    },
  );
}

// Reload the gradebook (refetches categories + grades, since weighting changed)
// and re-render the categories list if it's still open.
async function refreshAfterCategoryChange() {
  await loadGradebook();
  if (categoriesOverlay.classList.contains("active")) renderCategories();
}

// ── Apply an admin-owned MEP scheme to this gradebook ──────────
// The admin defines reusable component schemes (console → Subjects →
// Grade components); here a teacher copies one into this gradebook's
// categories instead of retyping cotidiano/tareas/pruebas by hand. Only
// components whose name isn't already present are added, so re-applying or
// applying two overlapping schemes never duplicates a category.
async function openApplyTemplate() {
  if (!state.currentClass) return;
  let templates;
  try {
    templates = await db.fetchComponentTemplates();
  } catch (err) {
    showToast(errorText(err), "error");
    return;
  }
  const relevant = (templates ?? []).filter(
    (tpl) =>
      tpl.subject_id == null || tpl.subject_id === state.currentClass.subjectId,
  );
  if (!relevant.length) {
    showToast(t("admin.categories.noTemplates"));
    return;
  }
  const def = relevant.find((tpl) => tpl.is_default);
  openModal({
    title: t("admin.categories.applyTitle"),
    submitLabel: t("admin.categories.apply"),
    fields: [
      {
        name: "templateId",
        type: "select",
        label: t("admin.categories.pickTemplate"),
        required: true,
        value: def?.id ?? "",
        options: relevant.map((tpl) => ({
          value: tpl.id,
          label: tpl.subject_id
            ? tpl.name
            : `${tpl.name} · ${t("admin.categories.schoolWide")}`,
        })),
      },
    ],
    onSubmit: async (formData) => {
      await applyTemplate(Number(formData.templateId));
    },
  });
}

async function applyTemplate(templateId) {
  const items = await db.fetchTemplateItems(templateId);
  const existing = new Set(
    (getGradebookState()?.categories ?? []).map((c) =>
      String(c.name).trim().toLowerCase(),
    ),
  );
  let added = 0;
  for (const it of items ?? []) {
    if (existing.has(String(it.name).trim().toLowerCase())) continue;
    await db.insertCategory({
      name: it.name,
      weight: Number(it.weight),
      class_subject_teacher_id: state.currentClass.cstId,
    });
    added += 1;
  }
  showToast(
    added
      ? t("admin.categories.applied", { count: added })
      : t("admin.categories.alreadyApplied"),
  );
  await refreshAfterCategoryChange();
}

registerDialog(categoriesOverlay, { close: closeCategoriesModal });
