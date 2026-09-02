// ─────────────────────────────────────────────────────────────────
//  index.js — the entity descriptors the one import wizard is driven
//  by, keyed the way the "Import CSV" buttons name them.
//
//  Each descriptor declares which fields to map (+ header aliases),
//  how to turn a mapped row into a DB payload (resolving foreign keys
//  by name), which fields must be unique, and how to preview + reload.
// ─────────────────────────────────────────────────────────────────
import { students, teachers } from "./people.js";
import { subjects, gradeLevels, rooms } from "./catalog.js";
import { schoolYears, gradingPeriods, sections } from "./structure.js";

export const IMPORT_DESCRIPTORS = {
  students,
  teachers,
  subjects,
  gradeLevels,
  rooms,
  schoolYears,
  gradingPeriods,
  sections,
};
