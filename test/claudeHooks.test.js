import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = resolve(import.meta.dirname, "..");
const GUARD = join(ROOT, ".claude/hooks/guard.mjs");
const SESSION_START = join(ROOT, ".claude/hooks/session-start.mjs");

let decide;

beforeAll(async () => {
  ({ decide } = await import(pathToFileURL(GUARD).href));
});

const call = (tool_name, tool_input, extra = {}) =>
  decide(
    {
      tool_name,
      tool_input,
      cwd: ROOT,
      hook_event_name: "PreToolUse",
      ...extra,
    },
    { projectDir: ROOT },
  );

describe("guard hook: Supabase changes need the owner's approval", () => {
  it.each([
    ["Edit", { file_path: join(ROOT, "supabase/schema/school_schema.sql") }],
    ["Write", { file_path: "supabase/schema/incremental_new.sql" }],
    [
      "MultiEdit",
      { file_path: join(ROOT, "supabase/functions/admin-users/index.ts") },
    ],
  ])("asks before %s under supabase/", (tool, input) => {
    expect(call(tool, input)?.decision).toBe("ask");
  });

  it.each([
    "npx supabase db push",
    "supabase migration new add_table",
    "npm run build && npx supabase functions deploy admin-users",
    'psql "$DATABASE_URL" -f supabase/schema/rls_audit.sql',
    "pg_dump -Fc mydb > backup.dump",
    "sed -i 's/a/b/' supabase/schema/school_schema.sql",
  ])("asks before the database-changing command: %s", (command) => {
    expect(call("Bash", { command })?.decision).toBe("ask");
  });

  it.each([
    "mcp__supabase__apply_migration",
    "mcp__supabase__execute_sql",
    "mcp__Supabase__deploy_edge_function",
    "mcp__plugin_db_supabase__merge_branch",
  ])("asks before the Supabase MCP write tool %s", (tool) => {
    expect(call(tool, {})?.decision).toBe("ask");
  });

  it.each([
    ["Edit", { file_path: join(ROOT, "src/js/ui.js") }],
    ["Read", { file_path: join(ROOT, "supabase/schema/school_schema.sql") }],
    ["Bash", { command: "npm test" }],
    ["Bash", { command: "cat supabase/schema/school_schema.sql" }],
    ["Bash", { command: 'grep -rn "import.meta.env" src/js' }],
    ["mcp__supabase__list_tables", {}],
    ["mcp__github__issue_read", { issue_number: 1 }],
  ])("allows %s that changes nothing in Supabase", (tool, input) => {
    expect(call(tool, input)).toBeNull();
  });
});

describe("guard hook: secrets stay unread", () => {
  it.each([
    ["Read", { file_path: join(ROOT, ".env") }],
    ["Read", { file_path: ".env.local" }],
    ["Grep", { pattern: "KEY", path: ".env.production" }],
    ["Bash", { command: "cat .env" }],
    ["Bash", { command: "source ./.env.local && npm run dev" }],
  ])("denies %s on an env file", (tool, input) => {
    expect(call(tool, input)?.decision).toBe("deny");
  });

  it.each([
    ["Read", { file_path: join(ROOT, ".env.example") }],
    ["Bash", { command: "cat .env.example" }],
    ["Bash", { command: "grep -rn process.env vite.config.js" }],
  ])(
    "allows %s on the committed example or env references in code",
    (tool, input) => {
      expect(call(tool, input)).toBeNull();
    },
  );
});

describe("guard hook: the acceptance validator never sees the plan", () => {
  const asValidator = { agent_type: "acceptance-validator", agent_id: "a1" };

  it.each([
    ["Read", { file_path: join(ROOT, ".claude/plans/12-students-export.md") }],
    ["Grep", { pattern: "AC1", path: ".claude/plans" }],
    ["Glob", { pattern: ".claude/code-reviews/**" }],
    ["Bash", { command: "cat .claude/plans/*.md" }],
  ])("denies %s on plans and reviews for the validator", (tool, input) => {
    expect(call(tool, input, asValidator)?.decision).toBe("deny");
  });

  it("lets the validator read source and tests", () => {
    expect(
      call("Read", { file_path: join(ROOT, "src/js/csv.js") }, asValidator),
    ).toBeNull();
  });

  it("lets every other agent read plans", () => {
    const input = {
      file_path: join(ROOT, ".claude/plans/12-students-export.md"),
    };
    expect(call("Read", input)).toBeNull();
    expect(call("Read", input, { agent_type: "code-reviewer" })).toBeNull();
  });
});

