import { google, type gmail_v1 } from "googleapis";
import type { AuthClient } from "./auth.ts";
import type { EmailMeta } from "../core/types.ts";

const WANT_HEADERS = new Set([
  "from",
  "to",
  "subject",
  "date",
  "message-id",
  "list-unsubscribe",
  "precedence",
  "auto-submitted",
  "reply-to",
  "sender",
]);

function headerValue(headers: gmail_v1.Schema$MessagePartHeader[] | undefined, name: string): string {
  const h = headers?.find((x) => x.name?.toLowerCase() === name);
  return h?.value ?? "";
}

function toEmailMeta(msg: gmail_v1.Schema$Message): EmailMeta {
  const headers = msg.payload?.headers ?? [];
  const get = (n: string) => headerValue(headers, n);
  return {
    id: msg.id ?? "",
    threadId: msg.threadId ?? undefined,
    from: get("from"),
    to: get("to"),
    subject: get("subject"),
    date: get("date"),
    messageId: get("message-id") || undefined,
    listUnsubscribe: get("list-unsubscribe") || undefined,
    precedence: get("precedence") || undefined,
    autoSubmitted: get("auto-submitted") || undefined,
    replyTo: get("reply-to") || undefined,
    sender: get("sender") || undefined,
    snippet: msg.snippet ?? undefined,
    labelIds: msg.labelIds ?? undefined,
  };
}

export function gmail(auth: AuthClient) {
  return google.gmail({ version: "v1", auth });
}

export interface ListOpts {
  query?: string;
  limit: number | null;
}

/** List inbox message IDs with correct pagination. Respects `limit` for testing. */
export async function listInboxIds(
  api: gmail_v1.Gmail,
  opts: ListOpts,
): Promise<{ ids: string[]; resultSizeEstimate?: number }> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  let resultSizeEstimate: number | undefined;
  const query = opts.query ?? "in:inbox";

  for (;;) {
    const remaining = opts.limit == null ? 500 : opts.limit - ids.length;
    if (remaining <= 0) break;
    const res = await api.users.messages.list({
      userId: "me",
      q: query,
      maxResults: Math.min(500, remaining),
      pageToken,
    });
    resultSizeEstimate ??= res.data.resultSizeEstimate ?? undefined;
    for (const m of res.data.messages ?? []) {
      if (m.id) ids.push(m.id);
    }
    pageToken = res.data.nextPageToken ?? undefined;
    if (!pageToken) break;
    if (opts.limit != null && ids.length >= opts.limit) break;
  }
  return { ids, resultSizeEstimate };
}

/** Fetch metadata-only (no bodies/attachments) for one message. */
export async function fetchMeta(api: gmail_v1.Gmail, id: string): Promise<EmailMeta> {
  const res = await api.users.messages.get({
    userId: "me",
    id,
    format: "metadata",
    metadataHeaders: [...WANT_HEADERS],
  });
  void WANT_HEADERS; // documented: only headers above + snippet are retrieved
  return toEmailMeta(res.data);
}

/** Batched fetch with small concurrency to stay polite to the API. */
export async function fetchMetas(
  api: gmail_v1.Gmail,
  ids: string[],
  concurrency = 8,
): Promise<EmailMeta[]> {
  const out: EmailMeta[] = new Array(ids.length);
  let cursor = 0;
  async function worker() {
    while (cursor < ids.length) {
      const i = cursor++;
      out[i] = await fetchMeta(api, ids[i]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, worker));
  return out;
}

/** Move one message to Trash. Never deletes permanently. */
export async function trashOne(api: gmail_v1.Gmail, id: string): Promise<void> {
  await api.users.messages.trash({ userId: "me", id });
}

/** Restore one message from Trash back to Inbox. */
export async function untrashOne(api: gmail_v1.Gmail, id: string): Promise<void> {
  await api.users.messages.untrash({ userId: "me", id });
  // Ensure INBOX label (untrash restores previous labels; re-add INBOX to be explicit).
  await api.users.messages.modify({ userId: "me", id, requestBody: { addLabelIds: ["INBOX"] } });
}
