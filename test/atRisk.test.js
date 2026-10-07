import { describe, it, expect } from "vitest";
import {
  AT_RISK_MISSED_LESSONS,
  atRiskStudentIds,
  isMissedLesson,
} from "../src/js/atRisk.js";

const rows = (studentId, cstId, statuses) =>
  statuses.map((status) => ({
    student_id: studentId,
    class_subject_teacher_id: cstId,
    status,
  }));

describe("atRisk", () => {
  it("counts absences and tardías as missed lessons, nothing else", () => {
    expect(isMissedLesson("absent")).toBe(true);
    expect(isMissedLesson("late")).toBe(true);
    expect(isMissedLesson("present")).toBe(false);
    expect(isMissedLesson("excused")).toBe(false);
    expect(isMissedLesson(null)).toBe(false);
  });

  it("flags a student once one subject reaches the threshold", () => {
    const flagged = atRiskStudentIds([
      ...rows(1, 10, ["absent", "absent", "absent", "late", "late"]),
      ...rows(2, 10, ["absent", "absent", "absent", "late", "excused"]),
    ]);
    expect([...flagged]).toEqual([1]);
  });

  it("does not add missed lessons up across subjects", () => {
    const flagged = atRiskStudentIds([
      ...rows(1, 10, ["absent", "absent", "absent"]),
      ...rows(1, 11, ["absent", "late"]),
    ]);
    expect(flagged.size).toBe(0);
  });

  it("counts no subject for rows that carry none", () => {
    const missedFive = ["absent", "absent", "absent", "late", "late"];
    expect(atRiskStudentIds(rows(1, null, missedFive)).size).toBe(0);
    expect(atRiskStudentIds(rows(1, undefined, missedFive)).size).toBe(0);
  });

  it("uses the shared threshold by default and accepts another", () => {
    const sample = rows(1, 10, Array(AT_RISK_MISSED_LESSONS - 1).fill("late"));
    expect(atRiskStudentIds(sample).size).toBe(0);
    expect(atRiskStudentIds(sample, AT_RISK_MISSED_LESSONS - 1).size).toBe(1);
  });

  it("tolerates an empty or missing list", () => {
    expect(atRiskStudentIds([]).size).toBe(0);
    expect(atRiskStudentIds(undefined).size).toBe(0);
  });
});
