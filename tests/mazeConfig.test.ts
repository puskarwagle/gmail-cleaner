import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMazeHandler } from "../src/web/server.ts";

const PORT = 28223;
const TOKEN = "config-test-token";
const HOST = `127.0.0.1:${PORT}`;

interface Ctx {
  handler: (req: Request) => Promise<Response>;
  dir: string;
  credPath: string;
  tokenPath: string;
}

function ctx(): Ctx {
  const dir = mkdtempSync(join(tmpdir(), "maze-config-"));
  const credPath = join(dir, "credentials.json");
  const tokenPath = join(dir, "token.json");
  const handler = createMazeHandler({
    token: TOKEN,
    port: PORT,
    deps: {
      loadReport: () => {
        throw new Error("no report");
      },
      trash: async () => {
        throw new Error("no gmail in config tests");
      },
      undo: async () => {
        throw new Error("no gmail in config tests");
      },
      readHtml: async () => "<html>maze</html>",
      readSettingsHtml: async () => "<html>settings</html>",
    },
    paths: { credentialsPath: credPath, tokenPath: tokenPath },
  });
  return { handler, dir, credPath, tokenPath };
}

function req(path: string, init: RequestInit = {}, token: string | null = TOKEN): Request {
  const headers = new Headers(init.headers);
  if (token !== null) headers.set("x-maze-token", token);
  return new Request(`http://${HOST}${path}`, { ...init, headers });
}

function post(path: string, body: unknown, token: string | null = TOKEN): Request {
  return req(
    path,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    },
    token,
  );
}

describe("maze settings page + config status", () => {
  test("GET /settings serves html without a token", async () => {
    const c = ctx();
    const res = await c.handler(new Request(`http://${HOST}/settings`));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("settings");
  });

  test("GET /api/config reports empty state", async () => {
    const c = ctx();
    const res = await c.handler(req("/api/config"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      hasCredentials: false,
      credentialsKind: null,
      hasToken: false,
      tokenUpdatedAt: null,
    });
  });

  test("GET /api/config reflects fixture files, never secrets", async () => {
    const c = ctx();
    writeFileSync(
      c.credPath,
      JSON.stringify({ web: { client_id: "id", client_secret: "shh", redirect_uris: ["http://localhost"] } }),
    );
    writeFileSync(c.tokenPath, JSON.stringify({ refresh_token: "shh" }));
    const res = await c.handler(req("/api/config"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.hasCredentials).toBe(true);
    expect(body.credentialsKind).toBe("web");
    expect(body.hasToken).toBe(true);
    expect(typeof body.tokenUpdatedAt).toBe("string");
    expect(JSON.stringify(body)).not.toContain("shh");
  });

  test("GET /api/config requires the token", async () => {
    const c = ctx();
    expect((await c.handler(req("/api/config", {}, null))).status).toBe(401);
  });
});

describe("maze POST /api/config/credentials", () => {
  const uploaded = {
    installed: {
      client_id: "abc.apps.googleusercontent.com",
      client_secret: "topsecret",
      redirect_uris: ["http://localhost"],
      project_id: "p",
    },
  };

  test("accepts an uploaded credentials.json, writes mode 0600", async () => {
    const c = ctx();
    const res = await c.handler(post("/api/config/credentials", { json: uploaded }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, kind: "installed" });
    expect(JSON.parse(readFileSync(c.credPath, "utf8"))).toEqual(uploaded);
    expect(statSync(c.credPath).mode & 0o777).toBe(0o600);
  });

  test("accepts manual fields", async () => {
    const c = ctx();
    const res = await c.handler(
      post("/api/config/credentials", {
        kind: "web",
        clientId: "x",
        clientSecret: "y",
        redirectUri: "http://localhost:1013",
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, kind: "web" });
    expect(JSON.parse(readFileSync(c.credPath, "utf8"))).toEqual({
      web: { client_id: "x", client_secret: "y", redirect_uris: ["http://localhost:1013"] },
    });
  });

  test("rejects invalid shapes without writing", async () => {
    const c = ctx();
    for (const bad of [
      {},
      { json: { foo: 1 } },
      { json: { installed: { client_id: "x" } } },
      { json: { web: { client_id: "x", client_secret: "y", redirect_uris: [] } } },
      { kind: "installed", clientId: "", clientSecret: "y", redirectUri: "http://localhost" },
      { kind: "desktop", clientId: "x", clientSecret: "y", redirectUri: "http://localhost" },
      "not-json-at-all",
    ]) {
      const res = await c.handler(post("/api/config/credentials", bad));
      expect(res.status).toBe(400);
    }
    expect(existsSync(c.credPath)).toBe(false);
  });

  test("requires the token", async () => {
    const c = ctx();
    const res = await c.handler(post("/api/config/credentials", { json: uploaded }, null));
    expect(res.status).toBe(401);
    expect(existsSync(c.credPath)).toBe(false);
  });

  test("tightens mode on an existing loose file", async () => {
    const c = ctx();
    writeFileSync(c.credPath, "{}");
    chmodSync(c.credPath, 0o644);
    const res = await c.handler(post("/api/config/credentials", { json: uploaded }));
    expect(res.status).toBe(200);
    expect(statSync(c.credPath).mode & 0o777).toBe(0o600);
  });
});

describe("maze POST /api/config/revoke", () => {
  test("deletes the token file", async () => {
    const c = ctx();
    writeFileSync(c.tokenPath, "{}");
    const res = await c.handler(post("/api/config/revoke", {}));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(existsSync(c.tokenPath)).toBe(false);
  });

  test("404 when there is nothing to revoke", async () => {
    const c = ctx();
    expect((await c.handler(post("/api/config/revoke", {}))).status).toBe(404);
  });

  test("requires the token", async () => {
    const c = ctx();
    writeFileSync(c.tokenPath, "{}");
    expect((await c.handler(post("/api/config/revoke", {}, null))).status).toBe(401);
    expect(existsSync(c.tokenPath)).toBe(true);
  });
});
