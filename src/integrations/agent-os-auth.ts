/**
 * Interactive OAuth for Binance Agent OS.
 *
 * Agent OS's MCP endpoint is OAuth-protected. This implements the MCP client OAuth
 * flow end to end so the human only has to click "authorize" in a browser:
 *
 *   1. A loopback HTTP server is started to catch the redirect.
 *   2. `client.connect()` hits the 401, the SDK discovers the auth server, does
 *      dynamic client registration, and calls `redirectToAuthorization` — which
 *      opens the user's browser at Binance's consent page.
 *   3. The user authorizes; Binance redirects to `http://localhost:<port>/callback?code=…`.
 *   4. We hand the code to `transport.finishAuth(code)`, which exchanges it (PKCE)
 *      for tokens, and retry `connect()` — now authorized.
 *
 * Tokens, the registered client, and the PKCE verifier are persisted to a local
 * JSON file (gitignored) so subsequent runs reuse the token (and silently refresh).
 *
 * Everything a downstream user needs:  npm run agentos:login
 * Then in code:  const os = await connectAgentOsWithOAuth();
 */
import { createServer } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { exec } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformation,
  OAuthClientInformationFull,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { AGENT_OS_MCP_URL, toolsFromClient } from "./agent-os.ts";
import type { AgentOsConnection } from "./agent-os.ts";

interface AuthStore {
  clientInformation?: OAuthClientInformation | OAuthClientInformationFull;
  tokens?: OAuthTokens;
  codeVerifier?: string;
}

/** OAuthClientProvider that persists to a JSON file and opens the system browser. */
export class FileOAuthProvider implements OAuthClientProvider {
  private store: AuthStore;

  /**
   * CIMD (SEP-991) client-id URL. When set and the server advertises
   * `client_id_metadata_document_supported`, the SDK uses this HTTPS URL as the
   * client_id and skips registration — Binance Agent OS's supported path. The URL
   * must serve the JSON returned by `clientMetadataDocument()`.
   */
  clientMetadataUrl?: string;

  constructor(
    private readonly storePath: string,
    private readonly port: number,
    private readonly clientName = "TradeGuard",
    /** Pre-registered client id (fallback for servers that pre-register clients). */
    private readonly staticClientId?: string,
    private readonly staticClientSecret?: string,
    /** CIMD client-id URL (preferred for Agent OS). */
    clientMetadataUrl?: string,
  ) {
    this.store = readJson(storePath) ?? {};
    this.clientMetadataUrl = clientMetadataUrl;
  }

  get redirectUrl(): string {
    return `http://localhost:${this.port}/callback`;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: this.clientName,
      redirect_uris: [this.redirectUrl],
      grant_types: ["authorization_code"], // Agent OS advertises only authorization_code
      response_types: ["code"],
      token_endpoint_auth_method: "none", // public client + PKCE (S256)
    };
  }

  /** The exact JSON to host at `clientMetadataUrl` for CIMD (client_id === that URL). */
  clientMetadataDocument(): Record<string, unknown> {
    return { client_id: this.clientMetadataUrl, ...this.clientMetadata };
  }

  clientInformation() {
    // Reuse a previously resolved client (CIMD url or saved registration).
    if (this.store.clientInformation) return this.store.clientInformation;
    // Explicit pre-registered client id (non-CIMD servers).
    if (this.staticClientId) {
      return { client_id: this.staticClientId, client_secret: this.staticClientSecret };
    }
    // Otherwise return undefined so the SDK runs its CIMD branch (using clientMetadataUrl).
    return undefined;
  }
  saveClientInformation(info: OAuthClientInformationFull) {
    this.store.clientInformation = info;
    this.flush();
  }

  tokens() {
    return this.store.tokens;
  }
  saveTokens(tokens: OAuthTokens) {
    this.store.tokens = tokens;
    this.flush();
  }

  saveCodeVerifier(verifier: string) {
    this.store.codeVerifier = verifier;
    this.flush();
  }
  codeVerifier(): string {
    if (!this.store.codeVerifier) throw new Error("No PKCE code verifier saved.");
    return this.store.codeVerifier;
  }

  redirectToAuthorization(authorizationUrl: URL) {
    const url = authorizationUrl.toString();
    console.log("\n🔐 Authorize TradeGuard in your browser:\n   " + url + "\n");
    openBrowser(url);
  }

  private flush() {
    writeFileSync(this.storePath, JSON.stringify(this.store, null, 2));
  }
}

