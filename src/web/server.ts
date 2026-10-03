/**
 * Mail Maze web front end (local-only server).
 *
 * Serves the single-file maze game in mail-maze.html with real inbox data:
 *   GET  /            serves the maze html
 *   GET  /settings    serves the settings page (maze UI tabs + Gmail API form)
 *   GET  /api/report  { generatedAt, stale, messages: [{id, from, subject, category, trashCandidate}] }
 *   POST /api/trash   { ids, confirm } -> runTrash result with per-message status
 *   POST /api/undo    -> runUndo result
 *   GET  /api/config  { hasCredentials, credentialsKind, hasToken, tokenUpdatedAt } (no secrets)
 *   POST /api/config/credentials  { json } | { kind, clientId, clientSecret, redirectUri, projectId? }
 *                      -> validates the OAuth client shape and writes credentials.json (0600)
 *   POST /api/config/revoke  -> deletes token.json (local sign-out)
 *
 * Safety (mirrors the CLI guards; the browser is never trusted):
 * - Binds 127.0.0.1 only. A random token is generated per launch, embedded in
 *   the opened URL, and required as the `x-maze-token` header on every /api
 *   call (never accepted via query string, to keep it out of logs). Host and
 *   Origin are checked. No CORS headers are ever sent.
 * - Only IDs that exist in reports/latest.json with trashCandidate === true
 *   are passed to runTrash; anything else rejects the whole request.
 * - Same 24 h stale-report guard as the CLI; only `--force-stale` at server
 *   start bypasses it, never the browser.
 * - POST /api/trash requires body.confirm === "YES" (exact), matching the
 *   typed-YES dialog in the UI.
 * - Trash/untrash go through the existing gmail/runTrash + runUndo only.
 *   No new OAuth scopes, no body/attachment fetching, tokens are never logged.
 * - credentials.json is only ever written from a validated shape (installed
 *   or web client with client_id/client_secret/redirect_uris), mode 0600,
 *   and secret values are never returned by any endpoint.
 */

import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import type { ScanReport, TrashReport, UndoReport } from "../core/types.ts";
import { CREDENTIALS_PATH, TOKEN_PATH } from "../gmail/auth.ts";
import { loadLatestReport, runTrash as realRunTrash } from "../gmail/trash.ts";
import { runUndo as realRunUndo } from "../gmail/undo.ts";

/** Header carrying the per-launch token. Never accept the token via query. */
export const MAZE_TOKEN_HEADER = "x-maze-token";

/** Same stale-report window as the CLI trash guard. */
export const STALE_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_MAZE_PORT = 2733;

export interface MazeMessage {
  id: string;
  from: string;
  subject: string;
  category: string;
  trashCandidate: boolean;
}

export interface MazeTrashResult {
  trashedCount: number;
  records: TrashReport["records"];
  file: string;
}

export interface MazeUndoResult {
  restoredCount: number;
  records: UndoReport["records"];
  file: string;
}

/** Injectable seams so tests can run the HTTP layer without Gmail. */
export interface MazeDeps {
  loadReport: () => ScanReport;
  trash: (opts: { ids: string[]; forceStale: boolean }) => Promise<{ report: TrashReport; file: string }>;
  undo: () => Promise<{ report: UndoReport; file: string }>;
  readHtml: () => Promise<string>;
  readSettingsHtml: () => Promise<string>;
}

/** Local secret-file locations. Injectable so tests never touch real credentials. */
export interface MazePaths {
  credentialsPath: string;
  tokenPath: string;
}

const MAZE_HTML = new URL("../../mail-maze.html", import.meta.url);
const SETTINGS_HTML = new URL("./settings.html", import.meta.url);

const defaultDeps: MazeDeps = {
  loadReport: loadLatestReport,
  trash: (opts) => realRunTrash({ forceStale: opts.forceStale, ids: opts.ids }),
  undo: () => realRunUndo({}),
  readHtml: () => Bun.file(MAZE_HTML).text(),
  readSettingsHtml: () => Bun.file(SETTINGS_HTML).text(),
};

