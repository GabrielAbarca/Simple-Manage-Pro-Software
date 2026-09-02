// ─────────────────────────────────────────────────────────────────
//  teachers.js — the teachers roster. Split out of admin.js.
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
} from "../ui/tables.js";
import { TEACHER_STATUSES } from "../domain/enums.js";
import { idLabel } from "../domain/schoolProfile.js";
import { accountBtn } from "../domain/accountActions.js";

export async function loadTeachers() {
  renderMessageRow("teachers-body", 6, t("common.loading"));
  try {
    state.teachers = await data.listTeachers();
    renderTeachers(state.teachers);
  } catch (err) {
    console.error("loadTeachers:", err);
    renderErrorRow("teachers-body", 6, loadTeachers);
  }
}

function renderTeachers(list) {
  const tbody = document.getElementById("teachers-body");
  tbody.innerHTML = "";
  if (!list.length) {
    renderEmptyRow("teachers-body", 6, t("console.teachers.empty"));
    return;
  }
  list.forEach((tch) => {
    const statusBadge = `<span class="badge ${tch.status === "active" ? "badge-success" : "badge-neutral"}">${escapeHtml(t(`console.teachers.statuses.${tch.status ?? "active"}`))}</span>`;
    tbody.appendChild(
      tableRow(
        [
          escapeHtml(`${tch.first_name} ${tch.last_name}`),
          escapeHtml(tch.national_id ?? "—"),
          escapeHtml(tch.email ?? "—"),
          escapeHtml(tch.specialization ?? "—"),
          statusBadge,
        ],
        [
          accountBtn(tch, "teacher", loadTeachers),
          iconBtn("edit", t("common.edit"), () => openTeacherForm(tch)),
          iconBtn("delete", t("common.delete"), () => confirmDelete(tch), true),
        ],
        tch.id,
      ),
    );
  });
  applySavedFlash("teachers-body");
}

function confirmDelete(teacher) {
  openConfirm(
    t("console.teachers.confirmDelete", {
      name: `${teacher.first_name} ${teacher.last_name}`,
    }),
    async () => {
      await data.deleteTeacher(teacher.id);
      showToast(t("common.deleted"));
      loadTeachers();
    },
  );
}

export function openTeacherForm(teacher = null) {
  openModal({
    title: teacher
      ? t("console.teachers.editTitle")
      : t("console.teachers.addTitle"),
    fields: [
      {
        name: "first_name",
        maxLength: 100,
        label: t("console.teachers.firstName"),
        value: teacher?.first_name,
        required: true,
      },
      {
        name: "last_name",
        maxLength: 100,
        label: t("console.teachers.lastName"),
        value: teacher?.last_name,
        required: true,
      },
      {
        // Optional by design: not every school records a national ID, and the
        // field is called something different in each country (see idLabel).
        name: "national_id",
        maxLength: 20,
        label: idLabel("teachers"),
        value: teacher?.national_id,
        rules: [
          v.unique(
            state.teachers.map((x) => x.national_id),
            { current: teacher?.national_id },
          ),
        ],
      },
      {
        name: "email",
        maxLength: 150,
        label: t("console.teachers.email"),
        type: "email",
        value: teacher?.email,
        rules: [
          v.email(),
          v.unique(
            state.teachers.map((x) => x.email),
            { current: teacher?.email },
          ),
        ],
      },
      {
        name: "phone",
        maxLength: 20,
        label: t("console.teachers.phone"),
        value: teacher?.phone,
        rules: [v.phone()],
      },
      {
        name: "specialization",
        maxLength: 100,
        label: t("console.teachers.specialization"),
        value: teacher?.specialization,
      },
      {
        name: "status",
        label: t("console.teachers.status"),
        type: "select",
        value: teacher?.status ?? "active",
        required: true,
        options: TEACHER_STATUSES.map((status) => ({
          value: status,
          label: t(`console.teachers.statuses.${status}`),
        })),
      },
    ],
    onSubmit: async (values) => {
      const payload = {
        first_name: values.first_name.trim(),
        last_name: values.last_name.trim(),
        national_id: nullable(values.national_id),
        email: nullable(values.email),
        phone: nullable(values.phone),
        specialization: nullable(values.specialization),
        status: values.status,
      };
      const saved = teacher
        ? await data.updateTeacher(teacher.id, payload).then(() => teacher)
        : await data.createTeacher(payload);
      markSaved("teachers-body", saved?.id ?? teacher?.id);
      showToast(t("common.saved"));
      loadTeachers();
    },
  });
}

document
  .getElementById("btn-add-teacher")
  .addEventListener("click", () => openTeacherForm());
