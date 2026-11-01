import { openImportModal } from "./wizard.js";

const IMPORT_BUTTONS = {
  "btn-import-csv": "students",
  "btn-import-teachers": "teachers",
  "btn-import-subjects": "subjects",
  "btn-import-grades": "gradeLevels",
  "btn-import-rooms": "rooms",
  "btn-import-sections": "sections",
  "btn-import-years": "schoolYears",
  "btn-import-periods": "gradingPeriods",
};

Object.entries(IMPORT_BUTTONS).forEach(([id, key]) => {
  document
    .getElementById(id)
    ?.addEventListener("click", () => openImportModal(key));
});
