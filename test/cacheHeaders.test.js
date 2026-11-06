import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const vercel = JSON.parse(
  readFileSync(new URL("../vercel.json", import.meta.url), "utf8"),
);

function cacheControlValuesFor(path) {
  return vercel.headers
    .filter((rule) => new RegExp(`^${rule.source}$`).test(path))
    .flatMap((rule) => rule.headers)
    .filter((header) => header.key === "Cache-Control")
    .map((header) => header.value);
}

describe("asset caching", () => {
  it("lets browsers keep built files but recheck them on every load", () => {
    expect(cacheControlValuesFor("/assets/validate-R_lWUPqt.js")).toEqual([
      "public, max-age=0, must-revalidate",
    ]);
  });

  it("never pins an /assets/ response, which may be a 404 mid-deploy", () => {
    for (const value of cacheControlValuesFor("/assets/missing-chunk.js")) {
      expect(value).not.toMatch(/immutable/);
      expect(value).not.toMatch(/max-age=[1-9]/);
    }
  });
});