describe("guard hook: command-line contract", () => {
  const run = (input) =>
    spawnSync(process.execPath, [GUARD], {
      input,
      encoding: "utf8",
      env: { ...process.env, CLAUDE_PROJECT_DIR: ROOT },
    });

  it("prints a PreToolUse decision nested in hookSpecificOutput", () => {
    const res = run(
      JSON.stringify({
        tool_name: "Edit",
        tool_input: {
          file_path: join(ROOT, "supabase/schema/school_schema.sql"),
        },
        cwd: ROOT,
      }),
    );
    expect(res.status).toBe(0);
    const out = JSON.parse(res.stdout).hookSpecificOutput;
    expect(out.hookEventName).toBe("PreToolUse");
    expect(out.permissionDecision).toBe("ask");
    expect(out.permissionDecisionReason).toMatch(/rule 5/i);
  });

  it("stays silent for an allowed call", () => {
    const res = run(
      JSON.stringify({
        tool_name: "Bash",
        tool_input: { command: "ls" },
        cwd: ROOT,
      }),
    );
    expect(res.status).toBe(0);
    expect(res.stdout.trim()).toBe("");
  });

  it("fails open on malformed input", () => {
    const res = run("not json");
    expect(res.status).toBe(0);
    expect(res.stdout.trim()).toBe("");
  });
});

describe("session-start hook", () => {
  let repo;
  const git = (...args) =>
    execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), "smp-session-start-"));
    git("init", "-q", "-b", "claude/some-task-a1b2c3");
    git("config", "user.name", "Claude");
    git("config", "user.email", "noreply@anthropic.com");
  });

  afterAll(() => rmSync(repo, { recursive: true, force: true }));

  it("fixes a Claude identity, skips install without package.json, and reports the branch", () => {
    const res = spawnSync(process.execPath, [SESSION_START], {
      cwd: repo,
      input: JSON.stringify({
        hook_event_name: "SessionStart",
        source: "startup",
        cwd: repo,
      }),
      encoding: "utf8",
      env: {
        ...process.env,
        CLAUDE_PROJECT_DIR: repo,
        CLAUDE_CODE_REMOTE: "true",
      },
    });
    expect(res.status).toBe(0);
    expect(git("config", "user.name")).toBe("Gabriel Zelaya");
    expect(git("config", "user.email")).toBe("gzelaya0404@gmail.com");
    expect(existsSync(join(repo, "node_modules"))).toBe(false);
    const out = JSON.parse(res.stdout).hookSpecificOutput;
    expect(out.hookEventName).toBe("SessionStart");
    expect(out.additionalContext).toContain("claude/some-task-a1b2c3");
    expect(out.additionalContext).toMatch(/rule 1/i);
  });
});

describe("project settings wire both hooks", () => {
  const settings = JSON.parse(
    readFileSync(join(ROOT, ".claude/settings.json"), "utf8"),
  );
  const commands = (event) =>
    (settings.hooks?.[event] ?? []).flatMap((m) =>
      m.hooks.map((h) => h.command),
    );

  it("runs session-start.mjs on SessionStart and guard.mjs on PreToolUse", () => {
    expect(commands("SessionStart").join(" ")).toContain(
      ".claude/hooks/session-start.mjs",
    );
    expect(commands("PreToolUse").join(" ")).toContain(
      ".claude/hooks/guard.mjs",
    );
  });

  it("hides Claude attribution in commits and PRs", () => {
    expect(settings.attribution).toMatchObject({
      commit: "",
      pr: "",
      sessionUrl: false,
    });
  });
});
