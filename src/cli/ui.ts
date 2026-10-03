import type { ScanReport } from "../core/types.ts";
import { ALL_CATEGORIES } from "../core/summary.ts";
import { representativeExamples } from "../core/summary.ts";

const AUTOMATED_ORDER = [
  "github_notification",
  "newsletter",
  "marketing",
  "job_alert",
  "social_notification",
  "automated_notification",
] as const;

const PROTECTED_ORDER = ["account_security", "receipt", "human_personal", "uncertain"] as const;

const LABELS: Record<string, string> = {
  github_notification: "GitHub notifications",
  newsletter: "newsletters",
  marketing: "marketing",
  job_alert: "job alerts",
  social_notification: "social notifications",
  automated_notification: "other automated",
  account_security: "account/security",
  receipt: "receipts",
  human_personal: "personal/human",
  uncertain: "uncertain",
};

export function printSummary(report: ScanReport): void {
  const s = report.summary;
  console.log(`\nInbox scanned: ${report.scannedCount.toLocaleString()}`);
  console.log(`\nAutomated:`);
  for (const c of AUTOMATED_ORDER) {
    console.log(`  ${LABELS[c]}: ${(s[c] ?? 0).toLocaleString()}`);
  }
  console.log(`\nProtected (never auto-trashed):`);
  for (const c of PROTECTED_ORDER) {
    console.log(`  ${LABELS[c]}: ${(s[c] ?? 0).toLocaleString()}`);
  }
  console.log(`\nPotentially disposable: ${s.trashCandidates.toLocaleString()}`);
  void ALL_CATEGORIES;

  const examples = representativeExamples(report, 10);
  if (examples.length > 0) {
    console.log(`\nRepresentative examples:`);
    for (const e of examples) {
      console.log(`  [${e.classification.category}] ${truncate(e.from, 40)} — ${truncate(e.subject, 70)}`);
    }
  }
  console.log(`\nFull report: reports/latest.json`);
}

export function printProposedActions(report: ScanReport): void {
  const candidates = report.items.filter((i) => i.trashCandidate);
  console.log(`\nReport from: ${report.createdAt} (query: ${report.query})`);
  console.log(`Messages that would be moved to Trash: ${candidates.length.toLocaleString()}`);
  const bySender = new Map<string, number>();
  for (const c of candidates) bySender.set(c.from, (bySender.get(c.from) ?? 0) + 1);
  const top = [...bySender.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  if (top.length > 0) {
    console.log(`\nTop senders:`);
    for (const [from, n] of top) console.log(`  ${n}x ${truncate(from, 70)}`);
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

/** Prompt that only accepts exactly `YES`. Returns true iff confirmed. */
export async function askYes(): Promise<boolean> {
  process.stdout.write("Move these messages to Gmail Trash? Type YES to continue: ");
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
    if ((chunk as Buffer).includes("\n")) break;
  }
  return Buffer.concat(chunks).toString("utf8").trim() === "YES";
}
