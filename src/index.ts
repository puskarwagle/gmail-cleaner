#!/usr/bin/env bun
/**
 * gmail-cleaner entry point.
 *
 * Thin routing only: parse argv → call one CLI command.
 * All business logic lives in src/core (pure) and src/gmail (I/O),
 * so a future web UI / mobile app can import those without touching this file.
 *
 * Usage (Bun only):
 *   bun run dev -- scan [--limit 100]
 *   bun run dev -- report
 *   bun run dev -- trash [--force-stale]
 *   bun run dev -- undo [--from reports/trash-....json]
 *   bun run dev -- maze [--port N] [--force-stale] [--no-open]
 */
import { mazeCommand } from "./cli/mazeCommand.ts";
import { reportCommand } from "./cli/reportCommand.ts";
import { scanCommand } from "./cli/scanCommand.ts";
import { trashCommand } from "./cli/trashCommand.ts";
import { undoCommand } from "./cli/undoCommand.ts";

function usage(): string {
  return `gmail-cleaner — dry-run first, trash only on explicit command.

Usage:
  bun run dev -- scan [--limit N]     Scan Inbox, write reports/latest.json (no trashing)
  bun run dev -- report               Show latest report + proposed actions
  bun run dev -- trash [--force-stale] Move trash candidates to Gmail Trash (asks YES)
  bun run dev -- undo [--from FILE]   Restore last trash run back to Inbox
  bun run dev -- maze [--port N] [--force-stale] [--no-open]
                                  Playable maze front end (local server + browser)`;
}

function flag(args: string[], ...names: string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    if (names.includes(args[i]!)) return args[i + 1];
  }
  return undefined;
}

function has(args: string[], ...names: string[]): boolean {
  return args.some((a) => names.includes(a));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const cmd = args[0];

  try {
    if (cmd === "scan") {
      const raw = flag(args, "--limit", "-l");
      const limit = raw == null ? null : Number.parseInt(raw, 10);
      if (raw != null && (!Number.isFinite(limit!) || limit! <= 0)) {
        throw new Error("--limit must be a positive integer");
      }
      await scanCommand(limit);
    } else if (cmd === "report") {
      await reportCommand();
    } else if (cmd === "trash") {
      await trashCommand({ forceStale: has(args, "--force-stale") });
    } else if (cmd === "undo") {
      await undoCommand(flag(args, "--from"));
    } else if (cmd === "maze") {
      const rawPort = flag(args, "--port");
      const port = rawPort == null ? undefined : Number.parseInt(rawPort, 10);
      if (rawPort != null && (!Number.isFinite(port!) || port! <= 0 || port! > 65535)) {
        throw new Error("--port must be a valid port number");
      }
      await mazeCommand({
        port,
        forceStale: has(args, "--force-stale"),
        open: !has(args, "--no-open"),
      });
    } else {
      console.log(usage());
      if (cmd !== undefined) process.exitCode = 2;
    }
  } catch (err) {
    console.error(`\nError: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

await main();
