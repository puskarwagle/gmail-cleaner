import { runScan } from "../gmail/scan.ts";
import { printSummary } from "./ui.ts";

export async function scanCommand(limit: number | null): Promise<void> {
  console.log(limit == null ? "Scanning Inbox (dry-run, nothing will be trashed)…" : `Scanning first ${limit} Inbox messages (dry-run)…`);
  const report = await runScan({ limit });
  printSummary(report);
}