const defaultPaths: MazePaths = {
  credentialsPath: CREDENTIALS_PATH,
  tokenPath: TOKEN_PATH,
};

export interface MazeHandlerOptions {
  /** Per-launch random token; required as a header on every /api call. */
  token: string;
  /** Port the server is bound to; Host/Origin are checked against it. */
  port: number;
  /** From --force-stale at server start. Never settable from the browser. */
  allowStale?: boolean;
  deps?: Partial<MazeDeps>;
  paths?: Partial<MazePaths>;
}

export function isStale(report: ScanReport, now = Date.now()): boolean {
  return now - new Date(report.createdAt).getTime() > STALE_MS;
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

export type CredentialsKind = "installed" | "web";

/**
 * Validate a credentials payload and normalize it to credentials.json shape.
 * Accepts either an uploaded file ({ json: <parsed credentials.json> }) or
 * manual fields ({ kind?, clientId, clientSecret, redirectUri, projectId? }).
 * Mirrors the requirements of gmail/auth.ts readKey(): installed or web with
 * non-empty client_id, client_secret and at least one redirect_uri.
 * Throws on any invalid shape — the route maps that to 400.
 */
export function normalizeCredentials(body: unknown): { kind: CredentialsKind; doc: Record<string, unknown> } {
  if (typeof body !== "object" || body === null) throw new Error("Invalid credentials payload.");
  const b = body as Record<string, unknown>;

  if (b.json !== undefined) {
    const raw = b.json as Record<string, unknown>;
    if (typeof raw !== "object" || raw === null) throw new Error("Uploaded JSON must be an object.");
    for (const kind of ["installed", "web"] as const) {
      const key = (raw[kind] ?? null) as Record<string, unknown> | null;
      if (typeof key !== "object" || key === null) continue;
      checkKeyFields(key);
      return { kind, doc: { [kind]: key } };
    }
    throw new Error('Uploaded JSON must contain an "installed" (Desktop) or "web" client object.');
  }

  const kind = b.kind === undefined || b.kind === "installed" ? "installed" : b.kind === "web" ? "web" : null;
  if (kind === null) throw new Error('kind must be "installed" or "web".');
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const clientId = str(b.clientId);
  const clientSecret = str(b.clientSecret);
  const redirectUri = str(b.redirectUri);
  if (!clientId) throw new Error("clientId is required.");
  if (!clientSecret) throw new Error("clientSecret is required.");
  if (!redirectUri) throw new Error("redirectUri is required.");
  const inner: Record<string, unknown> = {
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uris: [redirectUri],
  };
  const projectId = str(b.projectId);
  if (projectId) inner.project_id = projectId;
  return { kind, doc: { [kind]: inner } };
}

function checkKeyFields(key: Record<string, unknown>): void {
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  if (!str(key.client_id)) throw new Error("Client object needs a non-empty client_id.");
  if (!str(key.client_secret)) throw new Error("Client object needs a non-empty client_secret.");
  const uris = key.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || !uris.every((u) => str(u))) {
    throw new Error("Client object needs redirect_uris with at least one URI.");
  }
}

/** Status for the settings page. Secret values are never included. */
export function configStatus(credentialsPath: string, tokenPath: string): {
  hasCredentials: boolean;
  credentialsKind: CredentialsKind | null;
  hasToken: boolean;
  tokenUpdatedAt: string | null;
} {
  let hasCredentials = false;
  let credentialsKind: CredentialsKind | null = null;
  if (existsSync(credentialsPath)) {
    try {
      const raw = JSON.parse(readFileSync(credentialsPath, "utf8")) as Record<string, unknown>;
      if (typeof raw.installed === "object" && raw.installed !== null) credentialsKind = "installed";
      else if (typeof raw.web === "object" && raw.web !== null) credentialsKind = "web";
      hasCredentials = credentialsKind !== null;
    } catch {
      hasCredentials = false;
    }
  }
  let hasToken = false;
  let tokenUpdatedAt: string | null = null;
  if (existsSync(tokenPath)) {
    hasToken = true;
    try {
      tokenUpdatedAt = new Date(statSync(tokenPath).mtimeMs).toISOString();
    } catch {
      tokenUpdatedAt = null;
    }
  }
  return { hasCredentials, credentialsKind, hasToken, tokenUpdatedAt };
}

