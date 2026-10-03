import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { classify } from "../core/classifier.ts";
import { buildReport } from "../core/summary.ts";
import type { ScanReport } from "../core/types.ts";
import { getAuthClient } from "./auth.ts";
import { fetchMetas, gmail, listInboxIds } from "./client.ts";

export const REPORTS_DIR = join(process.cwd(), "reports");
export const LATEST_REPORT = join(REPORTS_DIR, "latest.json");

export interface ScanOptions {
  limit: number | null;
  query?: string;
}

/**
 * Scan pipeline (I/O layer). Pure classification lives in src/core.
 * Returns the report AND persists reports/latest.json. Never trashes anything.
 */
export async function runScan(opts: ScanOptions): Promise<ScanReport> {
  const auth = await getAuthClient();
  const api = gmail(auth);
  const query = opts.query ?? "in:inbox";

  const { ids, resultSizeEstimate } = await listInboxIds(api, { query, limit: opts.limit });
  const metas = await fetchMetas(api, ids);

  const items = metas.map((meta) => {
    const { category, confidence, reasons, trashCandidate } = classify(meta);
    return { ...meta, classification: { category, confidence, reasons }, trashCandidate };
  });

  const report = buildReport(items, {
    query,
    scannedCount: resultSizeEstimate ?? ids.length,
    limit: opts.limit,
  });

  mkdirSync(REPORTS_DIR, { recursive: true });
  writeFileSync(LATEST_REPORT, JSON.stringify(report, null, 2));
  return report;
}
