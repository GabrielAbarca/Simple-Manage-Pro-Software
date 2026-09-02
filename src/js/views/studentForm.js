// ─────────────────────────────────────────────────────────────────
//  studentForm.js — the roster's add/edit/delete student forms, split out
//  of roster.js to keep the table/list rendering and the CRUD forms each
//  under a page's worth of code. Imports loadRoster back from roster.js to
//  refresh after a save (safe: only called from inside a submit/confirm
//  callback, never at module top level — see gradebook.js's header comment
//  for why this shape of circular import is fine).
// ─────────────────────────────────────────────────────────────────
import { t } from "../i18n.js";
import { db } from "../teacherData/index.js";
import { state } from "../teacherState.js";
import { openModal } from "../teacherModal.js";
import { showToast, openConfirm } from "../teacherFeedback.js";
import { className, genderOptions } from "../teacherFormat.js";
import { loadRoster } from "./roster.js";

// Distinct class options across the teacher's subject-sections.
function teacherClassOptions() {
  const seen = new Set();
  const opts = [];
  state.myClassesCache.forEach((cst) => {
    if (seen.has(cst.class_id)) return;
    seen.add(cst.class_id);
    opts.push({
      value: cst.class_id,
      label: className(cst.classes),
    });
  });
  return opts;
}

export async function openAddStudent() {
  openModal({
    title: t("admin.form.addStudentTitle", {
      class: state.currentClass.className,
    }),
    submitLabel: t("admin.roster.addStudent"),
    fields: [
      {
        name: "enrollment_number",
        label: t("admin.form.enrollmentShort"),
        type: "text",
        required: true,
        placeholder: t("admin.form.enrollmentPlaceholder"),
      },
      {
        name: "first_name",
        label: t("admin.form.firstName"),
        type: "text",
        required: true,
      },
      {
        name: "last_name",
        label: t("admin.form.lastName"),
        type: "text",
        required: true,
      },
      { name: "email", label: t("admin.form.email"), type: "email" },
      { name: "phone", label: t("admin.form.phone"), type: "text" },
      {
        name: "date_of_birth",
        label: t("admin.form.dateOfBirth"),
        type: "date",
      },
      {
        name: "gender",
        label: t("admin.form.gender"),
        type: "select",
        options: genderOptions(),
      },
      {
        name: "enrollment_date",
        label: t("admin.form.enrollmentDate"),
        type: "date",
        value: new Date().toISOString().split("T")[0],
      },
      { name: "address", label: t("admin.form.address"), type: "textarea" },
      { name: "photo_url", label: t("admin.form.photoUrl"), type: "url" },
      {
        name: "class_id",
        label: t("admin.form.class"),
        type: "select",
        required: true,
        value: state.currentClass.classId,
        options: teacherClassOptions(),
      },
    ],
    onSubmit: async (formData) => {
      await db.insertStudent({
        enrollment_number: formData.enrollment_number.trim(),
        first_name: formData.first_name.trim(),
        last_name: formData.last_name.trim(),
        email: formData.email?.trim() || null,
        phone: formData.phone?.trim() || null,
        date_of_birth: formData.date_of_birth || null,
        gender: formData.gender || null,
        enrollment_date: formData.enrollment_date || null,
        address: formData.address?.trim() || null,
        photo_url: formData.photo_url?.trim() || null,
        class_id: Number(formData.class_id),
        status: "active",
      });
      showToast(
        t("admin.toast.studentAdded", {
          name: `${formData.first_name} ${formData.last_name}`,
        }),
      );
      loadRoster();
    },
  });
}

export function openEditStudent(student) {
  openModal({
    title: t("admin.form.editStudentTitle"),
    submitLabel: t("admin.form.saveChanges"),
    fields: [
      {
        name: "first_name",
        label: t("admin.form.firstName"),
        type: "text",
        required: true,
        value: student.first_name,
      },
      {
        name: "last_name",
        label: t("admin.form.lastName"),
        type: "text",
        required: true,
        value: student.last_name,
      },
      {
        name: "email",
        label: t("admin.form.email"),
        type: "email",
        value: student.email ?? "",
      },
      {
        name: "phone",
        label: t("admin.form.phone"),
        type: "text",
        value: student.phone ?? "",
      },
      {
        name: "national_id",
        label: t("admin.form.nationalIdFull"),
        type: "text",
        value: student.national_id ?? "",
        disabled: true,
        help: t("admin.form.nationalIdHelp"),
      },
      {
        name: "date_of_birth",
        label: t("admin.form.dateOfBirth"),
        type: "date",
        value: student.date_of_birth ?? "",
      },
      {
        name: "gender",
        label: t("admin.form.gender"),
        type: "select",
        value: student.gender ?? "",
        options: genderOptions(),
      },
      {
        name: "enrollment_date",
        label: t("admin.form.enrollmentDate"),
        type: "date",
        value: student.enrollment_date ?? "",
      },
      {
        name: "address",
        label: t("admin.form.address"),
        type: "textarea",
        value: student.address ?? "",
      },
      {
        name: "photo_url",
        label: t("admin.form.photoUrl"),
        type: "url",
        value: student.photo_url ?? "",
      },
      {
        name: "class_id",
        label: t("admin.form.class"),
        type: "select",
        required: true,
        value: state.currentClass.classId,
        options: teacherClassOptions(),
      },
      {
        name: "status",
        label: t("admin.form.status"),
        type: "select",
        required: true,
        value: student.status,
        options: [
          { value: "active", label: t("enums.studentStatus.active") },
          { value: "inactive", label: t("enums.studentStatus.inactive") },
          { value: "graduated", label: t("enums.studentStatus.graduated") },
          { value: "transferred", label: t("enums.studentStatus.transferred") },
          { value: "withdrawn", label: t("enums.studentStatus.withdrawn") },
        ],
      },
    ],
    onSubmit: async (formData) => {
      // national_id is a disabled field — excluded from FormData, never updated.
      await db.updateStudent(student.id, {
        first_name: formData.first_name.trim(),
        last_name: formData.last_name.trim(),
        email: formData.email?.trim() || null,
        phone: formData.phone?.trim() || null,
        date_of_birth: formData.date_of_birth || null,
        gender: formData.gender || null,
        enrollment_date: formData.enrollment_date || null,
        address: formData.address?.trim() || null,
        photo_url: formData.photo_url?.trim() || null,
        class_id: Number(formData.class_id),
        status: formData.status,
      });
      showToast(
        t("admin.toast.studentUpdated", {
          name: `${formData.first_name} ${formData.last_name}`,
        }),
      );
      loadRoster();
    },
  });
}

export function confirmDeleteStudent(id, name) {
  openConfirm(t("admin.confirm.deleteStudent", { name }), async () => {
    await db.deleteStudent(id);
    showToast(t("admin.toast.studentDeleted", { name }));
    loadRoster();
  });
}
