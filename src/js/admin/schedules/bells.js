// ─────────────────────────────────────────────────────────────────
//  bells.js — the bell-schedules sub-tab: the reusable time-block
//  templates and the blocks inside one of them. Split out of admin.js.
// ─────────────────────────────────────────────────────────────────
import { t } from "../../i18n.js";
import * as v from "../../validate.js";
import * as sched from "../../scheduleLogic.js";
import { state } from "../state.js";
import { data } from "../data.js";
import { escapeHtml } from "../ui/format.js";
import { showToast, openConfirm } from "../ui/feedback.js";
import { openModal } from "../ui/modal.js";
import { iconBtn, markSaved, tableRow } from "../ui/tables.js";
import { repaint } from "./tabState.js";
import { slotLabel, ensureBellBlocks } from "./helpers.js";

async function refreshBellBlocks(bellId) {
  state.bellBlocks[bellId] = await data.listBellBlocks(bellId);
  repaint();
}

export function renderBellPanel(panel) {
  const wrap = document.createElement("div");
  wrap.className = "console-panel";
  wrap.innerHTML = `
    <div class="panel-head">
      <div>
        <h2>${escapeHtml(t("console.schedules.templates.title"))}</h2>
        <p class="panel-sub">${escapeHtml(t("console.schedules.templates.subtitle"))}</p>
      </div>
    </div>`;

  const actions = document.createElement("div");
  actions.className = "panel-actions";
  const add = document.createElement("button");
  add.className = "btn btn-primary btn-sm";
  add.type = "button";
  add.id = "btn-add-bell";
  add.innerHTML = `<span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-add"></use></svg></span><span>${escapeHtml(t("console.schedules.templates.add"))}</span>`;
  add.addEventListener("click", () => openBellForm());
  actions.appendChild(add);
  wrap.querySelector(".panel-head")?.appendChild(actions);

  const scroll = document.createElement("div");
  scroll.className = "table-scroll";
  const table = document.createElement("table");
  table.className = "data-table";
  table.innerHTML = `<thead><tr>
      <th>${escapeHtml(t("console.schedules.templates.name"))}</th>
      <th>${escapeHtml(t("console.schedules.templates.blocks"))}</th>
      <th class="actions-col"></th>
    </tr></thead>`;
  table.appendChild(buildBellRows());
  scroll.appendChild(table);
  wrap.appendChild(scroll);
  panel.appendChild(wrap);

  const selected = state.bellSchedules.find((b) => b.id === state.schedBellId);
  if (selected) panel.appendChild(buildBlocksPanel(selected));
}

function buildBellRows() {
  const tbody = document.createElement("tbody");
  tbody.id = "bell-body";

  if (!state.bellSchedules.length) {
    tbody.innerHTML = `<tr><td colspan="3" class="loading-cell">${escapeHtml(t("console.schedules.templates.empty"))}</td></tr>`;
    return tbody;
  }

  state.bellSchedules.forEach((bell) => {
    const count = state.bellBlocks[bell.id]?.length;
    tbody.appendChild(
      tableRow(
        [
          escapeHtml(bell.name),
          count == null ? "—" : escapeHtml(String(count)),
        ],
        [
          iconBtn(
            "list_alt",
            t("console.schedules.templates.blocks"),
            async () => {
              state.schedBellId = bell.id;
              await ensureBellBlocks(bell.id);
              repaint();
            },
          ),
          iconBtn("edit", t("common.edit"), () => openBellForm(bell)),
          iconBtn(
            "delete",
            t("common.delete"),
            () => confirmDeleteBell(bell),
            true,
          ),
        ],
        bell.id,
      ),
    );
  });
  return tbody;
}

function confirmDeleteBell(bell) {
  openConfirm(t("console.schedules.templates.confirmDelete"), async () => {
    await data.deleteBellSchedule(bell.id);
    delete state.bellBlocks[bell.id];
    if (state.schedBellId === bell.id) state.schedBellId = null;
    if (state.schedTemplateId === bell.id) state.schedTemplateId = null;
    state.bellSchedules = await data.listBellSchedules();
    showToast(t("common.deleted"));
    repaint();
  });
}

function openBellForm(bell = null) {
  openModal({
    title: bell
      ? t("console.schedules.templates.editTitle")
      : t("console.schedules.templates.addTitle"),
    fields: [
      {
        name: "name",
        maxLength: 80,
        label: t("console.schedules.templates.name"),
        required: true,
        value: bell?.name ?? "",
        rules: [
          v.unique(
            state.bellSchedules.map((b) => b.name),
            { current: bell?.name },
          ),
        ],
      },
    ],
    onSubmit: async (values) => {
      if (bell) await data.updateBellSchedule(bell.id, { name: values.name });
      else {
        const created = await data.createBellSchedule({ name: values.name });
        state.schedBellId = created?.id ?? null;
        markSaved("bell-body", created?.id);
      }
      state.bellSchedules = await data.listBellSchedules();
      showToast(t("common.saved"));
      repaint();
    },
  });
}

