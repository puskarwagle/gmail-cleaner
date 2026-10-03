# gmail-cleaner

Your Gmail's 15 GB is full of automated junk. This tool finds it safely —
**dry-run report first, Trash only on explicit command, never permanent delete.**

> **Safety first:** `scan` never modifies anything. `trash` requires a fresh
> report, shows what will be moved, and only proceeds when you type exactly `YES`.
> Gmail Trash auto-deletes after 30 days; `undo` restores from the audit log.

## Quick start (Bun only)

```bash
bun install
# 1. put your OAuth Desktop credentials next to package.json as credentials.json
#    (see § Google Cloud setup below; credentials.example.json shows the shape)
bun run dev -- scan --limit 100   # dry-run on 100 mails, writes reports/latest.json
bun run dev -- report             # re-display latest report + proposed actions
bun run dev -- trash              # preview + YES-confirm + move to Trash
bun run dev -- undo               # restore last trash run back to Inbox
bun run dev -- maze               # playable maze front end (local server + browser)
```

Full scan: `bun run dev -- scan` (no `--limit`).

| Command | What it does | Touches Gmail? |
|---|---|---|
| `scan [--limit N]` | Reads Inbox metadata, classifies, writes `reports/latest.json` | Read-only |
| `report` | Prints latest report + proposed actions | No |
| `trash [--force-stale]` | Moves trash candidates to Trash after `YES` | Yes — Trash only |
| `undo [--from FILE]` | Restores IDs from newest (or given) `trash-*.json` to Inbox | Yes — Untrash only |
| `maze [--port N] [--force-stale] [--no-open]` | Playable maze front end over the latest report (trash/undo via the same guards) | Yes — Trash/untrash only, after in-maze `YES` |

Stale-report guard: `trash` refuses reports older than 24 h unless `--force-stale`.

## Google Cloud setup

