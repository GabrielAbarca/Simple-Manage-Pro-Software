// ─────────────────────────────────────────────────────────────────
//  students.js — the student roster and enrollment. Split out of
//  admin.js. The CSV roster import lives under admin/import/.
// ─────────────────────────────────────────────────────────────────
import { t, tn } from "../../i18n.js";
import * as v from "../../validate.js";
import { state } from "../state.js";
import { data } from "../data.js";
import { escapeHtml, num, nullable, todayIso } from "../ui/format.js";
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
import { sectionName, sectionOptions } from "../domain/lookups.js";
import { STUDENT_STATUSES, genderLabel } from "../domain/enums.js";
import { idLabel } from "../domain/schoolProfile.js";
import { accountBtn } from "../domain/accountActions.js";

export async function loadStudents() {
  renderMessageRow("students-body", 7, t("common.loading"));
  try {
    if (!state.activeYear) {
      const years = await data.listSchoolYears();
      state.activeYear = years.find((y) => y.is_active) ?? null;
    }
    const [students, sectionsList] = await Promise.all([
      data.listStudents(),
      state.activeYear
        ? data.listSections(state.activeYear.id)
        : Promise.resolve([]),
    ]);
    state.students = students;
    state.sections = sectionsList;
    if (!state.gradeLevels.length)
      state.gradeLevels = await data.listGradeLevels();
    renderStudentFilter();
    renderStudents();
  } catch (err) {
    console.error("loadStudents:", err);
    renderErrorRow("students-body", 7, loadStudents);
  }
}

/**
 * Students filter. "All students" and "No section assigned" are enrollment
 * states, not places — grouping the real sections under their own heading
 * stops "unassigned" from reading like a section the school actually has.
 */
function renderStudentFilter() {
  const sel = document.getElementById("students-filter");
  const prev = String(state.studentFilter);
  sel.innerHTML = "";

  const addOption = (parent, value, label) => {
    const el = document.createElement("option");
    el.value = value;
    el.textContent = label;
    if (value === prev) el.selected = true;
    parent.appendChild(el);
  };

  addOption(sel, "all", t("console.students.allStudents"));
  addOption(sel, "unassigned", t("console.students.unassigned"));

  if (state.sections.length) {
    const group = document.createElement("optgroup");
    group.label = t("console.students.sectionsGroup");
    state.sections.forEach((s) =>
      addOption(group, String(s.id), sectionName(s)),
    );
    sel.appendChild(group);
  }
}

function filteredStudents() {
  if (state.studentFilter === "all") return state.students;
  if (state.studentFilter === "unassigned")
    return state.students.filter((s) => !s.class_id);
  return state.students.filter(
    (s) => String(s.class_id) === String(state.studentFilter),
  );
}

/** The student's section, named the way the rest of the console names it. */
function studentSectionName(student) {
  if (!student.class_id) return "—";
  const sec = state.sections.find((x) => x.id === student.class_id);
  return sec ? sectionName(sec) : "—";
}

function statusToggleBtn(student) {
  const active = student.status === "active";
  return iconBtn(
    active ? "block" : "check_circle",
    active
      ? t("console.students.deactivate")
      : t("console.students.reactivate"),
    async () => {
      await data.updateStudent(student.id, {
        status: active ? "inactive" : "active",
      });
      showToast(t("common.saved"));
      loadStudents();
    },
  );
}

function confirmDelete(student) {
  openConfirm(
    t("console.students.confirmDelete", {
      name: `${student.first_name} ${student.last_name}`,
    }),
    async () => {
      await data.deleteStudent(student.id);
      showToast(t("common.deleted"));
      loadStudents();
    },
  );
}

export function renderStudents() {
  const list = filteredStudents();
  const countEl = document.getElementById("students-count");
  countEl.textContent = tn("console.students.count", list.length, {
    count: list.length,
  });
  const tbody = document.getElementById("students-body");
  tbody.innerHTML = "";
  if (!list.length) {
    renderEmptyRow("students-body", 7, t("console.students.empty"));
    return;
  }
  list.forEach((s) => {
    const active = s.status === "active";
    const statusBadge = `<span class="badge ${active ? "badge-success" : "badge-neutral"}">${escapeHtml(t(`enums.studentStatus.${s.status ?? "active"}`))}</span>`;
    tbody.appendChild(
      tableRow(
        [
          escapeHtml(`${s.first_name} ${s.last_name}`),
          escapeHtml(s.enrollment_number ?? "—"),
          escapeHtml(s.national_id ?? "—"),
          escapeHtml(genderLabel(s.gender)),
          escapeHtml(studentSectionName(s)),
          statusBadge,
        ],
        [
          accountBtn(s, "student", loadStudents),
          iconBtn("edit", t("common.edit"), () => openStudentForm(s)),
          statusToggleBtn(s),
          iconBtn("delete", t("common.delete"), () => confirmDelete(s), true),
        ],
        s.id,
      ),
    );
  });
  applySavedFlash("students-body");
}