/** The blocks of one bell schedule, in running order. */
function buildBlocksPanel(bell) {
  const panel = document.createElement("div");
  panel.className = "console-panel";
  panel.innerHTML = `
    <div class="panel-head">
      <div>
        <h2>${escapeHtml(bell.name)}</h2>
        <p class="panel-sub">${escapeHtml(t("console.schedules.templates.blocks"))}</p>
      </div>
    </div>`;
  const actions = document.createElement("div");
  actions.className = "panel-actions";
  const add = document.createElement("button");
  add.className = "btn btn-primary btn-sm";
  add.type = "button";
  add.id = "btn-add-block";
  add.innerHTML = `<span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-add"></use></svg></span><span>${escapeHtml(t("console.schedules.templates.addBlock"))}</span>`;
  add.addEventListener("click", () => openBlockForm(bell));
  actions.appendChild(add);
  panel.querySelector(".panel-head")?.appendChild(actions);

  const scroll = document.createElement("div");
  scroll.className = "table-scroll";
  const table = document.createElement("table");
  table.className = "data-table";
  table.innerHTML = `<thead><tr>
      <th>${escapeHtml(t("console.schedules.templates.order"))}</th>
      <th>${escapeHtml(t("console.schedules.templates.label"))}</th>
      <th>${escapeHtml(t("console.schedules.templates.kind"))}</th>
      <th>${escapeHtml(t("console.schedules.time"))}</th>
      <th class="actions-col"></th>
    </tr></thead>`;
  table.appendChild(buildBlockRows(bell));
  scroll.appendChild(table);
  panel.appendChild(scroll);
  return panel;
}

function buildBlockRows(bell) {
  const blocks = state.bellBlocks[bell.id] ?? [];
  const tbody = document.createElement("tbody");
  tbody.id = "bell-blocks-body";

  if (!blocks.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="loading-cell">${escapeHtml(t("console.schedules.templates.blocksEmpty"))}</td></tr>`;
    return tbody;
  }

  blocks.forEach((block) => {
    tbody.appendChild(
      tableRow(
        [
          escapeHtml(String(block.block_order)),
          escapeHtml(block.label),
          escapeHtml(
            t(
              block.kind === "break"
                ? "console.schedules.templates.kindBreak"
                : "console.schedules.templates.kindClass",
            ),
          ),
          escapeHtml(slotLabel(block.start_time, block.end_time)),
        ],
        [
          iconBtn("edit", t("common.edit"), () => openBlockForm(bell, block)),
          iconBtn(
            "delete",
            t("common.delete"),
            () =>
              openConfirm(
                t("console.schedules.templates.confirmDeleteBlock"),
                async () => {
                  await data.deleteBellBlock(block.id);
                  showToast(t("common.deleted"));
                  await refreshBellBlocks(bell.id);
                },
              ),
            true,
          ),
        ],
        block.id,
      ),
    );
  });
  return tbody;
}

function openBlockForm(bell, block = null) {
  const blocks = state.bellBlocks[bell.id] ?? [];
  const nextOrder = blocks.length
    ? Math.max(...blocks.map((b) => Number(b.block_order) || 0)) + 1
    : 1;

  openModal({
    title: block
      ? t("console.schedules.templates.editBlockTitle")
      : t("console.schedules.templates.addBlockTitle"),
    fields: [
      {
        name: "label",
        label: t("console.schedules.templates.label"),
        required: true,
        value: block?.label ?? "",
      },
      {
        name: "kind",
        label: t("console.schedules.templates.kind"),
        type: "select",
        required: true,
        value: block?.kind ?? "class",
        options: [
          { value: "class", label: t("console.schedules.templates.kindClass") },
          { value: "break", label: t("console.schedules.templates.kindBreak") },
        ],
      },
      {
        name: "block_order",
        label: t("console.schedules.templates.order"),
        type: "number",
        required: true,
        min: 1,
        value: block?.block_order ?? nextOrder,
        rules: [v.integer(), v.min(1)],
      },
      {
        name: "start_time",
        label: t("console.schedules.start"),
        type: "time",
        required: true,
        value: sched.normalizeTime(block?.start_time),
      },
      {
        name: "end_time",
        label: t("console.schedules.end"),
        type: "time",
        required: true,
        value: sched.normalizeTime(block?.end_time),
        rules: [v.endAfterStart("start_time")],
      },
    ],
    // Validate the block against the template it is joining, so an overlap
    // or a repeated order is caught before the unique constraint fires.
    validate: (values) => {
      const others = blocks.filter((b) => b.id !== block?.id);
      const errors = sched.validateBlocks([...others, values]);
      const problem = errors[others.length];
      if (problem === "overlap")
        return { start_time: t("console.schedules.templates.overlap") };
      if (problem === "duplicateOrder")
        return { block_order: t("console.schedules.templates.duplicateOrder") };
      return {};
    },
    onSubmit: async (values) => {
      const row = {
        bell_schedule_id: bell.id,
        label: values.label,
        kind: values.kind,
        block_order: Number(values.block_order),
        start_time: values.start_time,
        end_time: values.end_time,
      };
      if (block) await data.updateBellBlock(block.id, row);
      else markSaved("bell-blocks-body", (await data.createBellBlock(row))?.id);
      showToast(t("common.saved"));
      await refreshBellBlocks(bell.id);
    },
  });
}
