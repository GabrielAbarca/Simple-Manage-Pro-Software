import { describe, it, expect } from "vitest";
import {
  DEFAULT_PASSING_SCORE,
  DEFAULT_CONDUCT_PASSING_SCORE,
  passingScore,
  conductPassingScore,
  isPassing,
  bandClass,
} from "../src/js/promotion.js";

const secondary = { passing_score: 70, conduct_passing_score: 70 };
const primaria = { passing_score: 65, conduct_passing_score: 65 };

describe("passingScore", () => {
  it("reads the school's configured mark", () => {
    expect(passingScore(secondary)).toBe(70);
    expect(passingScore(primaria)).toBe(65);
  });

  it("falls back to the MEP secondary minimum, never 0", () => {
    // A project whose schema predates the column reads back undefined, and a
    // 0 here would silently promote every failing student.
    expect(passingScore(null)).toBe(DEFAULT_PASSING_SCORE);
    expect(passingScore(undefined)).toBe(DEFAULT_PASSING_SCORE);
    expect(passingScore({})).toBe(DEFAULT_PASSING_SCORE);
    expect(passingScore({ passing_score: null })).toBe(DEFAULT_PASSING_SCORE);
    expect(passingScore({ passing_score: "" })).toBe(DEFAULT_PASSING_SCORE);
  });

  it("rejects values that are not a usable percentage", () => {
    expect(passingScore({ passing_score: "abc" })).toBe(DEFAULT_PASSING_SCORE);
    expect(passingScore({ passing_score: -1 })).toBe(DEFAULT_PASSING_SCORE);
    expect(passingScore({ passing_score: 101 })).toBe(DEFAULT_PASSING_SCORE);
    expect(passingScore({ passing_score: Infinity })).toBe(
      DEFAULT_PASSING_SCORE,
    );
  });

  it("accepts the numeric string Supabase returns for numeric(5,2)", () => {
    expect(passingScore({ passing_score: "70.00" })).toBe(70);
  });
});

describe("conductPassingScore", () => {
  it("resolves independently of the subject pass mark", () => {
    expect(conductPassingScore({ conduct_passing_score: 65 })).toBe(65);
    expect(conductPassingScore(null)).toBe(DEFAULT_CONDUCT_PASSING_SCORE);
    expect(conductPassingScore({ passing_score: 65 })).toBe(
      DEFAULT_CONDUCT_PASSING_SCORE,
    );
  });
});

describe("isPassing", () => {
  it("puts the boundary at the mark itself", () => {
    expect(isPassing(69, secondary)).toBe(false);
    expect(isPassing(69.99, secondary)).toBe(false);
    expect(isPassing(70, secondary)).toBe(true);
    expect(isPassing(71, secondary)).toBe(true);
  });

  it("moves the boundary with the school's mark", () => {
    expect(isPassing(65, primaria)).toBe(true);
    expect(isPassing(65, secondary)).toBe(false);
  });

  it("fails the score the student portal used to pass at 50", () => {
    // The defect this module exists to fix: a 55 read "Aprobado".
    expect(isPassing(55, secondary)).toBe(false);
    expect(isPassing(55, null)).toBe(false);
  });

  it("treats an ungraded subject as not passing, not as a failure to colour", () => {
    expect(isPassing(null, secondary)).toBe(false);
    expect(isPassing(undefined, secondary)).toBe(false);
    expect(isPassing("", secondary)).toBe(false);
  });
});

describe("bandClass", () => {
  it("bands relative to the mark: below, borderline, comfortable", () => {
    expect(bandClass(69.99, secondary)).toBe("score-low");
    expect(bandClass(70, secondary)).toBe("score-mid");
    expect(bandClass(74.99, secondary)).toBe("score-mid");
    expect(bandClass(75, secondary)).toBe("score-high");
  });

  it("reproduces the teacher console's original 70/75 split at the default", () => {
    expect(bandClass(69, null)).toBe("score-low");
    expect(bandClass(72, null)).toBe("score-mid");
    expect(bandClass(90, null)).toBe("score-high");
  });

  it("shifts the whole band set with the school's mark", () => {
    expect(bandClass(66, primaria)).toBe("score-mid");
    expect(bandClass(70, primaria)).toBe("score-high");
    expect(bandClass(70, secondary)).toBe("score-mid");
  });

  it("returns no class for an ungraded score, never a coloured zero", () => {
    expect(bandClass(null, secondary)).toBe("");
    expect(bandClass(undefined, secondary)).toBe("");
    expect(bandClass("", secondary)).toBe("");
    expect(bandClass("abc", secondary)).toBe("");
    expect(bandClass(0, secondary)).toBe("score-low");
  });
});
