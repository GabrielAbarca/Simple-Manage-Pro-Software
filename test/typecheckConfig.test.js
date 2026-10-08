import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** @param {string} file */
const path = (file) => new URL(`../${file}`, import.meta.url);

/** @param {string} file */
const readJson = (file) =>
  JSON.parse(readFileSync(path(file), "utf8").replace(/^\s*\/\/.*$/gm, ""));

describe("typecheck configs", () => {
  it("type-checks Node code only in the delivery scripts", () => {
    const app = readJson("tsconfig.json");
    expect(app.compilerOptions.types).not.toContain("node");
    expect(app.include).toEqual(["src/js/**/*.js"]);

    expect(existsSync(path("tsconfig.scripts.json"))).toBe(true);
    const scripts = readJson("tsconfig.scripts.json");
    expect(scripts.extends).toBe("./tsconfig.json");
    expect(scripts.compilerOptions.types).toEqual(["node"]);
    expect(scripts.compilerOptions.lib).not.toContain("DOM");
    expect(scripts.include).toEqual(["scripts/delivery/**/*.mjs"]);

    expect(readJson("package.json").scripts.typecheck).toBe(
      "tsc -p tsconfig.json && tsc -p tsconfig.scripts.json",
    );
  });
});
