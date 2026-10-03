/**
 * Core domain types.
 *
 * RULE: this module has zero I/O, zero console output, zero Gmail imports.
 * It must stay importable by a future web UI / mobile app without changes.
 */

export type Category =
  | "automated_notification"
  | "newsletter"
  | "marketing"
  | "job_alert"
  | "github_notification"
  | "social_notification"
  | "receipt"
  | "account_security"
  | "human_personal"
  | "uncertain";

export interface Classification {
  category: Category;
  /** 0..1 heuristic confidence */
  confidence: number;
  reasons: string[];
}

/** Minimal email metadata needed for classification. No bodies. */
export interface EmailMeta {
  id: string;
  threadId?: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  messageId?: string;
  listUnsubscribe?: string;
  precedence?: string;
  autoSubmitted?: string;
  replyTo?: string;
  sender?: string;
  snippet?: string;
  labelIds?: string[];
}

export interface ClassifiedEmail extends EmailMeta {
  classification: Classification;
  /** true only for clearly disposable categories (see classifier) */
  trashCandidate: boolean;
}

export interface ScanReport {
  version: 1;
  createdAt: string; // ISO timestamp
  query: string; // Gmail query used, e.g. "in:inbox"
  scannedCount: number;
  limit: number | null;
  items: ClassifiedEmail[];
  summary: SummaryCounts;
}

export type SummaryCounts = Record<Category, number> & {
  trashCandidates: number;
};

export interface TrashRecord {
  id: string;
  from: string;
  subject: string;
  category: Category;
  success: boolean;
  error?: string;
}

export interface TrashReport {
  version: 1;
  createdAt: string;
  sourceReportCreatedAt: string;
  trashedCount: number;
  records: TrashRecord[];
}

export interface UndoRecord extends TrashRecord {
  restored: boolean;
  error?: string;
}

export interface UndoReport {
  version: 1;
  createdAt: string;
  sourceTrashReport: string; // filename of the trash report used
  restoredCount: number;
  records: UndoRecord[];
}
