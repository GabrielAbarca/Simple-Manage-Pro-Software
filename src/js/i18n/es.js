// ─────────────────────────────────────────────────────────────────
//  Español (Costa Rica) — mirrors en.js key-for-key, module for module
//  (see i18n/en.js and its own es/ sibling directory). Built from the
//  canonical English base. Professional, school-appropriate phrasing.
// ─────────────────────────────────────────────────────────────────

import common from "./es/common.js";
import a11y from "./es/a11y.js";
import validation from "./es/validation.js";
import errors from "./es/errors.js";
import enums from "./es/enums.js";
import settings from "./es/settings.js";
import student from "./es/student.js";
import teacherConsoleCore from "./es/teacherConsole.core.js";
import teacherConsoleGrading from "./es/teacherConsole.grading.js";
import adminConsoleSetup from "./es/adminConsole.setup.js";
import adminConsoleOperations from "./es/adminConsole.operations.js";
import login from "./es/login.js";

export default {
  common,
  a11y,
  validation,
  errors,
  enums,
  settings,
  student,
  admin: { ...teacherConsoleCore, ...teacherConsoleGrading },
  console: { ...adminConsoleSetup, ...adminConsoleOperations },
  login,
};
