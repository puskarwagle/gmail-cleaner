import { describe, expect, test } from "bun:test";
import { summarize } from "../src/core/summary.ts";
import type { Category, ClassifiedEmail, ScanReport, TrashReport, UndoReport } from "../src/core/types.ts";
import { createMazeHandler } from "../src/web/server.ts";

const PORT = 28113;
const TOKEN = "test-token-123";
const HOST = `127.0.0.1:${PORT}`;
const ORIGIN = `http://127.0.0.1:${PORT}`;

function item(id: string, category: Category, trashCandidate: boolean): ClassifiedEmail {
  return {
    id,
    threadId: `t-${id}`,
    from: `${id}@example.com`,
    to: "me@example.com",
    subject: `Subject ${id}`,
    date: "Sat, 3 Oct 2026 10:00:00 +0000",
    classification: { category, confidence: 0.9, reasons: ["test"] },
    trashCandidate,
  };
}

function report(items: ClassifiedEmail[], createdAt: string): ScanReport {
  return {
    version: 1,
    createdAt,
    query: "in:inbox",
    scannedCount: items.length,
    limit: null,
    items,
    summary: summarize(items),
  };
}

const freshAt = () => new Date().toISOString();
const staleAt = () => new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();

interface Ctx {
  handler: (req: Request) => Promise<Response>;
  trashCalls: { ids: string[]; forceStale: boolean }[];
}

function ctx(current: ScanReport, opts: { allowStale?: boolean } = {}): Ctx {
  const trashCalls: Ctx["trashCalls"] = [];
  const handler = createMazeHandler({
    token: TOKEN,
    port: PORT,
    allowStale: opts.allowStale,
    deps: {
      loadReport: () => current,
      trash: async (o) => {
        trashCalls.push(o);
        const report: TrashReport = {
          version: 1,
          createdAt: freshAt(),
          sourceReportCreatedAt: current.createdAt,
          trashedCount: o.ids.length,
          records: o.ids.map((id) => ({
            id,
            from: `${id}@example.com`,
            subject: `Subject ${id}`,
            category: "newsletter" as const,
            success: true,
          })),
        };
        return { report, file: "reports/trash-test.json" };
      },
      undo: async () => {
        const report: UndoReport = {
          version: 1,
          createdAt: freshAt(),
          sourceTrashReport: "reports/trash-test.json",
          restoredCount: 1,
          records: [
            {
              id: "a",
              from: "a@example.com",
              subject: "Subject a",
              category: "newsletter",
              success: true,
              restored: true,
            },
          ],
        };
        return { report, file: "reports/undo-test.json" };
      },
      readHtml: async () => "<html>maze</html>",
    },
  });
  return { handler, trashCalls };
}

function api(path: string, init: RequestInit & { host?: string } = {}): Request {
  const host = init.host ?? HOST;
  const { host: _drop, ...rest } = init;
  void _drop;
  return new Request(`http://${host}${path}`, rest);
}

