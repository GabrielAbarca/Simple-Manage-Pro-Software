// ─────────────────────────────────────────────────────────────────
//  rooms.js — the rooms table on the Grades & Sections screen.
//  Split out of admin.js.
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
import { ROOM_TYPES } from "../domain/enums.js";

export async function loadRooms() {
  renderMessageRow("rooms-body", 4, t("common.loading"));
  try {
    state.rooms = await data.listRooms();
    const tbody = document.getElementById("rooms-body");
    tbody.innerHTML = "";
    if (!state.rooms.length) {
      renderEmptyRow("rooms-body", 4, t("console.rooms.empty"));
      return;
    }
    state.rooms.forEach((r) => {
      tbody.appendChild(
        tableRow(
          [
            escapeHtml(r.name),
            r.capacity != null ? escapeHtml(r.capacity) : "—",
            `<span class="badge badge-neutral">${escapeHtml(t(`console.rooms.types.${r.type ?? "classroom"}`))}</span>`,
          ],
          [
            iconBtn("edit", t("common.edit"), () => openRoomForm(r)),
            iconBtn("delete", t("common.delete"), () => confirmDelete(r), true),
          ],
          r.id,
        ),
      );
    });
    applySavedFlash("rooms-body");
  } catch (err) {
    console.error("loadRooms:", err);
    renderErrorRow("rooms-body", 4, loadRooms);
  }
}

function confirmDelete(room) {
  openConfirm(
    t("console.rooms.confirmDelete", { name: room.name }),
    async () => {
      await data.deleteRoom(room.id);
      showToast(t("common.deleted"));
      loadRooms();
    },
  );
}

export function openRoomForm(room = null) {
  openModal({
    title: room ? t("console.rooms.editTitle") : t("console.rooms.addTitle"),
    fields: [
      {
        name: "name",
        maxLength: 50,
        label: t("console.rooms.name"),
        value: room?.name,
        required: true,
        rules: [
          v.unique(
            state.rooms.map((r) => r.name),
            { current: room?.name },
          ),
        ],
      },
      {
        name: "capacity",
        label: t("console.rooms.capacity"),
        type: "number",
        value: room?.capacity,
        min: 1,
        rules: [v.integer(), v.min(1)],
      },
      {
        name: "type",
        label: t("console.rooms.type"),
        type: "select",
        value: room?.type ?? "classroom",
        required: true,
        options: ROOM_TYPES.map((type) => ({
          value: type,
          label: t(`console.rooms.types.${type}`),
        })),
      },
    ],
    onSubmit: async (values) => {
      const payload = {
        name: values.name.trim(),
        capacity: num(values.capacity),
        type: values.type,
      };
      const saved = room
        ? await data.updateRoom(room.id, payload).then(() => room)
        : await data.createRoom(payload);
      markSaved("rooms-body", saved?.id ?? room?.id);
      showToast(t("common.saved"));
      loadRooms();
    },
  });
}

document
  .getElementById("btn-add-room")
  .addEventListener("click", () => openRoomForm());
