// ─────────────────────────────────────────────────────────────────
//  people.js — CSV import descriptors for the two people tables.
//  Split out of admin.js.
// ─────────────────────────────────────────────────────────────────
import { t } from "../../../i18n.js";
import { state } from "../../state.js";
import { data } from "../../data.js";
import {
  TEACHER_STATUSES,
  genderLabel,
  coerceGender,
  coerceDate,
  coerceEnum,
} from "../../domain/enums.js";
import { ensureActiveYear, ensureTeachers } from "../../domain/references.js";
import { loadStudents } from "../../screens/students.js";
import { loadTeachers } from "../../screens/teachers.js";

export const students = {
  table: "students",
  titleKey: "console.import.entity.students",
  reload: () => loadStudents(),
  targetSection: true,
  uniqueFields: ["enrollment_number"],
  autogen: {
    field: "enrollment_number",
    make: (i) =>
      `S-${Date.now().toString(36)}-${i}-${Math.floor(Math.random() * 1e4)}`,
  },
  existing: () => state.students,
  fields: [
    {
      key: "first_name",
      labelKey: "console.students.firstName",
      required: true,
      aliases: ["first name", "firstname", "nombre", "nombres", "given name"],
    },
    {
      key: "last_name",
      labelKey: "console.students.lastName",
      required: true,
      aliases: ["last name", "lastname", "apellido", "apellidos", "surname"],
    },
    {
      key: "enrollment_number",
      labelKey: "console.students.enrollmentNumber",
      aliases: [
        "enrollment number",
        "enrollment",
        "matricula",
        "matrícula",
        "student id",
        "studentid",
        "carnet",
        "id",
      ],
    },
    {
      key: "national_id",
      labelKey: "console.students.nationalId",
      aliases: ["national id", "nationalid", "cedula", "cédula", "dni"],
    },
    {
      key: "gender",
      labelKey: "console.students.gender",
      aliases: ["gender", "sex", "genero", "género", "sexo"],
    },
    {
      key: "date_of_birth",
      labelKey: "console.students.dateOfBirth",
      aliases: [
        "date of birth",
        "dob",
        "birthdate",
        "fecha de nacimiento",
        "nacimiento",
      ],
    },
    {
      key: "email",
      labelKey: "console.students.email",
      aliases: ["email", "correo", "e-mail", "mail"],
    },
    {
      key: "phone",
      labelKey: "console.students.phone",
      aliases: ["phone", "telefono", "teléfono", "celular", "mobile", "tel"],
    },
  ],
  async prepare() {
    if (!state.students.length) state.students = await data.listStudents();
    await ensureActiveYear();
    if (state.activeYear)
      state.sections = await data.listSections(state.activeYear.id);
    if (!state.gradeLevels.length)
      state.gradeLevels = await data.listGradeLevels();
    return { ok: true, ctx: {} };
  },
  resolve(get, ctx) {
    const first = get("first_name");
    const last = get("last_name");
    if (!first || !last) return { error: t("console.import.errMissingName") };
    return {
      payload: {
        first_name: first,
        last_name: last,
        enrollment_number: get("enrollment_number") || null,
        national_id: get("national_id") || null,
        gender: coerceGender(get("gender")),
        date_of_birth: coerceDate(get("date_of_birth")),
        email: get("email") || null,
        phone: get("phone") || null,
        class_id: ctx.targetSection ?? null,
        status: "active",
      },
    };
  },
  previewCols: [
    {
      labelKey: "console.students.name",
      get: (p) => `${p.first_name} ${p.last_name}`,
    },
    {
      labelKey: "console.students.enrollmentNumber",
      get: (p) => p.enrollment_number,
    },
    {
      labelKey: "console.students.gender",
      get: (p) => genderLabel(p.gender),
    },
  ],
};

export const teachers = {
  table: "teachers",
  titleKey: "console.import.entity.teachers",
  reload: () => loadTeachers(),
  uniqueFields: ["national_id", "email"],
  existing: () => state.teachers,
  fields: [
    {
      key: "first_name",
      labelKey: "console.teachers.firstName",
      required: true,
      aliases: ["first name", "firstname", "nombre", "nombres"],
    },
    {
      key: "last_name",
      labelKey: "console.teachers.lastName",
      required: true,
      aliases: ["last name", "lastname", "apellido", "apellidos"],
    },
    {
      key: "national_id",
      labelKey: "console.teachers.nationalId",
      aliases: ["national id", "cedula", "cédula", "dni", "id"],
    },
    {
      key: "email",
      labelKey: "console.teachers.email",
      aliases: ["email", "correo", "e-mail", "mail"],
    },
    {
      key: "phone",
      labelKey: "console.teachers.phone",
      aliases: ["phone", "telefono", "teléfono", "celular"],
    },
    {
      key: "specialization",
      labelKey: "console.teachers.specialization",
      aliases: [
        "specialization",
        "especializacion",
        "especialización",
        "subject",
        "area",
      ],
    },
    {
      key: "status",
      labelKey: "console.teachers.status",
      aliases: ["status", "estado"],
    },
  ],
  async prepare() {
    await ensureTeachers();
    return { ok: true, ctx: {} };
  },
  resolve(get) {
    const first = get("first_name");
    const last = get("last_name");
    if (!first || !last) return { error: t("console.import.errMissingName") };
    return {
      payload: {
        first_name: first,
        last_name: last,
        national_id: get("national_id") || null,
        email: get("email") || null,
        phone: get("phone") || null,
        specialization: get("specialization") || null,
        status: coerceEnum(get("status"), TEACHER_STATUSES, "active"),
      },
    };
  },
  previewCols: [
    {
      labelKey: "console.teachers.name",
      get: (p) => `${p.first_name} ${p.last_name}`,
    },
    { labelKey: "console.teachers.email", get: (p) => p.email ?? "—" },
    {
      labelKey: "console.teachers.specialization",
      get: (p) => p.specialization ?? "—",
    },
  ],
};