function postTrash(
  body: unknown,
  init: { token?: string | null; origin?: string; host?: string } = {},
): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (init.token !== null) headers["x-maze-token"] = init.token ?? TOKEN;
  if (init.origin) headers["origin"] = init.origin;
  return api("/api/trash", {
    method: "POST",
    headers,
    host: init.host,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function authed(path: string, init: RequestInit & { host?: string } = {}): Request {
  return api(path, {
    ...init,
    headers: { ...(init.headers as Record<string, string> | undefined), "x-maze-token": TOKEN },
  });
}

const fresh = () =>
  report(
    [item("a", "newsletter", true), item("b", "marketing", true), item("c", "receipt", false)],
    freshAt(),
  );

describe("maze server auth", () => {
  test("bad token rejected, trash never called", async () => {
    const c = ctx(fresh());
    const res = await c.handler(postTrash({ ids: ["a"], confirm: "YES" }, { token: "wrong" }));
    expect(res.status).toBe(401);
    expect(c.trashCalls).toHaveLength(0);
  });

  test("missing token rejected", async () => {
    const c = ctx(fresh());
    const res = await c.handler(postTrash({ ids: ["a"], confirm: "YES" }, { token: null }));
    expect(res.status).toBe(401);
    expect(c.trashCalls).toHaveLength(0);
  });

  test("bad Host rejected", async () => {
    const c = ctx(fresh());
    const res = await c.handler(postTrash({ ids: ["a"], confirm: "YES" }, { host: "evil.example:9999" }));
    expect(res.status).toBe(403);
    expect(c.trashCalls).toHaveLength(0);
  });

  test("bad Origin rejected", async () => {
    const c = ctx(fresh());
    const res = await c.handler(
      postTrash({ ids: ["a"], confirm: "YES" }, { origin: "http://evil.example:9999" }),
    );
    expect(res.status).toBe(403);
    expect(c.trashCalls).toHaveLength(0);
  });
});

describe("maze POST /api/trash guards", () => {
  test("non-candidate ID rejected, whole request refused", async () => {
    const c = ctx(fresh());
    const res = await c.handler(postTrash({ ids: ["c"], confirm: "YES" }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { rejectedIds: string[] };
    expect(body.rejectedIds).toContain("c");
    expect(c.trashCalls).toHaveLength(0);
  });

  test("mixed valid + protected IDs rejected entirely", async () => {
    const c = ctx(fresh());
    const res = await c.handler(postTrash({ ids: ["a", "c"], confirm: "YES" }));
    expect(res.status).toBe(400);
    expect(c.trashCalls).toHaveLength(0);
  });

  test("unknown ID rejected", async () => {
    const c = ctx(fresh());
    const res = await c.handler(postTrash({ ids: ["nope"], confirm: "YES" }));
    expect(res.status).toBe(400);
    expect(c.trashCalls).toHaveLength(0);
  });

  test("missing confirm rejected", async () => {
    const c = ctx(fresh());
    const res = await c.handler(postTrash({ ids: ["a"] }));
    expect(res.status).toBe(400);
    expect(c.trashCalls).toHaveLength(0);
  });

  test("wrong confirm rejected (must be exactly YES)", async () => {
    const c = ctx(fresh());
    for (const confirm of ["yes", "YES ", "NO", ""]) {
      const res = await c.handler(postTrash({ ids: ["a"], confirm }));
      expect(res.status).toBe(400);
    }
    expect(c.trashCalls).toHaveLength(0);
  });

  test("stale report rejected without --force-stale", async () => {
    const c = ctx(report([item("a", "newsletter", true)], staleAt()));
    const res = await c.handler(postTrash({ ids: ["a"], confirm: "YES" }));
    expect(res.status).toBe(409);
    expect(c.trashCalls).toHaveLength(0);
  });

  test("stale report allowed when server started with --force-stale", async () => {
    const c = ctx(report([item("a", "newsletter", true)], staleAt()), { allowStale: true });
    const res = await c.handler(postTrash({ ids: ["a"], confirm: "YES" }));
    expect(res.status).toBe(200);
    expect(c.trashCalls).toHaveLength(1);
    expect(c.trashCalls[0]!.forceStale).toBe(true);
  });

  test("valid request calls runTrash with the reviewed IDs only", async () => {
    const c = ctx(fresh());
    const res = await c.handler(postTrash({ ids: ["a", "b", "a"], confirm: "YES" }));
    expect(res.status).toBe(200);
    expect(c.trashCalls).toHaveLength(1);
    expect(c.trashCalls[0]!.ids).toEqual(["a", "b"]);
    const body = (await res.json()) as { trashedCount: number; records: { success: boolean }[] };
    expect(body.trashedCount).toBe(2);
    expect(body.records.every((r) => r.success)).toBe(true);
  });

  test("missing report tells the user to scan first", async () => {
    const handler = createMazeHandler({
      token: TOKEN,
      port: PORT,
      deps: {
        loadReport: () => {
          throw new Error("No report found.");
        },
        readHtml: async () => "<html>maze</html>",
      },
    });
    const res = await handler(postTrash({ ids: ["a"], confirm: "YES" }));
    expect(res.status).toBe(404);
  });
});

describe("maze GET /api/report", () => {
  test("returns generatedAt, stale flag and message summaries", async () => {
    const c = ctx(fresh());
    const res = await c.handler(authed("/api/report"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      generatedAt: string;
      stale: boolean;
      messages: { id: string; from: string; subject: string; category: string; trashCandidate: boolean }[];
    };
    expect(typeof body.generatedAt).toBe("string");
    expect(body.stale).toBe(false);
    expect(body.messages).toHaveLength(3);
    expect(body.messages[0]).toEqual({
      id: "a",
      from: "a@example.com",
      subject: "Subject a",
      category: "newsletter",
      trashCandidate: true,
    });
  });

  test("marks old reports stale", async () => {
    const c = ctx(report([item("a", "newsletter", true)], staleAt()));
    const res = await c.handler(authed("/api/report"));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { stale: boolean }).stale).toBe(true);
  });

  test("requires the token", async () => {
    const c = ctx(fresh());
    const res = await c.handler(api("/api/report"));
    expect(res.status).toBe(401);
  });
});

describe("maze undo + index", () => {
  test("POST /api/undo delegates to runUndo", async () => {
    const c = ctx(fresh());
    let calls = 0;
    const handler = createMazeHandler({
      token: TOKEN,
      port: PORT,
      deps: {
        loadReport: () => fresh(),
        trash: async () => {
          throw new Error("should not be called");
        },
        undo: async () => {
          calls += 1;
          const r: UndoReport = {
            version: 1,
            createdAt: freshAt(),
            sourceTrashReport: "reports/trash-test.json",
            restoredCount: 1,
            records: [
              {
                id: "a",
                from: "a@example.com",
                subject: "Subject a",
                category: "newsletter",
                success: true,
                restored: true,
              },
            ],
          };
          return { report: r, file: "reports/undo-test.json" };
        },
        readHtml: async () => "<html>maze</html>",
      },
    });
    const res = await handler(
      api("/api/undo", { method: "POST", headers: { "x-maze-token": TOKEN } }),
    );
    expect(res.status).toBe(200);
    expect(c.trashCalls).toHaveLength(0);
    expect(calls).toBe(1);
    expect(((await res.json()) as { restoredCount: number }).restoredCount).toBe(1);
  });

  test("POST /api/undo requires the token", async () => {
    const c = ctx(fresh());
    const res = await c.handler(api("/api/undo", { method: "POST" }));
    expect(res.status).toBe(401);
  });

  test("GET / serves the maze html", async () => {
    const c = ctx(fresh());
    const res = await c.handler(new Request(`http://${HOST}/`));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("maze");
  });
});
