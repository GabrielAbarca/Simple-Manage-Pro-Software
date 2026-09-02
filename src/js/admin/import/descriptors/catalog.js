// ─────────────────────────────────────────────────────────────────
//  catalog.js — CSV import descriptors for the catalog tables the
//  timetable is built from. Split out of admin.js.
// ─────────────────────────────────────────────────────────────────
import { t } from "../../../i18n.js";
import { state } from "../../state.js";
import { data } from "../../data.js";
import { ROOM_TYPES, coerceInt, coerceEnum } from "../../domain/enums.js";
import { ensureGradeLevels, ensureRooms } from "../../domain/references.js";
import { loadSubjects } from "../../screens/subjects.js";
import { loadGradeLevels } from "../../screens/gradeLevels.js";
import { loadRooms } from "../../screens/rooms.js";
import { REQ } from "./messages.js";

export const subjects = {
  table: "subjects",
  titleKey: "console.import.entity.subjects",
  reload: () => loadSubjects(),
  uniqueFields: ["name", "code"],
  existing: () => state.subjects,
  fields: [
    {
      key: "name",
      labelKey: "console.subjects.name",
      required: true,
      aliases: ["name", "nombre", "subject", "materia"],
    },
    {
      key: "code",
      labelKey: "console.subjects.code",
      aliases: ["code", "codigo", "código", "abbr"],
    },
    {
      key: "color",
      labelKey: "console.subjects.color",
      aliases: ["color", "colour"],
    },
    {
      key: "description",
      labelKey: "console.subjects.description",
      aliases: ["description", "descripcion", "descripción"],
    },
  ],
  async prepare() {
    if (!state.subjects.length) state.subjects = await data.listSubjects();
    return { ok: true, ctx: {} };
  },
  resolve(get) {
    const name = get("name");
    if (!name) return { error: REQ("console.subjects.name") };
    const color = get("color");
    return {
      payload: {
        name,
        code: get("code") || null,
        color: /^#?[0-9a-fA-F]{6}$/.test(color)
          ? color.startsWith("#")
            ? color
            : `#${color}`
          : null,
        description: get("description") || null,
      },
    };
  },
  previewCols: [
    { labelKey: "console.subjects.name", get: (p) => p.name },
    { labelKey: "console.subjects.code", get: (p) => p.code ?? "—" },
  ],
};

export const gradeLevels = {
  table: "grade_levels",
  titleKey: "console.import.entity.gradeLevels",
  reload: () => loadGradeLevels(),
  uniqueFields: ["name", "numeric_level"],
  existing: () => state.gradeLevels,
  fields: [
    {
      key: "numeric_level",
      labelKey: "console.grades.level",
      required: true,
      aliases: ["level", "numeric level", "nivel", "grade", "grado"],
    },
    {
      key: "name",
      labelKey: "console.grades.name",
      required: true,
      aliases: ["name", "nombre", "grade name", "grado"],
    },
  ],
  async prepare() {
    await ensureGradeLevels();
    return { ok: true, ctx: {} };
  },
  resolve(get) {
    const name = get("name");
    const level = coerceInt(get("numeric_level"));
    if (!name) return { error: REQ("console.grades.name") };
    if (level == null) return { error: REQ("console.grades.level") };
    return { payload: { name, numeric_level: level } };
  },
  previewCols: [
    { labelKey: "console.grades.level", get: (p) => p.numeric_level },
    { labelKey: "console.grades.name", get: (p) => p.name },
  ],
};

export const rooms = {
  table: "rooms",
  titleKey: "console.import.entity.rooms",
  reload: () => loadRooms(),
  uniqueFields: ["name"],
  existing: () => state.rooms,
  fields: [
    {
      key: "name",
      labelKey: "console.rooms.name",
      required: true,
      aliases: ["name", "nombre", "room", "aula"],
    },
    {
      key: "capacity",
      labelKey: "console.rooms.capacity",
      aliases: ["capacity", "capacidad", "seats"],
    },
    {
      key: "type",
      labelKey: "console.rooms.type",
      aliases: ["type", "tipo", "kind"],
    },
  ],
  async prepare() {
    await ensureRooms();
    return { ok: true, ctx: {} };
  },
  resolve(get) {
    const name = get("name");
    if (!name) return { error: REQ("console.rooms.name") };
    return {
      payload: {
        name,
        capacity: coerceInt(get("capacity")),
        type: coerceEnum(get("type"), ROOM_TYPES, "classroom"),
      },
    };
  },
  previewCols: [
    { labelKey: "console.rooms.name", get: (p) => p.name },
    { labelKey: "console.rooms.capacity", get: (p) => p.capacity ?? "—" },
    {
      labelKey: "console.rooms.type",
      get: (p) => t(`console.rooms.types.${p.type}`),
    },
  ],
};
