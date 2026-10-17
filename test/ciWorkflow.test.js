import { existsSync, readFileSync } from "node:fs";
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

/**
 * @param {string[]} lines
 */
function items(lines) {
  const dashes = lines.filter((line) => /^\s*- /.test(line));
  const indent = Math.min(...dashes.map((line) => line.search(/\S/)));
  /** @type {string[][]} */
  const found = [];
  for (const line of lines) {
    if (line.search(/\S/) === indent && line.trimStart().startsWith("- ")) {
      found.push([]);
    }
    found.at(-1)?.push(line);
  }
  return found.map((item) => item.join("\n"));
}

const jobs = block(workflow, "jobs", 0);

/**
 * @param {string} job
 */
function steps(job) {
  return items(block(block(jobs, job, 2), "steps", 4));
}

/**
 * @param {string} step
 */
function command(step) {
  return step.match(/\brun:\s*(.+)$/m)?.[1].trim();
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

  it("pulls the schema job's images from a registry other than ECR Public", () => {
    const schema = block(jobs, "schema", 2).join("\n");
    const registry = schema.match(
      /^\s+SUPABASE_INTERNAL_IMAGE_REGISTRY: "?([^"\s]+)"?$/m,
    )?.[1];

    expect(registry).toBeDefined();
    expect(["ghcr.io", "docker.io"]).toContain(registry);
    expect(schema).not.toMatch(/secrets\./);
  });

  it("checks formatting in the quality job", () => {
    const quality = steps("quality");
    const commands = quality.map(command);
    const format = commands.indexOf("npm run format:check");
    const lint = commands.indexOf("npm run lint");

    expect(format).toBeGreaterThan(-1);
    expect(lint).toBeGreaterThan(format);
    expect(quality[format]).not.toMatch(/^\s+(if|continue-on-error):/m);
  });

  it("reports dependency advisories on pull requests without failing them", () => {
    const triggers = block(workflow, "on", 0);
    const quality = block(jobs, "quality", 2);
    const audit = steps("quality").find((step) => /\bnpm audit\b/.test(step));

    expect(audit).toBeDefined();
    expect(triggers.some((line) => /^ {2}pull_request:/.test(line))).toBe(true);
    expect(quality.some((line) => /^ {4}if:/.test(line))).toBe(false);
    expect(audit).not.toMatch(/^\s+if:(?!.*pull_request)/m);
    expect(audit).toMatch(/^\s+continue-on-error: true$|\|\| true$/m);
    expect(audit).not.toMatch(/--(omit|production|only)\b/);
  });

  it("keeps npm and GitHub Actions dependencies updated weekly", () => {
    const file = new URL("../.github/dependabot.yml", import.meta.url);

    expect(existsSync(file)).toBe(true);

    const config = readFileSync(file, "utf8").split("\n");
    const updates = items(block(config, "updates", 0));

    expect(config).toContain("version: 2");
    for (const ecosystem of ["npm", "github-actions"]) {
      const update = updates.find((entry) =>
        new RegExp(`package-ecosystem: "?${ecosystem}"?$`, "m").test(entry),
      );

      expect(update, ecosystem).toBeDefined();
      expect(update).toMatch(/^\s+directory: "?\/"?$/m);
      expect(update).toMatch(/^\s+interval: "?weekly"?$/m);
      expect(update).not.toMatch(/open-pull-requests-limit: 0\b/);
    }
  });

  it("builds on Node 24.x everywhere", () => {
    const pkg = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    );
    const names = jobs
      .filter((line) => /^ {2}[\w-]+:$/.test(line))
      .map((line) => line.trim().slice(0, -1));
    const setups = names
      .flatMap(steps)
      .filter((step) => /uses: actions\/setup-node@/.test(step));

    expect(pkg.engines?.node).toBe("24.x");
    expect(setups.length).toBeGreaterThan(0);
    for (const setup of setups) {
      expect(setup).toMatch(/^\s+node-version-file: package\.json$/m);
      expect(setup).not.toMatch(/node-version:/);
    }
  });
});
