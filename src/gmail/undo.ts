import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { TrashReport, UndoReport } from "../core/types.ts";
import { getAuthClient } from "./auth.ts";
import { gmail, untrashOne } from "./client.ts";
import { REPORTS_DIR } from "./scan.ts";

export interface UndoOptions {
  /** Defaults to the newest reports/trash-*.json */
  trashFile?: string;
  onProgress?: (done: number, total: number) => void;
}

export function newestTrashReport(): string {
  if (!existsSync(REPORTS_DIR)) throw new Error("No reports found. Nothing to undo.");
  const files = readdirSync(REPORTS_DIR)
    .filter((f) => f.startsWith("trash-") && f.endsWith(".json"))
    .sort();
  const latest = files.at(-1);
  if (!latest) throw new Error("No trash report found in reports/. Nothing to undo.");
  return join(REPORTS_DIR, latest);
}

/**
 * Restore messages from the last (or given) trash run back to Inbox.
 * Only touches IDs recorded in that audit file — never arbitrary messages.
 */
export async function runUndo(opts: UndoOptions): Promise<{ report: UndoReport; file: string }> {
  const trashFile = opts.trashFile ?? newestTrashReport();
  const trash = JSON.parse(readFileSync(trashFile, "utf8")) as TrashReport;
  const trashed = trash.records.filter((r) => r.success);

  const auth = await getAuthClient();
  const api = gmail(auth);

  const undo: UndoReport = {
    version: 1,
    createdAt: new Date().toISOString(),
    sourceTrashReport: trashFile,
    restoredCount: 0,
    records: [],
  };

  let done = 0;
  for (const rec of trashed) {
    try {
      await untrashOne(api, rec.id);
      undo.records.push({ ...rec, restored: true });
    } catch (err) {
      undo.records.push({
        ...rec,
        restored: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    done += 1;
    opts.onProgress?.(done, trashed.length);
  }
  undo.restoredCount = undo.records.filter((r) => r.restored).length;

  const stamp = undo.createdAt.replace(/[:.]/g, "-");
  const file = join(REPORTS_DIR, `undo-${stamp}.json`);
  writeFileSync(file, JSON.stringify(undo, null, 2));
  return { report: undo, file };
}
