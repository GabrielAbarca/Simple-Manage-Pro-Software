import { describe, it, expect } from "vitest";
import { dateCell } from "../src/js/tableExport.js";

describe("dateCell", () => {
  it("turns a stored date into a UTC midnight Date", () => {
    const date = dateCell("2012-05-03");
    expect(date).toBeInstanceOf(Date);
    expect(/** @type {Date} */ (date).toISOString()).toBe(
      "2012-05-03T00:00:00.000Z",
    );
  });

  it("leaves anything that is not a real date unchanged", () => {
    expect(dateCell("2012-02-31")).toBe("2012-02-31");
    expect(dateCell("2012-13-40")).toBe("2012-13-40");
    expect(dateCell("03/05/2012")).toBe("03/05/2012");
    expect(dateCell(null)).toBe(null);
    expect(dateCell(undefined)).toBe(undefined);
  });
});
