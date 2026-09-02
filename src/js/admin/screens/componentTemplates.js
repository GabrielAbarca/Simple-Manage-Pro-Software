// ─────────────────────────────────────────────────────────────────
//  componentTemplates.js — MEP grade-component schemes (cotidiano,
//  tareas, pruebas, …). Split out of admin.js.
//
//  Admin-owned evaluative-component schemes. A teacher applies one to
//  a gradebook, copying its items into that gradebook's
//  grade_categories. Weights are validated to total 100% with the same
//  helpers and rule that grading periods use — warned, not blocked, so
//  a scheme can be built up one component at a time.
// ─────────────────────────────────────────────────────────────────
import { t } from "../../i18n.js";
import * as v from "../../validate.js";
import { totalWeight, weightStatus } from "../../gradingPeriods.js";
import { state } from "../state.js";
import { data } from "../data.js";
import { escapeHtml } from "../ui/format.js";
import { showToast, errorText, openConfirm } from "../ui/feedback.js";
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
import { openTemplateItems } from "./templateItems.js";

const TEMPLATES_COLS = 5;

export async function loadComponentTemplates() {
  renderMessageRow("templates-body", TEMPLATES_COLS, t("common.loading"));
  try {
    const templates = await data.listComponentTemplates();
    const items = await Promise.all(
      templates.map((tpl) => data.listTemplateItems(tpl.id)),
    );
    state.componentTemplates = templates;
    state.templateItems = {};
    templates.forEach((tpl, i) => {
      state.templateItems[tpl.id] = items[i];
    });
    renderComponentTemplates(templates);
  } catch (err) {
    console.error("loadComponentTemplates:", err);
    renderErrorRow("templates-body", TEMPLATES_COLS, loadComponentTemplates);
  }
}

/** "School-wide", or the subject a subject-scoped scheme belongs to. */
function templateScopeLabel(tpl) {
  if (!tpl.subject_id) return t("console.components.schoolWide");
  const subj = state.subjects.find((s) => s.id === tpl.subject_id);
  return subj ? subj.name : t("console.components.schoolWide");
}

/** A weight-total badge (green at exactly 100%, warning otherwise). */
export function weightBadgeHtml(items) {
  if (!items.length) return "—";
  const total = totalWeight(items);
  const ok = weightStatus(total, items.length) === "ok";
  return `<span class="badge ${ok ? "badge-success" : "badge-warning"}">${escapeHtml(
    t("console.components.totalWeight", { total }),
  )}</span>`;
}

function renderComponentTemplates(list) {
  const tbody = document.getElementById("templates-body");
  if (!tbody) return;
  tbody.innerHTML = "";
  if (!list.length) {
    renderEmptyRow(
      "templates-body",
      TEMPLATES_COLS,
      t("console.components.empty"),
    );
    return;
  }
  list.forEach((tpl) => {
    const items = state.templateItems[tpl.id] ?? [];
    const nameCell =
      escapeHtml(tpl.name) +
      (tpl.is_default
        ? ` <span class="badge badge-success">${escapeHtml(t("console.components.default"))}</span>`
        : "");
    const componentsCell = items.length
      ? escapeHtml(items.map((i) => i.name).join(", "))
      : `<span class="muted">${escapeHtml(t("console.components.noComponents"))}</span>`;
    tbody.appendChild(
      tableRow(
        [
          nameCell,
          escapeHtml(templateScopeLabel(tpl)),
          componentsCell,
          weightBadgeHtml(items),
        ],
        [
          iconBtn("tune", t("console.components.editItems"), () =>
            openTemplateItems(tpl, { onChange: loadComponentTemplates }),
          ),
          iconBtn("grade", t("console.components.setDefault"), () =>
            setTemplateDefault(tpl),
          ),
          iconBtn("edit", t("common.edit"), () => openTemplateForm(tpl)),
          iconBtn("delete", t("common.delete"), () => confirmDelete(tpl), true),
        ],
        tpl.id,
      ),
    );
  });
  applySavedFlash("templates-body");
}

function confirmDelete(tpl) {
  openConfirm(
    t("console.components.confirmDelete", { name: tpl.name }),
    async () => {
      await data.deleteComponentTemplate(tpl.id);
      showToast(t("common.deleted"));
      loadComponentTemplates();
    },
  );
}

async function setTemplateDefault(tpl) {
  if (tpl.is_default) return;
  try {
    const previouslyDefault = state.componentTemplates
      .filter((x) => x.is_default)
      .map((x) => x.id);
    await data.setDefaultTemplate(tpl.id, previouslyDefault);
    markSaved("templates-body", tpl.id);
    showToast(t("console.components.defaultSet", { name: tpl.name }));
    loadComponentTemplates();
  } catch (err) {
    showToast(errorText(err), "error");
  }
}

export function openTemplateForm(tpl = null) {
  openModal({
    title: tpl
      ? t("console.components.editTitle")
      : t("console.components.addTitle"),
    fields: [
      {
        name: "name",
        maxLength: 100,
        label: t("console.components.name"),
        value: tpl?.name,
        required: true,
        rules: [v.required()],
      },
      {
        name: "subject_id",
        type: "select",
        label: t("console.components.scope"),
        value: tpl?.subject_id ?? "",
        help: t("console.components.scopeHelp"),
        options: state.subjects.map((s) => ({ value: s.id, label: s.name })),
      },
    ],
    onSubmit: async (values) => {
      const payload = {
        name: values.name.trim(),
        subject_id: values.subject_id ? Number(values.subject_id) : null,
      };
      let id = tpl?.id;
      if (tpl) {
        await data.updateComponentTemplate(tpl.id, payload);
      } else {
        const created = await data.createComponentTemplate({
          ...payload,
          is_default: false,
        });
        id = created?.id;
      }
      markSaved("templates-body", id);
      showToast(t("common.saved"));
      loadComponentTemplates();
    },
  });
}

document
  .getElementById("btn-add-template")
  ?.addEventListener("click", () => openTemplateForm());