export interface OAuthConnectOptions {
  /** MCP endpoint. Defaults to Binance Agent OS. */
  url?: string;
  /** Where to persist tokens/client. Default ".agentos-auth.json". */
  storePath?: string;
  /** Loopback port for the OAuth redirect. Default 8976. */
  port?: number;
  clientName?: string;
  /** CIMD client-id URL (preferred for Agent OS): an HTTPS URL serving the client metadata JSON. */
  clientMetadataUrl?: string;
  /** Pre-registered OAuth client id (fallback for servers that pre-register clients). */
  clientId?: string;
  /** Client secret, if the registered client is confidential. Public+PKCE clients omit this. */
  clientSecret?: string;
}

/**
 * Run the full interactive OAuth flow and return a connected MCP client.
 * If a valid token is already stored, connects silently with no browser step.
 */
export async function authorizeAgentOs(opts: OAuthConnectOptions = {}): Promise<{
  client: Client;
  transport: StreamableHTTPClientTransport;
  close: () => Promise<void>;
}> {
  const url = new URL(opts.url ?? AGENT_OS_MCP_URL);
  const port = opts.port ?? 8976;
  const provider = new FileOAuthProvider(
    opts.storePath ?? ".agentos-auth.json",
    port,
    opts.clientName,
    opts.clientId,
    opts.clientSecret,
    opts.clientMetadataUrl,
  );

  const client = new Client({ name: "tradeguard", version: "0.0.1" });
  const transport = new StreamableHTTPClientTransport(url, { authProvider: provider });

  try {
    // Fast path: a stored (or refreshable) token connects with no user interaction.
    await client.connect(transport);
  } catch (err) {
    if (!(err instanceof UnauthorizedError)) throw err;
    // The browser is now open (redirectToAuthorization fired). Catch the redirect.
    const code = await waitForRedirectCode(port);
    await transport.finishAuth(code);
    await client.connect(transport);
  }

  return { client, transport, close: () => client.close() };
}

/** Interactive-OAuth variant of connectAgentOs: authorize, then wrap tools. */
export async function connectAgentOsWithOAuth(opts: OAuthConnectOptions = {}): Promise<AgentOsConnection> {
  const { client, close } = await authorizeAgentOs(opts);
  return { tools: await toolsFromClient(client), client, close };
}

/** Start a one-shot loopback server and resolve with the `code` from the OAuth redirect. */
function waitForRedirectCode(port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const u = new URL(req.url ?? "/", `http://localhost:${port}`);
      if (!u.pathname.startsWith("/callback")) {
        res.writeHead(404).end();
        return;
      }
      const code = u.searchParams.get("code");
      const error = u.searchParams.get("error");
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(
        `<html><body style="font-family:system-ui;padding:3rem;text-align:center">` +
          (code
            ? `<h2>✅ TradeGuard authorized</h2><p>You can close this tab and return to the terminal.</p>`
            : `<h2>❌ Authorization failed</h2><p>${error ?? "no code returned"}</p>`) +
          `</body></html>`,
      );
      server.close();
      if (code) resolve(code);
      else reject(new Error(`OAuth redirect returned no code (${error ?? "unknown error"})`));
    });
    server.on("error", reject);
    server.listen(port, () => {
      console.log(`⏳ Waiting for the OAuth redirect on http://localhost:${port}/callback …`);
    });
  });
}

function openBrowser(url: string) {
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start \"\"" : "xdg-open";
  exec(`${cmd} "${url}"`, (err) => {
    if (err) console.log("   (couldn't auto-open a browser — open the URL above manually)");
  });
}

function readJson(path: string): AuthStore | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as AuthStore;
  } catch {
    return undefined;
  }
}