export function openStudentForm(student = null) {
  openModal({
    title: student
      ? t("console.students.editTitle")
      : t("console.students.addTitle"),
    fields: [
      {
        name: "first_name",
        maxLength: 100,
        label: t("console.students.firstName"),
        value: student?.first_name,
        required: true,
      },
      {
        name: "last_name",
        maxLength: 100,
        label: t("console.students.lastName"),
        value: student?.last_name,
        required: true,
      },
      {
        name: "enrollment_number",
        maxLength: 20,
        label: t("console.students.enrollmentNumber"),
        value: student?.enrollment_number,
        help: t("console.students.enrollmentHelp"),
        rules: [
          v.unique(
            state.students.map((s) => s.enrollment_number),
            {
              current: student?.enrollment_number,
              messageKey: "validation.enrollmentTaken",
            },
          ),
        ],
      },
      {
        // Optional, with a per-school label — same treatment as teachers.
        name: "national_id",
        maxLength: 20,
        label: idLabel("students"),
        value: student?.national_id,
        rules: [
          v.unique(
            state.students.map((s) => s.national_id),
            { current: student?.national_id },
          ),
        ],
      },
      {
        name: "date_of_birth",
        label: t("console.students.dateOfBirth"),
        type: "date",
        value: student?.date_of_birth,
        max: todayIso(),
        rules: [v.notFuture()],
      },
      {
        name: "gender",
        label: t("console.students.gender"),
        type: "select",
        value: student?.gender,
        options: ["M", "F", "O"].map((g) => ({
          value: g,
          label: t(`enums.gender.${g}`),
        })),
      },
      {
        name: "email",
        maxLength: 150,
        label: t("console.students.email"),
        type: "email",
        value: student?.email,
        rules: [v.email()],
      },
      {
        name: "phone",
        maxLength: 20,
        label: t("console.students.phone"),
        value: student?.phone,
        rules: [v.phone()],
      },
      {
        name: "class_id",
        label: t("console.students.section"),
        type: "select",
        value: student?.class_id,
        options: sectionOptions(),
      },
      {
        name: "status",
        label: t("console.students.status"),
        type: "select",
        value: student?.status ?? "active",
        required: true,
        options: STUDENT_STATUSES.map((status) => ({
          value: status,
          label: t(`enums.studentStatus.${status}`),
        })),
      },
    ],
    onSubmit: async (values) => {
      const enrollment =
        nullable(values.enrollment_number) ?? generateEnrollment(student);
      const payload = {
        first_name: values.first_name.trim(),
        last_name: values.last_name.trim(),
        enrollment_number: enrollment,
        national_id: nullable(values.national_id),
        date_of_birth: nullable(values.date_of_birth),
        gender: nullable(values.gender),
        email: nullable(values.email),
        phone: nullable(values.phone),
        class_id: num(values.class_id),
        status: values.status,
      };
      const saved = student
        ? await data.updateStudent(student.id, payload).then(() => student)
        : await data.createStudent(payload);
      markSaved("students-body", saved?.id ?? student?.id);
      showToast(t("common.saved"));
      loadStudents();
    },
  });
}

// Unique-enough enrollment number when the admin leaves it blank. Existing
// students keep theirs (edit passes the current value through).
function generateEnrollment(student) {
  if (student?.enrollment_number) return student.enrollment_number;
  const existing = new Set(
    state.students.map((s) => s.enrollment_number).filter(Boolean),
  );
  let candidate;
  do {
    candidate = `S-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4)}`;
  } while (existing.has(candidate));
  return candidate;
}

document
  .getElementById("btn-add-student")
  .addEventListener("click", () => openStudentForm());
document.getElementById("students-filter").addEventListener("change", (e) => {
  state.studentFilter = /** @type {HTMLSelectElement} */ (e.target).value;
  renderStudents();
});
