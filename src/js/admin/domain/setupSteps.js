// ─────────────────────────────────────────────────────────────────
//  setupSteps.js — what the overview's setup checklist counts as done,
//  in dependency order. Pure, so the rules are unit-tested.
// ─────────────────────────────────────────────────────────────────
import { totalWeight, weightStatus } from "../../gradingPeriods.js";

/**
 * @typedef {Object} SetupFacts
 * @property {any} activeYear the active school year, or null
 * @property {boolean} hasYears whether any school year exists
 * @property {any[]} periods the active year's grading periods
 * @property {any[]} sections the active year's sections
 * @property {any[]} subjects
 * @property {any[]} teachers
 * @property {any[]} assignments the active year's teaching assignments
 * @property {number} enrolledCount active students in an active-year section
 */

/**
 * @typedef {Object} SetupStep
 * @property {string} id
 * @property {string} page the console screen that does the step
 * @property {boolean} done
 * @property {boolean} [activate] a year exists but none is active yet
 */

/**
 * @param {SetupFacts} facts
 * @returns {SetupStep[]}
 */
export function setupSteps(facts) {
  const teachers = facts.teachers.filter((t) => t.status !== "inactive");
  const teaching = new Set(facts.assignments.map((a) => a.teacher_id));
  const assigned = teachers.filter((t) => teaching.has(t.id));
  return [
    {
      id: "year",
      page: "yearperiods",
      done: Boolean(facts.activeYear),
      activate: !facts.activeYear && facts.hasYears,
    },
    {
      id: "periods",
      page: "yearperiods",
      done:
        weightStatus(totalWeight(facts.periods), facts.periods.length) === "ok",
    },
    { id: "sections", page: "gradessections", done: facts.sections.length > 0 },
    { id: "subjects", page: "subjects", done: facts.subjects.length > 0 },
    { id: "teachers", page: "teachers", done: teachers.length > 0 },
    {
      id: "assignments",
      page: "assignments",
      done: facts.assignments.length > 0,
    },
    { id: "students", page: "students", done: facts.enrolledCount > 0 },
    {
      id: "logins",
      page: "teachers",
      done: assigned.length > 0 && assigned.every((t) => t.auth_user_id),
    },
  ];
}
