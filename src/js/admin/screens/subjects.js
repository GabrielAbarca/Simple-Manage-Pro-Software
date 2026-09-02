// ─────────────────────────────────────────────────────────────────
//  subjects.js — the subjects catalog and its grade-level mapping.
//  Split out of admin.js.
// ─────────────────────────────────────────────────────────────────
import { t } from "../../i18n.js";
import * as v from "../../validate.js";
import { state } from "../state.js";
import { data } from "../data.js";
import { escapeHtml, nullable } from "../ui/format.js";
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
import { gradeName } from "../domain/lookups.js";
import { loadComponentTemplates } from "./componentTemplates.js";

export async function loadSubjects() {
  renderMessageRow("subjects-body", 5, t("common.loading"));
  try {
    const [subjects, gls, mapping] = await Promise.all([
      data.listSubjects(),
      state.gradeLevels.length
        ? Promise.resolve(state.gradeLevels)
        : data.listGradeLevels(),
      data.listGradeLevelSubjects(),
    ]);
    state.subjects = subjects;
    state.gradeLevels = gls;
    renderSubjects(subjects, mapping);
    loadComponentTemplates();
  } catch (err) {
    console.error("loadSubjects:", err);
    renderErrorRow("subjects-body", 5, loadSubjects);
  }
}

function renderSubjects(subjects, mapping) {
  const tbody = document.getElementById("subjects-body");
  tbody.innerHTML = "";
  if (!subjects.length) {
    renderEmptyRow("subjects-body", 5, t("console.subjects.empty"));
    return;
  }
  const bySubject = new Map();
  mapping.forEach((m) => {
    if (!bySubject.has(m.subject_id)) bySubject.set(m.subject_id, []);
    bySubject.get(m.subject_id).push(m);
  });

  subjects.forEach((s) => {
    const mapped = bySubject.get(s.id) ?? [];
    const gradeNames =
      mapped
        .map((m) => gradeName(m.grade_level_id))
        .filter((n) => n !== "—")
        .join(", ") || "—";
    const swatch = s.color
      ? `<span class="color-swatch" style="background:${escapeHtml(s.color)}"></span>${escapeHtml(s.color)}`
      : "—";
    tbody.appendChild(
      tableRow(
        [
          `<code>${escapeHtml(s.code ?? "—")}</code>`,
          escapeHtml(s.name),
          swatch,
          escapeHtml(gradeNames),
        ],
        [
          iconBtn("edit", t("common.edit"), () => openSubjectForm(s, mapped)),
          iconBtn("delete", t("common.delete"), () => confirmDelete(s), true),
        ],
        s.id,
      ),
    );
  });
  applySavedFlash("subjects-body");
}

function confirmDelete(subject) {
  openConfirm(
    t("console.subjects.confirmDelete", { name: subject.name }),
    async () => {
      await data.deleteSubject(subject.id);
      showToast(t("common.deleted"));
      loadSubjects();
    },
  );
}

/**
 * Reconcile the subject's grade-level mapping: add every newly checked level,
 * drop every unchecked one.
 * @param {number} subjectId
 * @param {string[]} checkedGradeIds
 * @param {any[]} mapped the mapping rows the form opened with
 */
async function syncGradeMapping(subjectId, checkedGradeIds, mapped) {
  const desired = new Set(checkedGradeIds.map(Number));
  const current = new Map(mapped.map((m) => [m.grade_level_id, m.id]));
  for (const gid of desired) {
    if (!current.has(gid))
      await data.createGradeLevelSubject({
        subject_id: subjectId,
        grade_level_id: gid,
        weekly_hours: 4,
      });
  }
  for (const [gid, mapId] of current) {
    if (!desired.has(gid)) await data.deleteGradeLevelSubject(mapId);
  }
}

export function openSubjectForm(subject = null, mapped = []) {
  const mappedGradeIds = mapped.map((m) => m.grade_level_id);
  openModal({
    title: subject
      ? t("console.subjects.editTitle")
      : t("console.subjects.addTitle"),
    fields: [
      {
        name: "name",
        maxLength: 100,
        label: t("console.subjects.name"),
        value: subject?.name,
        required: true,
        rules: [
          v.unique(
            state.subjects.map((s) => s.name),
            { current: subject?.name },
          ),
        ],
      },
      {
        name: "code",
        maxLength: 10,
        label: t("console.subjects.code"),
        value: subject?.code,
        placeholder: "MATH7",
        rules: [
          v.unique(
            state.subjects.map((s) => s.code),
            { current: subject?.code },
          ),
        ],
      },
      {
        name: "color",
        label: t("console.subjects.color"),
        type: "color",
        value: subject?.color ?? "#7380ec",
      },
      {
        name: "description",
        label: t("console.subjects.description"),
        type: "textarea",
        value: subject?.description,
      },
      {
        name: "grades",
        label: t("console.subjects.gradeLevels"),
        type: "checkboxes",
        value: mappedGradeIds,
        options: optionsFrom(state.gradeLevels, (g) => g.name),
      },
    ],
    onSubmit: async (values) => {
      const payload = {
        name: values.name.trim(),
        code: nullable(values.code),
        color: nullable(values.color),
        description: nullable(values.description),
      };
      let subjectId = subject?.id;
      if (subject) await data.updateSubject(subject.id, payload);
      else {
        const created = await data.createSubject(payload);
        subjectId = created.id;
      }
      markSaved("subjects-body", subjectId);
      await syncGradeMapping(subjectId, values.grades, mapped);
      showToast(t("common.saved"));
      loadSubjects();
    },
  });
}

document
  .getElementById("btn-add-subject")
  .addEventListener("click", () => openSubjectForm());
