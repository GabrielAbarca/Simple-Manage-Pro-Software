// ─────────────────────────────────────────────────────────────────
//  English — the canonical base language and ultimate fallback.
//  es.js mirrors this exact key tree, module for module (see i18n/es.js
//  and its own en/ sibling directory). Keys are namespaced by area:
//    common · enums · settings · student · admin · console · login
//  Plural keys use { one, other } and are read via tn(); {token}
//  placeholders are filled by t()/tn(). DB content is never keyed here.
//
//  `admin` and `console` are each assembled from two files split at a
//  sibling-key boundary purely to keep every file under ~250 lines — the
//  merged shape is unaffected. `admin` is the teacher console dictionary
//  (teacher.js) and `console` is the admin console dictionary (admin.js) —
//  a pre-existing naming quirk this split does not change.
// ─────────────────────────────────────────────────────────────────

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
