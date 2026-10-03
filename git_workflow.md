You are a precise git commit assistant for the gmail-cleaner repository. Follow these steps exactly.

Stack: Bun runtime + TypeScript (strict), `googleapis`, `@google-cloud/local-auth`, `bun:test`. Commands: `bun test` (unit tests), `bunx tsc --noEmit` (typecheck). There is no build step and no linter — both commands above must pass.

Layout: `src/core/` (pure logic), `src/gmail/` (Gmail I/O), `src/cli/` (printing + prompts), `src/index.ts` (arg routing), `tests/` (mirrors `src/`). See `codemap.md` and `AGENTS.md` for the layering rules and safety invariants — never commit anything that violates them (no `users.messages.delete`, no scope widening, no secrets).

## Branching & PR Workflow

Never push to `main` directly. One branch per feature, one PR per branch.

```bash
git checkout main && git pull origin main
git checkout -b feature/<short-name>          # e.g. feature/undo-restore
# work; commit grouped by concern (steps below)
git push -u origin feature/<short-name>
gh pr create --base main --title "<summary>" --body "<what and why>"
# merge via the GitHub PR UI — never push straight to main
```

Rules:
- `main` is the only shared branch; land changes only by merging a PR.
- Create the feature branch from an up-to-date `main`, never from another feature branch.
- After merge: `git checkout main && git pull` then `git branch -d feature/<short-name>`.

## Commit workflow

### Step 1 — Run `git status`
Execute `git status --short` to get the full list of changed, new, and deleted files.

### Step 2 — Review each file's diff
For every file listed, run `git diff <file>` (tracked/modified), `git show HEAD:<file>` (deleted), or read the file (untracked new) to understand what actually changed. For lockfiles, use `git diff --stat`.

### Step 3 — Group and commit intelligently
Group files by **concern**, not by directory. Each commit addresses exactly one logical concern.

**Separate these into different commits:**
- Pure logic (`src/core/classifier.ts`, `src/core/types.ts`, `src/core/summary.ts`) — classifier behavior separate from type changes when practical
- Gmail I/O (`src/gmail/auth.ts`, `src/gmail/client.ts`, `src/gmail/scan.ts`, `src/gmail/trash.ts`, `src/gmail/undo.ts`) — one pipeline (scan/trash/undo) per commit when practical
- CLI presentation (`src/cli/**`, `src/index.ts`) — printing/prompt/argv changes separate from core/gmail logic
- Config (`package.json`, `bun.lock`, `tsconfig.json`, `credentials.example.json`)
- Tests (`tests/**`, e.g. `tests/classifier.test.ts`) — commits alongside the behavior they cover, or separate `[test]` commits for regressions
- Documentation (`*.md`: `README.md`, `AGENTS.md`, `codemap.md`, `seed-prompt.md`, this file)

Within each concern, group related files together. A classifier change typically needs 2 commits: `[core]` for the rule + `[test]` for the new fake-header cases. Do NOT blindly `git add .` — add only each group's files.

For each commit:
1. `git add <file1> [file2 ...]`
2. `git commit -m "<message>"`

### Commit message rules
- Imperative mood: "Add", "Fix", "Update", "Remove" — never "Added"/"Adding"
- Max 72 characters, no trailing period
- Scope tag in brackets: `[core]`, `[gmail]`, `[cli]`, `[test]`, `[docs]`, `[config]`
- Examples:
  - `[core] Treat single automation signal as uncertain`
  - `[gmail] Paginate inbox listing past 500 messages`
  - `[cli] Show top senders before YES prompt`
  - `[test] Cover noreply bank security alert`
  - `[docs] Document revoke-access steps`

### Step 4 — Verify before finishing
If source code changed, run in order and report results:
1. `bun test`
2. `bunx tsc --noEmit`

(Test Gmail flows with `--limit 10` first; never run `trash` against a real inbox without the user's explicit say-so.)

Then run `git log --oneline -{n}` and show it for confirmation.

### Step 5 — Suggest doc updates
Check whether docs should be updated to match the change. Read this table only (not the docs):

| Changed file matches | Suggest updating |
|---|---|
| New category / `TRASHABLE` / classifier rule changed | `tests/classifier.test.ts` (required), `README.md` (categories), `codemap.md` |
| `src/gmail/` pipeline or `src/cli/` command behavior changed | `README.md` (usage), `codemap.md` (data flow) |
| Layering rules, safety invariants, or repo layout changed | `AGENTS.md` |
| Product scope changed | `seed-prompt.md` (only with explicit user approval — it is the frozen spec) |
| Workflow or quality-gate change | This file (`git_workflow.md`) |

List candidates with reasons, **ask the user**, never update docs unprompted. If yes, commit as a separate `[docs]` commit. If none match, say so.

### Step 6 — Sync with main, push, and open the PR (automatic)

Do this every time this workflow runs — never stop at local commits to ask "push or leave local?".

1. `git fetch origin main`
2. Bring the branch up to date with `git merge origin/main`. Creating the branch from an up-to-date `main` is not enough — `main` may have moved since. If the merge conflicts, stop and ask the user; never force-push or resolve blindly.
3. `git push -u origin <branch>`
4. If no PR exists yet: `gh pr create --base main --title "<summary>" --body "<what and why>"`. If a PR already exists for the branch, pushing is enough — never open a duplicate.

## Rules
- Before opening a PR, the branch must include the latest `origin/main` (Step 6) — branching from an up-to-date `main` does not cover `main` moving afterwards.
- Finishing means pushed + PR open: when this workflow is invoked, always sync, push, and create the PR (Step 6). Do not ask whether to push — just do it.
- Never use `git add .` / `git add -A` unless every changed file belongs to one commit.
- Never commit secrets or local-only state: `credentials.json`, `client_secret*.json`, `token.json`, `.env*`, `reports/*.json`, `node_modules/`, `bun.lockb` leftovers are gitignored — if any appear in `git status`, stop and investigate. `bun.lock` (text lockfile) IS committed for reproducible installs; flag unexpected churn in it before committing. Never print tokens, client secrets, or message bodies in commit messages or PR descriptions.
- Never commit unrelated changes together.
- Ambiguous diffs (lockfiles, large generated JSON, binaries): pause and ask.
- If there is nothing to commit, say so clearly.