1. **Create a project** at [Google Cloud Console](https://console.cloud.google.com/)
   → top bar → New Project (any name, e.g. `gmail-cleaner`).
2. **Enable the Gmail API:** APIs & Services → Library → search `Gmail API` → Enable.
3. **Configure OAuth consent screen:** APIs & Services → OAuth consent screen →
   User type **External** → fill app name + your email → add yourself as a
   **Test user** (your Gmail address). Scope `gmail.modify` is requested at runtime.
4. **Create credentials:** APIs & Services → Credentials → Create Credentials →
   **OAuth client ID** → Application type **Desktop app** (simplest) → Create.
   A **Web application** client works too — set its Authorised redirect URI to
   exactly `http://localhost:1013` (add a second entry with a trailing slash,
   `http://localhost:1013/`, if Google complains about mismatch).
5. **Download** the JSON, rename to `credentials.json`, place in project root
   (next to `package.json`). Never commit it — it's gitignored.
6. **First auth:** run `bun run dev -- scan --limit 10`. A browser window opens,
   you approve access, and `token.json` is saved locally (also gitignored).

## How dry-run works

`scan` lists Inbox IDs via `users.messages.list` (paginated, `in:inbox`),
fetches **metadata headers + snippet only** (no bodies/attachments), runs the
deterministic classifier in `src/core/classifier.ts`, and writes:

- `reports/latest.json` — every message: id, from, subject, category,
  confidence, reasons, `trashCandidate`.

Categories: `automated_notification`, `newsletter`, `marketing`, `job_alert`,
`github_notification`, `social_notification` (trashable) vs `receipt`,
`account_security`, `human_personal`, `uncertain` (**never** trashable —
protected even if the sender looks automated, e.g. `noreply@bank.com`).

## How trashing works

1. Requires `reports/latest.json` (fresh < 24 h or `--force-stale`).
2. Prints count + representative senders/subjects of trash candidates.
3. Asks `Move these messages to Gmail Trash? Type YES to continue:` —
   anything other than exactly `YES` aborts.
4. Calls `users.messages.trash` per ID (**never** `users.messages.delete`).
5. Writes `reports/trash-YYYY-MM-DD-HH-mm.json` audit log
   (message IDs, sender, subject, category, per-message result).

`undo` reads that audit file and calls `users.messages.untrash` +
re-adds the `INBOX` label, then writes `reports/undo-*.json`.

## Mail Maze front end

`bun run dev -- maze` starts a local server (default port `2733`) and opens
the first-person office floor game (`mail-maze.html`) in your browser, with
the envelopes fed by `reports/latest.json` — run `scan` first, the command
tells you so if no report exists. The world is an endless office floor:
straight 3/5-wide corridors, BSP offices, open-plan halls, atriums, doorways
with wood trim, carpet vs lino floors and ceiling light panels — generated
lazily from a random seed per session. The status bar shows live fps.

- Walk into envelopes to queue them. Trash candidates are normal envelopes;
  protected mail (receipts, security, personal, uncertain) is gold with a
  lock and can never be collected.
- Press `M` (or the **Map** button) for a bird's-eye view: walls, envelopes
  across the whole visible range (circle = trashable, gold square = protected)
  and your heading around your position. Press `B` (or **Big map**) for a
  fullscreen radius-60 version; `B`/`Esc` closes it.
- A compass pill and an on-screen dot point at the nearest uncollected mail
  with its distance, so you always know which way to turn.
- **Auto-walk** (`Space` or the button) seeks real mail: it paths to the
  nearest uncollected envelope, drives straight at anything in clear sight,
  and ignores a spot for 20 s after getting stuck on it twice instead of
  looping into the same wall.
- Gathering every trashable message raises an **Inbox clear** overlay with
  live progress (dismiss with **Keep walking** or go straight to review).
- **Review queue** opens the typed-`YES` dialog; confirming POSTs the queued
  IDs to the server, which re-reads `reports/latest.json` and rejects the
  whole request if any ID is not a trash candidate. Success/failure counts
  are shown per message.
- **Undo last** restores the last trash run via the same `runUndo` as the
  CLI and puts those envelopes back in the maze.
- The ⚙ button (or `/settings` with the same token) opens the settings page:
  a **Maze UI** tab (field of view, speeds, render quality, envelope density,
  wall theme, map size/range — applied live, stored in the browser only) and
  a **Gmail API** tab to upload `credentials.json` or paste the client
  fields (written locally with mode `0600`), check sign-in status, or revoke
  the local token. First Gmail access still goes through the Google consent
  screen on the next `scan`.
- The same 24 h stale-report guard applies; only `--force-stale` at server
  start bypasses it, never the browser. `POST /api/trash` additionally
  requires `confirm === "YES"` in the body.

Local-only security: the server binds `127.0.0.1`, generates a random token
per launch (embedded in the opened URL), requires it as the `x-maze-token`
header on every `/api` call, and checks `Host`/`Origin`. No CORS, no new
OAuth scopes, no body/attachment fetching, tokens are never logged.

Tip: opening `mail-maze.html` directly via `file://` still works — the game
falls back to built-in demo data when `/api/report` is unreachable.

## Revoking access

- **This app:** delete local `token.json` (and `credentials.json` if desired).
- **Google side:** https://myaccount.google.com/permissions → remove the app's
  `gmail.modify` access. Already-trashed mail stays in Trash until restored/expired.

## Security considerations

- OAuth scope is the minimum viable: `gmail.modify` (read + trash/untrash +
  label changes). No `gmail.settings.*`, no send scope.
- The app never sends mail, edits filters/settings, or unsubscribes.
- Only headers + snippet are fetched; bodies and attachments are never downloaded.
- Tokens are file-mode `0600`, never printed, never committed (see `.gitignore`).
- Reports contain senders/subjects → `reports/*.json` is gitignored too.
- Gmail Trash retention is 30 days — `undo` after that cannot restore.

## Scripts

```bash
bun test          # classifier unit tests (tests/)
bun run dev -- …  # CLI (scan | report | trash | undo)
bun run build:maze # rebuild mail-maze.html from src/web/maze/office-gen.ts
bunx tsc --noEmit # typecheck
```

## Future UI / mobile

Business logic is UI-agnostic on purpose: `src/core/` is pure functions
(classify, summarize, report building), `src/gmail/` exposes async data
functions (`runScan`, `runTrash`, `runUndo`). The maze front end (`src/web/` +
`mail-maze.html`, see § Mail Maze front end) is the first such UI — it calls
the same functions and only replaces `src/cli/` (printing + stdin prompt).
See `codemap.md` and `AGENTS.md`.
