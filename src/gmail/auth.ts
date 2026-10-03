import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { google } from "googleapis";

export const SCOPES = ["https://www.googleapis.com/auth/gmail.modify"];
export const CREDENTIALS_PATH = join(process.cwd(), "credentials.json");
export const TOKEN_PATH = join(process.cwd(), "token.json");

/** Single-version auth client: always googleapis' own OAuth2 class. */
export type AuthClient = InstanceType<typeof google.auth.OAuth2>;

interface KeyShape {
  client_id: string;
  client_secret: string;
  redirect_uris: string[];
}

function readKey(): { clientId: string; clientSecret: string; redirectUri: string } {
  if (!existsSync(CREDENTIALS_PATH)) {
    throw new Error(
      "credentials.json not found in project root.\n" +
        "See README.md § Google Cloud setup to create an OAuth client and download it as credentials.json.",
    );
  }
  const raw = JSON.parse(readFileSync(CREDENTIALS_PATH, "utf8")) as {
    installed?: KeyShape;
    web?: KeyShape;
  };
  // Accept Desktop ("installed") and Web keys; redirect URI is used verbatim
  // (no URL normalization) so it matches the Console entry exactly.
  const key = raw.installed ?? raw.web;
  if (!key?.client_id || !key?.client_secret || !key?.redirect_uris?.[0]) {
    throw new Error(
      "credentials.json must contain installed (Desktop) or web client keys with at least one redirect_uri.",
    );
  }
  return { clientId: key.client_id, clientSecret: key.client_secret, redirectUri: key.redirect_uris[0]! };
}

function buildClient(clientId: string, clientSecret: string, redirectUri: string): AuthClient {
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

/**
 * Desktop/loopback OAuth flow with our own callback server.
 * Prints the consent URL (browser auto-open is best-effort) and waits for
 * the Google redirect. Tokens persist to token.json (mode 0600).
 * Never logs tokens.
 */
async function freshAuth(clientId: string, clientSecret: string, redirectUri: string): Promise<AuthClient> {
  // The client is built after the server binds, so authorize + token
  // exchange use the identical redirect string (required by Google).
  // No callback can arrive before then: the URL only exists after this.
  let client!: AuthClient;
  let effectiveRedirect = redirectUri;

  const tokens = await new Promise<{ [k: string]: unknown }>((resolve, reject) => {
    const server = createServer(async (req, res) => {
      try {
        const url = new URL(req.url ?? "/", "http://localhost");
        const cbPath = new URL(effectiveRedirect).pathname;
        if (url.pathname !== cbPath) {
          res.writeHead(404).end("Not found.");
          return;
        }
        if (url.searchParams.has("error")) {
          res.end("Authorization rejected. Return to the console.");
          reject(new Error(`Google refused authorization: ${url.searchParams.get("error")}`));
          return;
        }
        const code = url.searchParams.get("code");
        if (!code) {
          res.end("No authentication code provided.");
          reject(new Error("Cannot read authentication code."));
          return;
        }
        const { tokens: t } = await client.getToken({ code, redirect_uri: effectiveRedirect });
        res.end("Authentication successful! Please return to the console.");
        resolve(t as unknown as { [k: string]: unknown });
      } catch (err) {
        reject(err);
      } finally {
        server.close();
      }
    });

    const explicitPort = new URL(redirectUri).port;
    server.listen(explicitPort ? Number(explicitPort) : 0, () => {
      if (!explicitPort) {
        const actual = (server.address() as { port: number }).port;
        effectiveRedirect = `http://localhost:${actual}${new URL(redirectUri).pathname}`;
      }
      client = buildClient(clientId, clientSecret, effectiveRedirect);
      const authorizeUrl = client.generateAuthUrl({
        access_type: "offline",
        scope: SCOPES.join(" "),
        prompt: "consent", // ensure a refresh_token is issued every time
      });
      console.log("\nOpen this URL in your browser to authorize gmail-cleaner:");
      console.log(authorizeUrl + "\n");
      try {
        // Best-effort auto-open (macOS); failure is fine — URL is printed above.
        Bun.spawn(["open", authorizeUrl], { stdout: "ignore", stderr: "ignore" });
      } catch {
        /* printed URL suffices */
      }
    });
  });

  client.setCredentials(tokens as never);
  writeFileSync(TOKEN_PATH, JSON.stringify(client.credentials, null, 2), { mode: 0o600 });
  return client;
}

export async function getAuthClient(): Promise<AuthClient> {
  const { clientId, clientSecret, redirectUri } = readKey();

  if (existsSync(TOKEN_PATH)) {
    const stored = JSON.parse(readFileSync(TOKEN_PATH, "utf8"));
    const client = buildClient(clientId, clientSecret, redirectUri);
    client.setCredentials(stored);
    return client; // googleapis refreshes the access token on demand
  }

  return freshAuth(clientId, clientSecret, redirectUri);
}
