// ─────────────────────────────────────────────────────────────────
//  templateItems.js — the overlay that edits one grade-component
//  scheme's components. Split out of admin.js.
//
//  The owning table passes an `onChange` callback rather than being
//  imported back: this module never has to know which screen opened
//  it, and the two stay free of a circular import.
// ─────────────────────────────────────────────────────────────────
import { t } from "../../i18n.js";
import * as v from "../../validate.js";
import { state } from "../state.js";
import { data } from "../data.js";
import { escapeHtml } from "../ui/format.js";
import { showToast, errorText, openConfirm } from "../ui/feedback.js";
import { openModal } from "../ui/modal.js";
import { weightBadgeHtml } from "./componentTemplates.js";

/** The MEP-standard components, as a starting scheme an admin can adjust. */
const MEP_PRESET = [
  { name: "Cotidiano", weight: 35 },
  { name: "Pruebas", weight: 40 },
  { name: "Tareas", weight: 10 },
  { name: "Proyecto", weight: 10 },
  { name: "Asistencia", weight: 5 },
];

const templateItemsOverlay = document.getElementById("template-items-overlay");

/** @type {any} the scheme whose components the overlay is editing */
let currentTemplate = null;
/** Refreshes the owning table after a component write. */
let onItemsChanged = () => {};

function closeTemplateItems() {
  templateItemsOverlay?.classList.remove("active");
  currentTemplate = null;
}
document
  .getElementById("template-items-close")
  ?.addEventListener("click", closeTemplateItems);

/**
 * @param {any} tpl the scheme to edit
 * @param {{ onChange?: () => any }} [opts] re-renders the owning table
 */
export async function openTemplateItems(tpl, opts = {}) {
  currentTemplate = tpl;
  onItemsChanged = opts.onChange ?? (() => {});
  const titleEl = document.getElementById("template-items-title");
  if (titleEl)
    titleEl.textContent = t("console.components.itemsTitle", {
      name: tpl.name,
    });
  await refreshTemplateItems();
  templateItemsOverlay?.classList.add("active");
}

async function refreshTemplateItems() {
  if (!currentTemplate) return;
  const items = await data.listTemplateItems(currentTemplate.id);
  state.templateItems[currentTemplate.id] = items;
  renderTemplateItems(items);
}

function renderTemplateItems(items) {
  const body = document.getElementById("template-items-body");
  const footer = document.getElementById("template-items-footer");
  if (!body || !footer) return;

  const rows = items.length
    ? items
        .map(
          (it) => `
        <tr>
          <td>${escapeHtml(it.name)}</td>
          <td>${escapeHtml(t("console.components.percent", { value: it.weight }))}</td>
          <td class="actions-col">
            <button class="btn-icon" data-edit="${it.id}" title="${escapeHtml(t("common.edit"))}"><span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-edit"></use></svg></span></button>
            <button class="btn-icon danger" data-del="${it.id}" title="${escapeHtml(t("common.delete"))}"><span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-delete"></use></svg></span></button>
          </td>
        </tr>`,
        )
        .join("")
    : `<tr><td colspan="3" class="loading-cell">${escapeHtml(t("console.components.noComponents"))}</td></tr>`;

  body.innerHTML = `
    <p class="panel-sub">${escapeHtml(t("console.components.itemsHelp"))} ${weightBadgeHtml(items)}</p>
    <div class="table-scroll">
      <table class="data-table">
        <thead><tr>
          <th>${escapeHtml(t("console.components.componentName"))}</th>
          <th>${escapeHtml(t("console.components.weight"))}</th>
          <th class="actions-col"></th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;

  renderItemsFooter(footer);
  bindItemRowActions(body, items);
}

function renderItemsFooter(footer) {
  footer.innerHTML = "";
  const preset = document.createElement("button");
  preset.type = "button";
  preset.className = "btn btn-ghost";
  preset.textContent = t("console.components.loadPreset");
  preset.addEventListener("click", loadMepPreset);
  const add = document.createElement("button");
  add.type = "button";
  add.className = "btn btn-primary";
  add.textContent = t("console.components.addComponent");
  add.addEventListener("click", () => openTemplateItemForm());
  footer.append(preset, add);
}

function bindItemRowActions(body, items) {
  body.querySelectorAll("button[data-edit]").forEach((btn) => {
    const id = Number(btn.getAttribute("data-edit"));
    const item = items.find((x) => x.id === id);
    btn.addEventListener("click", () => openTemplateItemForm(item));
  });
  body.querySelectorAll("button[data-del]").forEach((btn) => {
    const id = Number(btn.getAttribute("data-del"));
    const item = items.find((x) => x.id === id);
    btn.addEventListener("click", () =>
      openConfirm(
        t("console.components.confirmDeleteItem", { name: item?.name ?? "" }),
        async () => {
          await data.deleteTemplateItem(id);
          await refreshTemplateItems();
          onItemsChanged();
        },
      ),
    );
  });
}

function openTemplateItemForm(item = null) {
  if (!currentTemplate) return;
  openModal({
    title: item
      ? t("console.components.editComponent")
      : t("console.components.addComponent"),
    fields: [
      {
        name: "name",
        maxLength: 100,
        label: t("console.components.componentName"),
        value: item?.name,
        required: true,
        rules: [v.required()],
      },
      {
        name: "weight",
        type: "number",
        step: "0.01",
        label: t("console.components.weight"),
        value: item?.weight ?? "",
        required: true,
        rules: [v.required(), v.percent()],
      },
    ],
    onSubmit: async (values) => {
      const items = state.templateItems[currentTemplate.id] ?? [];
      const payload = {
        name: values.name.trim(),
        weight: Number(values.weight),
      };
      if (item) {
        await data.updateTemplateItem(item.id, payload);
      } else {
        await data.createTemplateItem({
          ...payload,
          template_id: currentTemplate.id,
          item_order: nextItemOrder(items),
        });
      }
      showToast(t("common.saved"));
      await refreshTemplateItems();
      onItemsChanged();
    },
  });
}

function nextItemOrder(items) {
  return items.reduce((m, x) => Math.max(m, x.item_order ?? 0), 0) + 1;
}

/** Fill the scheme with the MEP standard components, skipping ones present. */
async function loadMepPreset() {
  if (!currentTemplate) return;
  try {
    const items = state.templateItems[currentTemplate.id] ?? [];
    const existing = new Set(
      items.map((x) => String(x.name).trim().toLowerCase()),
    );
    let order = items.reduce((m, x) => Math.max(m, x.item_order ?? 0), 0);
    for (const c of MEP_PRESET) {
      if (existing.has(c.name.toLowerCase())) continue;
      order += 1;
      await data.createTemplateItem({
        template_id: currentTemplate.id,
        name: c.name,
        weight: c.weight,
        item_order: order,
      });
    }
    showToast(t("console.components.presetLoaded"));
    await refreshTemplateItems();
    onItemsChanged();
  } catch (err) {
    showToast(errorText(err), "error");
  }
}
