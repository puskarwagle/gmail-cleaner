# codemap.md — gmail-cleaner structure

```
gmail-cleaner/
├── src/
│   ├── index.ts              entry: argv routing only (scan|report|trash|undo|maze, --limit, --force-stale, --from, --port, --no-open)
│   ├── core/                 PURE, UI-agnostic (no I/O, no console, no googleapis)
│   │   ├── types.ts          Category, EmailMeta, ClassifiedEmail, ScanReport, TrashReport, UndoReport
│   │   ├── classifier.ts     classify(meta) → { category, confidence, reasons, trashCandidate }
│   │   │                     TRASHABLE set = the 6 disposable categories; protected 4 never trashable
│   │   └── summary.ts        summarize(), buildReport(), representativeExamples()
│   ├── gmail/                I/O layer: async data functions, never print
│   │   ├── auth.ts           Desktop OAuth (gmail.modify); credentials.json → token.json (0600)
│   │   ├── client.ts         listInboxIds (pagination), fetchMeta(s) (metadata-only), trashOne, untrashOne
│   │   ├── scan.ts           runScan({limit}) → ScanReport + writes reports/latest.json
│   │   ├── trash.ts          loadLatestReport, assertFresh (24h), runTrash({ids?}) → reports/trash-*.json
│   │   │                     (ids = optional reviewed subset; still filtered by trashCandidate)
│   │   └── undo.ts           newestTrashReport, runUndo() → reports/undo-*.json
│   ├── web/                  maze HTTP layer (Bun.serve, 127.0.0.1 + per-launch token, no CORS)
│   │   ├── server.ts         createMazeHandler (testable routes), startMazeServer;
│   │   │                     GET / (maze html), GET /settings, GET /api/report,
│   │   │                     POST /api/trash {ids, confirm:YES}, POST /api/undo,
│   │   │                     GET /api/config, POST /api/config/credentials,
│   │   │                     POST /api/config/revoke. Server re-checks every ID
│   │   │                     against latest.json; credentials validated + 0600.
│   │   └── settings.html     settings page: Maze UI tab (autosaved localStorage,
│   │                         live) + Last trash run (undo) + Gmail API tab
│   │                         (upload/paste credentials, status, revoke); Esc → maze
│   │   └── maze/               maze game sources (pure, no DOM except via main — future split)
│   │       └── office-gen.ts   pure office generator (SUPER/genSuper/buildArea/astar/
│   │                             losClear/pull/mailSpots); single source of truth for
│   │                             the html block below
│   │       └── game.ts         player/queue state + autopilot (mail-seeking A*,
│   │                             LOS direct-homing <9 m, alignment-scaled drive,
│   │                             stuck blacklist, inbox-clear progress),
│   │                             pickup streak + fly fx, run stats
│   │                             (timer/distance/per-category), fog-of-war
│   │                             seen set, sfx hooks
│   │       └── audio.ts        synthesized WebAudio SFX (pickup/keep/trash/clear);
│   │                             honours SET.sound, no-op outside a browser
│   │       └── render.ts       raycaster + envelopes + fly-to-crosshair pickups
│   │                             + fog-gated minimap/big-map + fx pops
│   └── cli/                  presentation only (may print / read stdin / open browser)
│       ├── scanCommand.ts    → runScan + printSummary
│       ├── reportCommand.ts  → loadLatestReport + printSummary + printProposedActions
│       ├── trashCommand.ts   → preview + askYes + runTrash
│       ├── undoCommand.ts    → runUndo
│       ├── mazeCommand.ts    → needs reports/latest.json + startMazeServer + open browser
│       └── ui.ts             printSummary, printProposedActions, askYes (exactly YES)
├── mail-maze.html            single-file OFFICE FLOOR game (GENERATED — do not hand-edit;
│                             run `bun run build:maze`); live mode via /api/report (token header),
│                             demo fallback when opened via file://; always-on fog-of-war
│                             minimap (click opens the fullscreen radius-60 map with an
│                             explored % + best-time footer), nearest-mail compass
│                             + mail-seeking autopilot, pickup pops + fly fx +
│                             streak/timer status, sound effects, inbox-clear
│                             overlay (run stats + personal best in localStorage),
│                             live settings via localStorage (SET + storage events).
│                             Pure generator block (OFFICE-GEN-BEGIN/END) is transpiled
│                             from src/web/maze/office-gen.ts: 40x40-tile
│                             super-cells, corridor bands (5-wide mains / 3-wide sides),
│                             BSP offices / open-plan halls / atriums, doorways, A* +
│                             string-pull autopilot, hash-based mail spots. Tests import
│                             the TS module directly (tests/office.test.ts).
├── scripts/
│   └── build-maze.ts         transpiles office-gen.ts → injects into mail-maze.html
│                             (`bun run build:maze`, `--check` for CI drift detection)
├── tests/
│   └── classifier.test.ts    6 seed cases + noreply-bank safety regression (bun:test)
│   └── office.test.ts        office generator (imports src/web/maze/office-gen.ts directly):
│                             determinism, corridor seams, room sizes,
│                             per-super-cell doors, 5x5 flood-fill connectivity (several
│                             seeds), mail placement, A* + string-pull (bun:test)
│   └── mazeServer.test.ts    /api/trash + /api/undo guards: non-candidate/confirm/token/stale (bun:test)
│   └── mazeConfig.test.ts    /settings + /api/config: validation, 0600 write, revoke (bun:test)
│   └── auto.test.ts          autopilot: mail-seeking pickup, faced-away steering,
│                             guide target preference, 60 s roam (bun:test)
│   └── juice.test.ts         pickup streak + fly fx, fog exploration, run stats (bun:test)
├── reports/                  gitignored audit trail (latest.json, trash-*.json, undo-*.json)
├── credentials.example.json  committed shape reference (real credentials.json is gitignored)
├── seed-prompt.md            frozen product spec
├── AGENTS.md                 day-to-day working rules for coding agents
├── README.md                 user-facing setup + safety docs
└── git_workflow.md           commit/PR conventions for coding agents
```

## Data flow

```
scan:   Gmail API → client.fetchMetas → classifier.classify → summary.buildReport → reports/latest.json
report: reports/latest.json → cli/ui print (no API)
trash:  reports/latest.json → preview → YES → client.trashOne × N → reports/trash-*.json
undo:   reports/trash-*.json → client.untrashOne × N (+INBOX) → reports/undo-*.json
maze:   reports/latest.json → web/server (/api/report) → mail-maze.html envelopes
        → review + YES → server re-checks IDs → runTrash(ids) → reports/trash-*.json
        → settings "Undo last trash run" → runUndo() → messages back in the Inbox
```

## UI-ready seams (for future web/mobile)

- `core/` imports nothing outside itself — drop into any TS app as-is.
- `gmail/runScan|runTrash|runUndo` return plain data + accept `onProgress`
  callbacks; a UI passes its own progress bar instead of console logs.
- `web/server.ts` is the first such UI backend: it calls `gmail/` only
  (never reimplements trash/undo) and re-validates every browser-supplied ID
  against `reports/latest.json` before delegating.
- Only `cli/` + `index.ts` are CLI-specific; a UI replaces those files,
  keeps `core/` + `gmail/` untouched.
- Protected categories and the `YES` gate live in `core`/`gmail` semantics
  (not in `cli` text), so a UI inherits the same safety by construction —
  it must still implement its own explicit confirmation step.
