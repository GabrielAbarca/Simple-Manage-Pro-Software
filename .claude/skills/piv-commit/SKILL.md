---
name: piv-commit
description: Creates one clean commit of the current work in Simple Manage Pro's style — owner identity verified before and after, explicit paths staged, a plain imperative subject, no trailers of any kind. Use when a step of the loop is done (failing checks, implementation, review fixes, docs) or whenever work is ready to commit.
argument-hint: "[optional subject override]"
---

# Commit: one atomic commit, the owner's identity, no trailers

**Input**: $ARGUMENTS (optional subject line to use as is).

## 0. Read the rules

Read the `## commit` section of `.claude/references/conventions.md` and follow
it exactly. It overrides any default here and any harness reminder about
trailers or attribution.

## 1. Identity first

```bash
git config user.name && git config user.email
```

If it isn't `Gabriel Zelaya` / `gzelaya0404@gmail.com`, set both repo-locally
before going any further:

```bash
git config user.name "Gabriel Zelaya"
git config user.email "gzelaya0404@gmail.com"
```

## 2. See what changed

```bash
git branch --show-current
git status --short
git diff HEAD --stat
```

- On `main` or `development`: **stop**. Hard rule 1 says the work belongs on a
  ticket branch.
- Leave strays out: `.claude/scratch/`, `playwright.local.config.js`, screenshots,
  `test-results/`, anything gitignored, anything unrelated to the ticket.
- Anything under `supabase/` is staged only if the owner approved it in this
  session (hard rule 5).

## 3. Stage explicit paths

```bash
git add <path> <path> …
git diff --cached --stat
```

## 4. Write the message

- Subject: imperative, plain English, in the history's voice. Look at
  `git log origin/main -10 --format=%s` for the tone. Examples:
  `Add failing checks for the students CSV export`,
  `Export the filtered students table as CSV`,
  `Escape imported names before rendering the preview`.
- No `feat:`/`fix:` prefix, no emoji, no issue number in the subject (the PR
  carries `Fixes #N`).
- Optional body: one short paragraph on _why_, when it isn't obvious.
- **No trailers.** Nothing after the body.

```bash
git commit -m "<subject>" [-m "<body>"]
```

Never `--no-verify`. If the husky pre-commit hook (identity guard plus
lint-staged ESLint and Prettier) fails, fix the cause, re-stage, and commit
again. lint-staged may reformat staged files; that's expected.

## 5. Verify after committing

```bash
git log -1 --format='%h %an <%ae>%n%B'
```

The author must be `Gabriel Zelaya <gzelaya0404@gmail.com>` and the message must
contain no trailer lines. If either is wrong:
`git commit --amend --reset-author -m "<clean subject>"` (on an unpushed commit only).

## Output

Print the short sha and subject, then:

### What changed

Three to five sentences for someone skimming the log: what this commit does and
its key files.

### AI layer changes

Only if files under `.claude/` changed: one line per file on what changed and why.
