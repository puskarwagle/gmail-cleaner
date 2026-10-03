import type { Category, ClassifiedEmail, ScanReport, SummaryCounts } from "./types.ts";

export const ALL_CATEGORIES: Category[] = [
  "automated_notification",
  "newsletter",
  "marketing",
  "job_alert",
  "github_notification",
  "social_notification",
  "receipt",
  "account_security",
  "human_personal",
  "uncertain",
];

/** Pure summary builder — reused by CLI today, web/mobile UI tomorrow. */
export function summarize(items: ClassifiedEmail[]): SummaryCounts {
  const counts = Object.fromEntries(ALL_CATEGORIES.map((c) => [c, 0])) as Record<Category, number>;
  let trashCandidates = 0;
  for (const item of items) {
    counts[item.classification.category] += 1;
    if (item.trashCandidate) trashCandidates += 1;
  }
  return { ...counts, trashCandidates };
}

export function buildReport(
  items: ClassifiedEmail[],
  opts: { query: string; scannedCount: number; limit: number | null },
): ScanReport {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    query: opts.query,
    scannedCount: opts.scannedCount,
    limit: opts.limit,
    items,
    summary: summarize(items),
  };
}

/** First N trash candidates, for previews in CLI prompts and future UI. */
export function representativeExamples(report: ScanReport, n = 10): ClassifiedEmail[] {
  return report.items.filter((i) => i.trashCandidate).slice(0, n);
}
