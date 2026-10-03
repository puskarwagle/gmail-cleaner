import { runUndo, newestTrashReport } from "../gmail/undo.ts";

export async function undoCommand(trashFile?: string): Promise<void> {
  const file = trashFile ?? newestTrashReport();
  console.log(`Restoring messages recorded in ${file} back to Inbox…`);
  const { report, file: outFile } = await runUndo({
    trashFile: file,
    onProgress: (done, total) => {
      if (done % 25 === 0 || done === total) console.log(`  …${done}/${total}`);
    },
  });
  console.log(`Restored ${report.restoredCount}/${report.records.length}. Audit: ${outFile}`);
}