/**
 * Pure request handler (no listening). Used by startMazeServer and by tests.
 */
export function createMazeHandler(opts: MazeHandlerOptions): (req: Request) => Promise<Response> {
  const deps: MazeDeps = { ...defaultDeps, ...opts.deps };
  const paths: MazePaths = { ...defaultPaths, ...opts.paths };
  const allowStale = opts.allowStale ?? false;
  const expectedHost = `127.0.0.1:${opts.port}`;
  const expectedOrigin = `http://127.0.0.1:${opts.port}`;

  function guard(req: Request): Response | null {
    if (req.headers.get(MAZE_TOKEN_HEADER) !== opts.token) {
      return json({ error: "Forbidden: bad or missing token." }, 401);
    }
    const host = req.headers.get("host") ?? new URL(req.url).host;
    if (host !== expectedHost) {
      return json({ error: "Forbidden: bad Host." }, 403);
    }
    const origin = req.headers.get("origin");
    if (origin !== null && origin !== expectedOrigin) {
      return json({ error: "Forbidden: bad Origin." }, 403);
    }
    return null;
  }

  function readReport(): ScanReport | Response {
    try {
      return deps.loadReport();
    } catch (err) {
      return json(
        {
          error: `No report found. Run \`bun run dev -- scan\` first (dry-run is mandatory). (${err instanceof Error ? err.message : String(err)})`,
        },
        404,
      );
    }
  }

  return async (req: Request): Promise<Response> => {
    const { pathname } = new URL(req.url);

    if (req.method === "GET" && pathname === "/") {
      try {
        const html = await deps.readHtml();
        return new Response(html, {
          headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
        });
      } catch (err) {
        return json({ error: `Cannot serve maze html: ${err instanceof Error ? err.message : String(err)}` }, 500);
      }
    }

    if (req.method === "GET" && pathname === "/settings") {
      try {
        const html = await deps.readSettingsHtml();
        return new Response(html, {
          headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
        });
      } catch (err) {
        return json(
          { error: `Cannot serve settings html: ${err instanceof Error ? err.message : String(err)}` },
          500,
        );
      }
    }

    if (req.method === "GET" && pathname === "/api/report") {
      const denied = guard(req);
      if (denied) return denied;
      const report = readReport();
      if (report instanceof Response) return report;
      const messages: MazeMessage[] = report.items.map((i) => ({
        id: i.id,
        from: i.from,
        subject: i.subject,
        category: i.classification.category,
        trashCandidate: i.trashCandidate,
      }));
      return json({ generatedAt: report.createdAt, stale: isStale(report), messages });
    }

    if (req.method === "POST" && pathname === "/api/trash") {
      const denied = guard(req);
      if (denied) return denied;
      let body: { ids?: unknown; confirm?: unknown };
      try {
        body = (await req.json()) as { ids?: unknown; confirm?: unknown };
      } catch {
        return json({ error: "Invalid JSON body." }, 400);
      }
      if (body.confirm !== "YES") {
        return json({ error: 'Confirmation required: body.confirm must be exactly "YES".' }, 400);
      }
      if (!Array.isArray(body.ids) || body.ids.length === 0 || !body.ids.every((id) => typeof id === "string")) {
        return json({ error: "Body.ids must be a non-empty array of message IDs." }, 400);
      }
      const report = readReport();
      if (report instanceof Response) return report;
      if (isStale(report) && !allowStale) {
        return json(
          {
            error: `Report is stale (created ${report.createdAt}). Re-run scan for a fresh dry-run, or restart the maze server with --force-stale.`,
          },
          409,
        );
      }
      // Server-side candidate check: re-read the report, reject protected mail.
      const byId = new Map(report.items.map((i) => [i.id, i]));
      const ids = [...new Set(body.ids as string[])];
      const rejected = ids.filter((id) => {
        const item = byId.get(id);
        return !item || item.trashCandidate !== true;
      });
      if (rejected.length > 0) {
        return json(
          {
            error: `${rejected.length} requested message(s) are not trash candidates and were rejected. Only trashCandidate === true may be trashed.`,
            rejectedIds: rejected,
          },
          400,
        );
      }
      try {
        const { report: trashReport, file } = await deps.trash({ ids, forceStale: allowStale });
        const result: MazeTrashResult = {
          trashedCount: trashReport.trashedCount,
          records: trashReport.records,
          file,
        };
        return json(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const status = /stale|old|fresh/i.test(msg) ? 409 : 500;
        return json({ error: msg }, status);
      }
    }

    if (req.method === "POST" && pathname === "/api/undo") {
      const denied = guard(req);
      if (denied) return denied;
      try {
        const { report: undoReport, file } = await deps.undo();
        const result: MazeUndoResult = {
          restoredCount: undoReport.restoredCount,
          records: undoReport.records,
          file,
        };
        return json(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const status = /nothing to undo|no trash report/i.test(msg) ? 404 : 500;
        return json({ error: msg }, status);
      }
    }

    if (req.method === "GET" && pathname === "/api/config") {
      const denied = guard(req);
      if (denied) return denied;
      return json(configStatus(paths.credentialsPath, paths.tokenPath));
    }

    if (req.method === "POST" && pathname === "/api/config/credentials") {
      const denied = guard(req);
      if (denied) return denied;
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return json({ error: "Invalid JSON body." }, 400);
      }
      let kind: CredentialsKind;
      let doc: Record<string, unknown>;
      try {
        ({ kind, doc } = normalizeCredentials(body));
      } catch (err) {
        return json({ error: err instanceof Error ? err.message : String(err) }, 400);
      }
      try {
        writeFileSync(paths.credentialsPath, JSON.stringify(doc, null, 2) + "\n", { mode: 0o600 });
        chmodSync(paths.credentialsPath, 0o600);
      } catch (err) {
        return json(
          { error: `Cannot write credentials: ${err instanceof Error ? err.message : String(err)}` },
          500,
        );
      }
      return json({ ok: true, kind });
    }

    if (req.method === "POST" && pathname === "/api/config/revoke") {
      const denied = guard(req);
      if (denied) return denied;
      if (!existsSync(paths.tokenPath)) {
        return json({ error: "No token found — nothing to revoke." }, 404);
      }
      try {
        unlinkSync(paths.tokenPath);
      } catch (err) {
        return json({ error: `Cannot revoke token: ${err instanceof Error ? err.message : String(err)}` }, 500);
      }
      return json({ ok: true });
    }

    return json({ error: "Not found." }, 404);
  };
}

export interface StartMazeOptions {
  port?: number;
  allowStale?: boolean;
  /** Mostly for tests; defaults to a fresh random token per launch. */
  token?: string;
  deps?: Partial<MazeDeps>;
}

export interface StartedMazeServer {
  server: ReturnType<typeof Bun.serve>;
  url: string;
  token: string;
  port: number;
}

/** Bind 127.0.0.1 only and return the token-bearing URL to open. */
export function startMazeServer(opts: StartMazeOptions = {}): StartedMazeServer {
  const port = opts.port ?? DEFAULT_MAZE_PORT;
  const token = opts.token ?? randomUUID().replace(/-/g, "");
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    fetch: createMazeHandler({ token, port, allowStale: opts.allowStale, deps: opts.deps }),
  });
  const url = `http://127.0.0.1:${port}/?token=${encodeURIComponent(token)}`;
  return { server, url, token, port };
}
