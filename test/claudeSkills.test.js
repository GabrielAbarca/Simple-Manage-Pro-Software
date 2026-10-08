import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, resolve, basename } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const SKILLS_DIR = join(ROOT, ".claude/skills");
const AGENTS_DIR = join(ROOT, ".claude/agents");
const PROCESS_DOC = join(ROOT, "docs/DEVELOPMENT_PROCESS.md");

const EXPECTED_SKILLS = [
  "plan-create-prd",
  "plan-architecture",
  "piv-slice-epic",
  "piv-run-epic",
  "prime-codebase",
  "prime-frontend",
  "prime-backend",
  "piv-plan-implementation",
  "piv-implement",
  "piv-validate",
  "piv-review-changes",
  "piv-fix-review-findings",
  "piv-commit",
  "piv-create-pr",
  "piv-review-pr",
  "piv-run-full-loop",
  "piv-investigate-issue",
  "piv-implement-issue",
  "system-execution-report",
  "system-evolution-review",
  "verify",
  "split-monolith",
];
const EXPECTED_AGENTS = ["code-reviewer", "acceptance-validator"];

const read = (p) => readFileSync(p, "utf8");
const listDirs = (dir) =>
  existsSync(dir)
    ? readdirSync(dir).filter((d) => statSync(join(dir, d)).isDirectory())
    : [];
const skillFiles = () =>
  listDirs(SKILLS_DIR)
    .map((d) => join(SKILLS_DIR, d, "SKILL.md"))
    .filter(existsSync);
const agentFiles = () =>
  existsSync(AGENTS_DIR)
    ? readdirSync(AGENTS_DIR)
        .filter((f) => f.endsWith(".md"))
        .map((f) => join(AGENTS_DIR, f))
    : [];
const referenceFiles = () => {
  const dir = join(ROOT, ".claude/references");
  return existsSync(dir) ? readdirSync(dir).map((f) => join(dir, f)) : [];
};

function frontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) return null;
  const fields = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (kv) fields[kv[1]] = kv[2].replace(/^["']|["']$/g, "").trim();
  }
  return fields;
}

const aiLayerDocs = () => [
  ...skillFiles(),
  ...agentFiles(),
  ...referenceFiles(),
  ...(existsSync(PROCESS_DOC) ? [PROCESS_DOC] : []),
];

describe("AI layer: every expected skill and agent exists", () => {
  it.each(EXPECTED_SKILLS)("skill %s has a SKILL.md", (name) => {
    expect(existsSync(join(SKILLS_DIR, name, "SKILL.md"))).toBe(true);
  });

  it.each(EXPECTED_AGENTS)("agent %s is defined", (name) => {
    expect(existsSync(join(AGENTS_DIR, `${name}.md`))).toBe(true);
  });

  it("the process guide exists", () => {
    expect(existsSync(PROCESS_DOC)).toBe(true);
  });
});

describe("AI layer: frontmatter is valid", () => {
  it("every skill names itself after its directory and says when to use it", () => {
    for (const file of skillFiles()) {
      const fm = frontmatter(read(file));
      const dir = basename(join(file, ".."));
      expect(fm, file).not.toBeNull();
      expect(fm.name, file).toBe(dir);
      expect(fm.description?.length ?? 0, file).toBeGreaterThan(40);
    }
  });

  it("no unquoted frontmatter value contains ' #', which YAML would cut off as a comment", () => {
    const bad = [];
    for (const file of [...skillFiles(), ...agentFiles()]) {
      const block = read(file).match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? "";
      for (const line of block.split("\n")) {
        const kv = line.match(/^([A-Za-z][\w-]*):\s+(.*)$/);
        if (kv && !/^["']/.test(kv[2]) && kv[2].includes(" #"))
          bad.push(`${file} → ${kv[1]}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("every agent names itself after its file and has a description", () => {
    for (const file of agentFiles()) {
      const fm = frontmatter(read(file));
      expect(fm, file).not.toBeNull();
      expect(fm.name, file).toBe(basename(file, ".md"));
      expect(fm.description?.length ?? 0, file).toBeGreaterThan(40);
    }
  });
});

describe("AI layer: hand-offs resolve", () => {
  const SKILL_REF =
    /(?<![\w/.:-])\/((?:piv|plan|prime|system)-[a-z0-9-]+|verify|split-monolith)\b/g;
  const PATH_REF =
    /(?:\.claude\/(?:references|agents)\/[\w.-]+\.md|\.claude\/skills\/[\w-]+\/SKILL\.md|\.github\/[\w./-]+\.md|docs\/[A-Z_]+\.md)/g;

  it("every /skill a document points to exists", () => {
    const missing = [];
    for (const file of aiLayerDocs()) {
      for (const [, name] of read(file).matchAll(SKILL_REF)) {
        if (!existsSync(join(SKILLS_DIR, name, "SKILL.md")))
          missing.push(`${file} → /${name}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("every file path a document cites exists", () => {
    const missing = [];
    for (const file of aiLayerDocs()) {
      for (const [ref] of read(file).matchAll(PATH_REF)) {
        if (!existsSync(join(ROOT, ref))) missing.push(`${file} → ${ref}`);
      }
    }
    expect(missing).toEqual([]);
  });
});

describe("AI layer: no generic or rule-breaking instructions survive", () => {
  const FORBIDDEN = [
    /\bfeature\//,
    /Co-Authored/i,
    /gh pr review/,
    /gh issue comment/,
    /issue-\$ARGUMENTS/,
    /\bJira\b/,
    /\bConfluence\b/,
    /Generated with/i,
  ];

  it("skills and agents carry none of the forbidden patterns", () => {
    const hits = [];
    for (const file of [...skillFiles(), ...agentFiles()]) {
      const text = read(file);
      for (const re of FORBIDDEN)
        if (re.test(text)) hits.push(`${file} ~ ${re}`);
    }
    expect(hits).toEqual([]);
  });
});
