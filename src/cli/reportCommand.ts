import { loadLatestReport } from "../gmail/trash.ts";
import { printProposedActions, printSummary } from "./ui.ts";

export async function reportCommand(): Promise<void> {
  const report = loadLatestReport();
  printSummary(report);
  printProposedActions(report);
}
