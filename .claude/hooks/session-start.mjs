import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const OWNER_NAME = "Gabriel Zelaya";
const OWNER_EMAIL = "gzelaya0404@gmail.com";
const BRANCH_RULE =
  /^(feat|fix|docs|chore|refactor|test)\/[a-z0-9]+(-[a-z0-9]+){1,2}$/;
const HASH_LIKE =
  /^(?=(?:[a-z]*\d){2})(?=[a-z0-9]*[a-z])[a-z0-9]{5,}$|^\d{6,}$/;

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const remote = process.env.CLAUDE_CODE_REMOTE === "true";
const notes = [];

function git(...args) {
  const res = spawnSync("git", args, { cwd: projectDir, encoding: "utf8" });
  return res.status === 0 ? res.stdout.trimEnd() : "";
}

function ensureIdentity() {
  const name = git("config", "user.name");
  const email = git("config", "user.email");
  const claudeLike = /claude|anthropic/i.test(`${name} ${email}`);
  if (name === OWNER_NAME && email === OWNER_EMAIL) return;
  if (!remote && !claudeLike && name && email) return;
  git("config", "user.name", OWNER_NAME);
  git("config", "user.email", OWNER_EMAIL);
  notes.push(
    `Git identity set to ${OWNER_NAME} <${OWNER_EMAIL}> for this repository (was "${name} <${email}>").`,
  );
}

function ensureDependencies() {
  if (!remote) return;
  if (
    !existsSync(join(projectDir, "package.json")) ||
    existsSync(join(projectDir, "node_modules"))
  )
    return;
  const res = spawnSync("npm", ["ci", "--no-audit", "--no-fund"], {
    cwd: projectDir,
    encoding: "utf8",
    timeout: 280_000,
  });
  notes.push(
    res.status === 0
      ? "Installed dependencies with npm ci (husky pre-commit hook active)."
      : `npm ci failed (exit ${res.status ?? "timeout"}); run it before validating.`,
  );
}

function branchWarning(branch) {
  if (!branch || branch === "HEAD")
    return "Detached HEAD: check out a ticket branch before editing.";
  if (branch === "main" || branch === "development")
    return `On ${branch}: hard rule 1 requires a new <type>/<two-or-three-words> branch off origin/main before any edit.`;
  const words = branch.split("/").slice(1).join("-").split("-");
  if (
    !BRANCH_RULE.test(branch) ||
    branch.startsWith("claude/") ||
    words.some((w) => HASH_LIKE.test(w))
  )
    return `Branch "${branch}" breaks hard rule 1 (<type>/<two-or-three-words>, no ids or hashes). Create a correctly named branch off origin/main before editing and never push this one.`;
  return "";
}

function planForBranch(branch) {
  const dir = join(projectDir, ".claude/plans");
  if (!branch || !existsSync(dir)) return "";
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".md"))) {
    const text = readFileSync(join(dir, file), "utf8");
    const escaped = branch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!new RegExp(`\\*\\*Branch:\\*\\* ${escaped}(?=\\s|$)`, "m").test(text))
      continue;
    const status =
      text.match(/\*\*Status:\*\*\s*([^\n]+)/)?.[1]?.trim() ?? "unknown";
    return `Plan for this branch: .claude/plans/${file} (Status: ${status}). Resume with /piv-run-full-loop.`;
  }
  return "";
}

function main() {
  ensureIdentity();
  ensureDependencies();
  const branch =
    git("rev-parse", "--abbrev-ref", "HEAD") ||
    git("symbolic-ref", "--short", "HEAD");
  const status = git("status", "--short").split("\n").filter(Boolean);
  const log = git("log", "-5", "--format=%h %s");
  const lines = [
    "Simple Manage Pro session context",
    `Branch: ${branch || "(none)"}`,
    branchWarning(branch),
    planForBranch(branch),
    status.length
      ? `Uncommitted changes (${status.length}):\n${status.slice(0, 15).join("\n")}${status.length > 15 ? "\n…" : ""}`
      : "Working tree clean.",
    log ? `Recent commits:\n${log}` : "",
    ...notes,
    "Process: docs/DEVELOPMENT_PROCESS.md · conventions: .claude/references/conventions.md",
  ].filter(Boolean);
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: lines.join("\n"),
      },
    }),
  );
}

try {
  main();
} catch (err) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: `Session-start hook error: ${err?.message ?? err}`,
      },
    }),
  );
}
