import { loadLatestReport, runTrash } from "../gmail/trash.ts";
import { representativeExamples } from "../core/summary.ts";
import { askYes } from "./ui.ts";

export async function trashCommand(opts: { forceStale?: boolean }): Promise<void> {
  const report = loadLatestReport(); // throws if no dry-run exists
  const candidates = report.items.filter((i) => i.trashCandidate);

  if (candidates.length === 0) {
    console.log("Nothing to trash — no trash candidates in the latest report.");
    return;
  }

  console.log(`\nThis will move ${candidates.length} messages to Gmail Trash (reversible for 30 days).`);
  console.log(`Report created: ${report.createdAt}`);
  for (const e of representativeExamples(report, 10)) {
    console.log(`  [${e.classification.category}] ${e.from} — ${e.subject}`);
  }

  const confirmed = await askYes();
  if (!confirmed) {
    console.log("Aborted. Nothing was trashed.");
    return;
  }

  const { report: trashReport, file } = await runTrash({
    forceStale: opts.forceStale,
    onProgress: (done, total) => {
      if (done % 25 === 0 || done === total) console.log(`  …${done}/${total}`);
    },
  });
  console.log(`\nMoved ${trashReport.trashedCount}/${candidates.length} to Trash. Audit: ${file}`);
  const failures = trashReport.records.filter((r) => !r.success);
  if (failures.length > 0) {
    console.log(`${failures.length} failed (see audit file). First error: ${failures[0]!.error}`);
  }
}
