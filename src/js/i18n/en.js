import common from "./en/common.js";
import a11y from "./en/a11y.js";
import validation from "./en/validation.js";
import errors from "./en/errors.js";
import enums from "./en/enums.js";
import settings from "./en/settings.js";
import student from "./en/student.js";
import teacherConsoleCore from "./en/teacherConsole.core.js";
import teacherConsoleGrading from "./en/teacherConsole.grading.js";
import adminConsoleSetup from "./en/adminConsole.setup.js";
import adminConsoleOperations from "./en/adminConsole.operations.js";
import login from "./en/login.js";

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
