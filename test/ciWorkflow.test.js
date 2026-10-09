import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  new URL("../.github/workflows/ci.yml", import.meta.url),
  "utf8",
).split("\n");

/**
 * @param {string[]} from
 * @param {string} key
 * @param {number} indent
 */
function block(from, key, indent) {
  const start = from.indexOf(`${" ".repeat(indent)}${key}:`);
  if (start === -1) return [];
  const body = [];
  for (const line of from.slice(start + 1)) {
    if (line.trim() && line.search(/\S/) <= indent) break;
    body.push(line);
  }
  return body;
}

describe("CI workflow", () => {
  it("runs the schema job on every pull request without any secret", () => {
    const triggers = block(workflow, "on", 0);
    const schema = block(block(workflow, "jobs", 0), "schema", 2);
    const text = schema.join("\n");

    expect(schema.length).toBeGreaterThan(0);
    expect(triggers.some((line) => /^ {2}pull_request:/.test(line))).toBe(true);
    expect(triggers.some((line) => /^\s+paths(-ignore)?:/.test(line))).toBe(
      false,
    );
    expect(schema.some((line) => /^ {4}if:/.test(line))).toBe(false);
    expect(text).toMatch(/^\s+SMP_SCHEMA_DB_URL: \S+/m);
    expect(text).toContain("test/schemaHarness.db.test.js");
    expect(text).not.toMatch(/secrets\./);
  });
});
