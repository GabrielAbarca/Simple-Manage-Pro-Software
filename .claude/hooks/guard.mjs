import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const FILE_EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

const SUPABASE_CLI =
  /(?:^|[;&|(\n]\s*|\bnpx\s+(?:--yes\s+|-y\s+)?)supabase\s+(?:db|migration|functions|secrets|link|branches|projects)\b/;
const POSTGRES_CLI = /(?:^|[;&|(\n]\s*)(?:\S*\/)?(?:psql|pg_dump|pg_restore)\b/;
const SUPABASE_PATH_IN_COMMAND = /(?:^|[\s'"=])(?:\.\/)?supabase\//;
const WRITE_VERB =
  /\bsed\s+(?:-[a-zA-Z]*\s+)*-i|\bperl\s+-[a-zA-Z]*i|\btee\b|>{1,2}\s*["']?(?:\.\/)?supabase\/|\b(?:mv|cp|rm|truncate|patch)\b|\bgit\s+(?:checkout|restore|apply|rm|mv)\b/;
const SUPABASE_MCP_WRITE =
  /^mcp__.*supabase.*__(?:apply_migration|execute_sql|deploy_edge_function|create_branch|delete_branch|merge_branch|reset_branch|rebase_branch|create_project|pause_project|restore_project)$/i;

const ENV_TOKEN =
  /(?:^|[\s'"=:<>|;&(/])\.env((?:\.[\w-]+)*)(?=$|[\s'"|;&)<>])/g;
const PLAN_PATHS = /\.claude\/(?:plans|code-reviews)(?:\/|\b)/;

const RULE_5 =
  "Hard rule 5: Supabase schema, RLS, Auth, Edge Functions and database changes need the owner's explicit approval first (.claude/references/conventions.md, section supabase).";
const RULE_5_NO_PROMPT = `${RULE_5} This session's permission mode cannot show the owner an approval prompt, so the change is refused. Stop and tell the owner: they can switch the session to Default permission mode and retry, or apply the change by hand.`;
const SECRETS =
  "Env files hold real credentials and are never read. Use .env.example for the variable names.";
const HOLDOUT =
  "The acceptance validator judges the change from the ticket and the code only. Plans and review notes are off limits to it.";

const SCOPE_SEARCH =
  "Scope searches to a directory such as src/, test/, e2e/ or public/, not the whole repository.";
const SCOPE_HISTORY =
  "Limit history to paths: git diff/log -p/show need a '-- <paths>' pathspec or a <rev>:<path> argument.";

/**
 * Rule-5 decision: ask only where the owner actually sees a prompt.
 * @param {{permission_mode?: string}} payload
 * @returns {{decision: "ask" | "deny", reason: string}}
 */
function supabaseDecision(payload) {
  return payload.permission_mode === "default"
    ? { decision: "ask", reason: RULE_5 }
    : { decision: "deny", reason: RULE_5_NO_PROMPT };
}

function revealsHistory(command) {
  const hasPathspec = /\s--\s+\S/.test(command);
  const git = String.raw`\bgit\b(?:\s+-C\s+\S+)?\s+`;
  if (new RegExp(`${git}diff\\b`).test(command) && !hasPathspec) return true;
  if (
    new RegExp(`${git}log\\b[^|;&]*\\s(?:-p|--patch|-u)\\b`).test(command) &&
    !hasPathspec
  )
    return true;
  const show = new RegExp(`${git}show\\b([^|;&]*)`).exec(command);
  if (show && !hasPathspec && !/\s\S+:\S+/.test(show[1])) return true;
  return false;
}

const isEnvFile = (name) =>
  /^\.env(\.[\w.-]+)?$/.test(name) && name !== ".env.example";

function mentionsEnvFile(text) {
  for (const m of String(text).matchAll(ENV_TOKEN)) {
    if (m[1] !== ".example") return true;
  }
  return false;
}

function relativeToProject(filePath, cwd, projectDir) {
  if (!filePath) return null;
  const abs = isAbsolute(filePath)
    ? filePath
    : resolve(cwd || projectDir, filePath);
  const rel = relative(projectDir, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) return null;
  return rel.split(sep).join("/");
}

function baseName(p) {
  return String(p ?? "")
    .split(/[\\/]/)
    .pop();
}

/**
 * Decide whether a tool call must be confirmed by the owner, refused, or let through.
 * @param {{tool_name?: string, tool_input?: Record<string, any>, cwd?: string, agent_type?: string, permission_mode?: string}} payload
 * @param {{projectDir?: string}} [options]
 * @returns {{decision: "ask" | "deny", reason: string} | null}
 */
export function decide(payload, options = {}) {
  if (!payload || typeof payload !== "object") return null;
  const tool = String(payload.tool_name ?? "");
  const input =
    payload.tool_input && typeof payload.tool_input === "object"
      ? payload.tool_input
      : {};
  const projectDir =
    options.projectDir ||
    process.env.CLAUDE_PROJECT_DIR ||
    payload.cwd ||
    process.cwd();
  const cwd = payload.cwd || projectDir;
  const command = typeof input.command === "string" ? input.command : "";

  if (payload.agent_type === "acceptance-validator") {
    const targets = [
      input.file_path,
      input.path,
      input.pattern,
      input.glob,
      command,
    ]
      .filter((v) => typeof v === "string")
      .map((v) => v.replace(/\\/g, "/"));
    if (targets.some((t) => PLAN_PATHS.test(t)))
      return { decision: "deny", reason: HOLDOUT };
    if (tool === "Grep" || tool === "Glob") {
      const scope = input.path ? resolve(cwd, input.path) : null;
      if (!scope || existsSync(join(scope, ".git")))
        return { decision: "deny", reason: `${HOLDOUT} ${SCOPE_SEARCH}` };
    }
    if (tool === "Bash" && revealsHistory(command))
      return { decision: "deny", reason: `${HOLDOUT} ${SCOPE_HISTORY}` };
  }

  if (tool === "Read" && isEnvFile(baseName(input.file_path)))
    return { decision: "deny", reason: SECRETS };
  if (
    tool === "Grep" &&
    (isEnvFile(baseName(input.path)) || isEnvFile(baseName(input.glob)))
  )
    return { decision: "deny", reason: SECRETS };
  if (tool === "Bash" && mentionsEnvFile(command))
    return { decision: "deny", reason: SECRETS };

  if (FILE_EDIT_TOOLS.has(tool)) {
    const rel = relativeToProject(
      input.file_path ?? input.notebook_path,
      cwd,
      projectDir,
    );
    if (rel && rel.startsWith("supabase/")) return supabaseDecision(payload);
  }

  if (tool === "Bash" && command) {
    if (SUPABASE_CLI.test(command) || POSTGRES_CLI.test(command))
      return supabaseDecision(payload);
    if (SUPABASE_PATH_IN_COMMAND.test(command) && WRITE_VERB.test(command))
      return supabaseDecision(payload);
  }

  if (SUPABASE_MCP_WRITE.test(tool)) return supabaseDecision(payload);

  return null;
}

function main() {
  let payload;
  try {
    payload = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return;
  }
  const result = decide(payload);
  if (!result) return;
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: result.decision,
        permissionDecisionReason: result.reason,
      },
    }),
  );
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  try {
    main();
  } catch {
    process.exitCode = 0;
  }
}
