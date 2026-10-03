import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ScanReport, TrashReport } from "../core/types.ts";
import { getAuthClient } from "./auth.ts";
import { gmail, trashOne } from "./client.ts";
import { LATEST_REPORT, REPORTS_DIR } from "./scan.ts";

export interface TrashOptions {
  /** Bypass the stale-report guard. Must be an explicit user flag. */
  forceStale?: boolean;
  /** Max age of latest.json before it counts as stale. Default 24h. */
  maxAgeMs?: number;
  /**
   * Optional subset of message IDs to trash (used by the maze web UI for the
   * reviewed queue). Defaults to all trash candidates. Every ID is still
   * filtered against trashCandidate, so callers cannot trash protected mail.
   */
  ids?: string[];
  onProgress?: (done: number, total: number) => void;
}

export function loadLatestReport(): ScanReport {
  if (!existsSync(LATEST_REPORT)) {
    throw new Error("No report found. Run `bun run dev -- scan` first (dry-run is mandatory).");
  }
  return JSON.parse(readFileSync(LATEST_REPORT, "utf8")) as ScanReport;
}

export function assertFresh(report: ScanReport, opts: TrashOptions): void {
  const maxAge = opts.maxAgeMs ?? 24 * 60 * 60 * 1000;
  const age = Date.now() - new Date(report.createdAt).getTime();
  if (age > maxAge && !opts.forceStale) {
    const hours = Math.round(age / 3_600_000);
    throw new Error(
      `Report is ~${hours}h old (created ${report.createdAt}). Re-run scan for a fresh dry-run, ` +
        `or pass --force-stale to override.`,
    );
  }
}

function trashFileName(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `trash-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}-${pad(d.getMinutes())}.json`;
}

/**
 * Move all trash candidates from the latest report to Gmail Trash.
 * Caller (CLI now, UI later) is responsible for the YES-confirmation + preview.
 */
export async function runTrash(opts: TrashOptions): Promise<{ report: TrashReport; file: string }> {
  const scanReport = loadLatestReport();
  assertFresh(scanReport, opts);

  const wanted = opts.ids == null ? null : new Set(opts.ids);
  const candidates = scanReport.items.filter((i) => i.trashCandidate && (wanted == null || wanted.has(i.id)));
  const auth = await getAuthClient();
  const api = gmail(auth);

  const trashReport: TrashReport = {
    version: 1,
    createdAt: new Date().toISOString(),
    sourceReportCreatedAt: scanReport.createdAt,
    trashedCount: 0,
    records: [],
  };

  let done = 0;
  for (const item of candidates) {
    try {
      await trashOne(api, item.id);
      trashReport.records.push({
        id: item.id,
        from: item.from,
        subject: item.subject,
        category: item.classification.category,
        success: true,
      });
    } catch (err) {
      trashReport.records.push({
        id: item.id,
        from: item.from,
        subject: item.subject,
        category: item.classification.category,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    done += 1;
    opts.onProgress?.(done, candidates.length);
  }
  trashReport.trashedCount = trashReport.records.filter((r) => r.success).length;

  mkdirSync(REPORTS_DIR, { recursive: true });
  const file = join(REPORTS_DIR, trashFileName());
  writeFileSync(file, JSON.stringify(trashReport, null, 2));
  return { report: trashReport, file };
}
