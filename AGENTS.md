# AGENTS.md — working rules for gmail-cleaner

Read this before writing code. `seed-prompt.md` is the product spec (frozen
unless the user changes it); this file is how we work day-to-day.

## Runtime: Bun, always

- **Strictly Bun.** `bun install`, `bun run dev -- …`, `bun test`, `bunx tsc --noEmit`.
- Never `npm`/`node`/`npx`/`ts-node`. If a doc says `npm`, fix the doc.
- Imports use explicit `.ts` extensions (Bun-style); `allowImportingTsExtensions`
  is set so `tsc --noEmit` stays clean.

## Architecture (CLI today, UI tomorrow)

```
src/core/    Pure logic. No I/O, no console, no googleapis.
             classifier.ts, types.ts, summary.ts
src/gmail/   Gmail I/O layer. Returns data, never prints.
             auth.ts, client.ts, scan.ts, trash.ts, undo.ts
src/web/     Maze HTTP layer (Bun.serve). Validates, never classifies/trashes itself:
             calls gmail/runTrash + runUndo only.
src/cli/     Thin presentation: commands + printing + stdin prompt + browser open.
src/index.ts Arg routing ONLY. No business logic here.
tests/       bun:test. Mirror src layout.
mail-maze.html  Single-file maze game (root). Live mode via /api/report, demo fallback via file://.
```

Rules:

- New reusable logic goes in `src/core/` (must stay importable by a future
  web/mobile UI without edits — no `process`, no `console`, no `fetch`).
- Gmail calls go in `src/gmail/`; they return values and take small `onProgress`
  callbacks instead of printing, so a UI can pass its own progress handler.
- `src/cli/` may print and read stdin, but must not contain classification or
  API logic — call `core`/`gmail` functions.
- `src/web/server.ts` is UI backend, not a bypass: it must re-read
  `reports/latest.json`, reject any non-`trashCandidate` ID server-side,
  enforce the 24 h stale guard (bypass only via `--force-stale` at server
  start), require `confirm === "YES"` on POST /api/trash, bind 127.0.0.1 with
  a per-launch token header + Host/Origin checks, and never accept the token
  via query string. Trash/undo only through `runTrash`/`runUndo`.
- Config endpoints (`/api/config/*`) must validate the credentials shape
  (`installed`/`web` + client_id/secret/redirect_uris, mirroring `auth.ts`),
  write `credentials.json` with mode 0600, and never return or log secrets.
  Maze settings are browser-localStorage only — the server never sees them.
- A future UI (`src/ui/` or separate app) replaces `src/cli/` only.

## Safety invariants (never break, never "improve" silently)

1. **Never** call `users.messages.delete` / permanent delete. Trash only.
2. **Never** send mail, edit filters/settings, or unsubscribe.
3. Scope stays `gmail.modify`. Don't widen it.
4. `scan` is read-only. First operation is always dry-run/report.
5. `trash` requires an existing fresh report, prints count + examples, and
   proceeds only on exactly `YES`.
6. `account_security`, `human_personal`, `uncertain`, `receipt` are **never**
   trash candidates — even if sender looks automated (`noreply@bank.com`).
7. Being automated alone ≠ trashable. `trashCandidate` derives only from the
   trashable category set in `classifier.ts`.
8. Never commit/print `credentials.json`, `token.json`, `.env`, tokens, or
   message bodies. Reports (`reports/*.json`) stay gitignored.

## Classifier changes

- Deterministic rules first; check protected categories
  (`account_security`, `receipt`) **before** generic automation signals.
- Single automation signal = `uncertain` (conservative). Require ≥2
  corroborating signals for `automated_notification`.
- Every behavior change needs a test in `tests/classifier.test.ts` using fake
  headers — follow the existing 6 seed cases + safety regression test.
- If you add a category, update: `Category` in `core/types.ts`, `TRASHABLE`
  (default: NOT trashable unless user approves), `summary.ts` labels,
  `cli/ui.ts` labels, and this file's list in codemap.

## Workflow

- Verify with: `bun test` and `bunx tsc --noEmit` (both must pass).
- Test Gmail flows with `--limit 10` first; never run `trash` against a real
  inbox during development without the user's explicit say-so.
- Don't add functionality beyond `seed-prompt.md` without asking the user.
- Docs live alongside code: update `README.md` (user-facing) and `codemap.md`
  (structure) when you change behavior or layout. `git_workflow.md`
  defines commit/PR conventions — follow it for every commit.

## Secrets & local files

- `credentials.json` (OAuth Desktop client, gitignored) and `token.json`
  (created on first auth, mode 0600) live in project root, never in code.
- `credentials.example.json` shows the expected shape — safe to commit.
- `reports/` holds `latest.json`, `trash-*.json`, `undo-*.json` — audit trail,
  gitignored, never delete casually during a trash/undo investigation.
