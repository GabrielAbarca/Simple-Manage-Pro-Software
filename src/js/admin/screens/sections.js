// ─────────────────────────────────────────────────────────────────
//  sections.js — the sections (DB: `classes`) table on the Grades &
//  Sections screen. Split out of admin.js.
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
  optionsFrom,
} from "../ui/tables.js";
import {
  gradeName,
  roomName,
  teacherName,
  sectionName,
} from "../domain/lookups.js";

export async function loadSections() {
  const label = document.getElementById("sections-year-label");
  const addBtn = /** @type {HTMLButtonElement} */ (
    document.getElementById("btn-add-section")
  );
  if (!state.activeYear) {
    const years = await data.listSchoolYears();
    state.activeYear = years.find((y) => y.is_active) ?? null;
  }
  if (!state.activeYear) {
    label.textContent = t("console.sections.noYear");
    addBtn.disabled = true;
    renderEmptyRow("sections-body", 6, t("console.sections.noYear"));
    return;
  }
  addBtn.disabled = false;
  label.textContent = state.activeYear.name;
  renderMessageRow("sections-body", 6, t("common.loading"));
  try {
    const [sectionsList, teachers] = await Promise.all([
      data.listSections(state.activeYear.id),
      state.teachers.length
        ? Promise.resolve(state.teachers)
        : data.listTeachers(),
    ]);
    state.sections = sectionsList;
    state.teachers = teachers;
    renderSections(sectionsList);
  } catch (err) {
    console.error("loadSections:", err);
    renderErrorRow("sections-body", 6, loadSections);
  }
}

function renderSections(list) {
  const tbody = document.getElementById("sections-body");
  tbody.innerHTML = "";
  if (!list.length) {
    renderEmptyRow("sections-body", 6, t("console.sections.empty"));
    return;
  }
  list.forEach((s) => {
    tbody.appendChild(
      tableRow(
        [
          escapeHtml(gradeName(s.grade_level_id)),
          escapeHtml(s.section),
          escapeHtml(
            s.homeroom_teacher_id ? teacherName(s.homeroom_teacher_id) : "—",
          ),
          escapeHtml(s.room_id ? roomName(s.room_id) : "—"),
          s.max_capacity != null ? escapeHtml(s.max_capacity) : "—",
        ],
        [
          iconBtn("edit", t("common.edit"), () => openSectionForm(s)),
          iconBtn("delete", t("common.delete"), () => confirmDelete(s), true),
        ],
        s.id,
      ),
    );
  });
  applySavedFlash("sections-body");
}

function confirmDelete(section) {
  openConfirm(
    t("console.sections.confirmDelete", { name: sectionName(section) }),
    async () => {
      await data.deleteSection(section.id);
      showToast(t("common.deleted"));
      loadSections();
    },
  );
}

export function openSectionForm(section = null) {
  if (!state.gradeLevels.length) {
    showToast(t("console.sections.needGrade"), "error");
    return;
  }
  openModal({
    title: section
      ? t("console.sections.editTitle")
      : t("console.sections.addTitle"),
    fields: [
      {
        name: "grade_level_id",
        label: t("console.sections.grade"),
        type: "select",
        value: section?.grade_level_id,
        required: true,
        options: optionsFrom(
          state.gradeLevels,
          (g) => `${g.name} (${g.numeric_level})`,
        ),
      },
      {
        name: "section",
        maxLength: 10,
        label: t("console.sections.section"),
        value: section?.section,
        required: true,
        placeholder: "A",
      },
      {
        // Optional on purpose: a section can exist before its lead teacher is
        // decided. The help text explains the role, which "Homeroom" alone
        // doesn't convey to a director setting up their first year.
        name: "homeroom_teacher_id",
        label: t("console.sections.homeroom"),
        type: "select",
        value: section?.homeroom_teacher_id,
        help: t("console.sections.homeroomHelp"),
        options: optionsFrom(
          state.teachers,
          (tch) => `${tch.first_name} ${tch.last_name}`,
        ),
      },
      {
        name: "room_id",
        label: t("console.sections.room"),
        type: "select",
        value: section?.room_id,
        options: optionsFrom(state.rooms, (r) => r.name),
      },
      {
        name: "max_capacity",
        label: t("console.sections.capacity"),
        type: "number",
        value: section?.max_capacity ?? 30,
        min: 1,
        rules: [
          v.integer(),
          v.min(1),
          // A section can't seat more students than its room holds. Nothing
          // enforced this before, in the client or the database.
          v.atMost(
            (values) =>
              state.rooms.find((r) => String(r.id) === String(values.room_id))
                ?.capacity,
            "validation.capacityRoom",
            (capacity, roomCapacity) => ({ capacity, roomCapacity }),
          ),
        ],
      },
    ],
    onSubmit: async (values) => {
      const gl = state.gradeLevels.find(
        (g) => String(g.id) === String(values.grade_level_id),
      );
      const sectionCode = values.section.trim();
      const payload = {
        grade_level_id: num(values.grade_level_id),
        section: sectionCode,
        display_name: gl ? `${gl.numeric_level}${sectionCode}` : sectionCode,
        homeroom_teacher_id: num(values.homeroom_teacher_id),
        room_id: num(values.room_id),
        max_capacity: num(values.max_capacity),
      };
      const saved = section
        ? await data.updateSection(section.id, payload).then(() => section)
        : await data.createSection({
            ...payload,
            school_year_id: state.activeYear.id,
          });
      markSaved("sections-body", saved?.id ?? section?.id);
      showToast(t("common.saved"));
      loadSections();
    },
  });
}

document
  .getElementById("btn-add-section")
  .addEventListener("click", () => openSectionForm());
