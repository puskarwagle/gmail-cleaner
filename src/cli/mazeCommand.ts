import { existsSync } from "node:fs";
import { LATEST_REPORT } from "../gmail/scan.ts";
import { startMazeServer } from "../web/server.ts";

export interface MazeCommandOptions {
  port?: number;
  forceStale?: boolean;
  /** Set false to skip opening the browser (prints the URL only). */
  open?: boolean;
}

function openBrowser(url: string): void {
  const cmd =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url];
  try {
    Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" });
  } catch {
    // Best-effort: the URL is printed below either way.
  }
}

export async function mazeCommand(opts: MazeCommandOptions = {}): Promise<void> {
  if (!existsSync(LATEST_REPORT)) {
    console.log("No report found at reports/latest.json.");
    console.log("Run `bun run dev -- scan --limit 100` first (dry-run), then `bun run dev -- maze`.");
    return;
  }
  const { url, port } = startMazeServer({
    port: opts.port,
    allowStale: opts.forceStale,
    // Browser open is presentation (CLI-only); the server itself stays UI-agnostic.
  });
  console.log(`\nMail Maze (local only, 127.0.0.1:${port}):`);
  console.log(`  ${url}`);
  console.log("Walk into envelopes to queue them, then Review + YES to trash. Press Ctrl+C to stop.");
  if (opts.open ?? true) openBrowser(url);
}
