/**
 * Agent OS connector — turns Binance Agent OS's MCP tools into pi `AgentTool`s
 * so they run *through* TradeGuard's hooks.
 *
 * Agent OS (launched 2026-08) is an MCP server at `https://agent.binance.com/mcp/agentic`.
 * It is OAuth-protected (the endpoint answers 401 with a
 * `WWW-Authenticate: Bearer resource_metadata=…/.well-known/oauth-protected-resource`
 * challenge), so a live connection needs a token obtained by authorizing the app
 * against an eligible Binance account. Two ways to supply auth:
 *
 *   1. `authToken` — a bearer token you already hold (simplest once you have one).
 *   2. `transport`  — bring your own transport, e.g. a `StreamableHTTPClientTransport`
 *      configured with an `OAuthClientProvider` (full interactive flow), or an
 *      `InMemoryTransport` linked to a local mock server (see `demo-agentos.ts`).
 *
 * pi has no built-in MCP client, so this is the missing layer: connect an MCP
 * client, list the server's tools, and wrap each one as a pi `AgentTool` whose
 * `execute` proxies to `client.callTool`. Registered on a guarded `Agent`, every
 * Agent OS call now passes through `beforeToolCall` / `afterToolCall` first.
 *
 * Note: per Binance, on-chain `approve`/`transfer` are NOT in the MCP server yet
 * (they live behind the Wallet Agentic Hub / Binance APIs / x402). So this path
 * primarily feeds the decision-integrity engine; the chain-safety engine will hook
 * the wallet surface once it is exposed. `parseAction()` already matches loosely so
 * it screens whatever on-chain tool names do show up here.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { Type } from "@earendil-works/pi-ai";
import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";

/** Official Binance Agent OS MCP endpoint. */
export const AGENT_OS_MCP_URL = "https://agent.binance.com/mcp/agentic";

export interface ConnectAgentOsOptions {
  /** MCP endpoint. Defaults to Binance Agent OS. */
  url?: string;
  /** Bearer token from the OAuth authorization flow. */
  authToken?: string;
  /** Bring your own transport (OAuth provider, or InMemory for local tests). Wins over url/authToken. */
  transport?: Transport;
  /** Client identity sent in the MCP handshake. */
  clientName?: string;
  clientVersion?: string;
}

export interface AgentOsConnection {
  /** Agent OS tools, wrapped as pi AgentTools — drop these into `Agent` state. */
  tools: AgentTool[];
  /** The underlying MCP client (for advanced use). */
  client: Client;
  /** Close the MCP connection. */
  close: () => Promise<void>;
}

/**
 * Connect to Agent OS (or any MCP server) and return its tools as pi AgentTools.
 *
 *   const os = await connectAgentOs({ authToken });
 *   const agent = new Agent({ ...guardHooks, initialState: { tools: os.tools, ... } });
 */
export async function connectAgentOs(opts: ConnectAgentOsOptions = {}): Promise<AgentOsConnection> {
  const client = new Client({
    name: opts.clientName ?? "tradeguard",
    version: opts.clientVersion ?? "0.0.1",
  });

  const transport =
    opts.transport ??
    new StreamableHTTPClientTransport(
      new URL(opts.url ?? AGENT_OS_MCP_URL),
      opts.authToken
        ? { requestInit: { headers: { Authorization: `Bearer ${opts.authToken}` } } }
        : undefined,
    );

  await client.connect(transport);
  return {
    tools: await toolsFromClient(client),
    client,
    close: () => client.close(),
  };
}

/** List an already-connected MCP client's tools and wrap them as guarded pi AgentTools. */
export async function toolsFromClient(client: Client): Promise<AgentTool[]> {
  const { tools } = await client.listTools();
  return tools.map((t) => wrap(client, t));
}

/** Wrap one MCP tool as a pi AgentTool that proxies execution to the MCP server. */
function wrap(
  client: Client,
  t: { name: string; description?: string; inputSchema?: unknown },
): AgentTool {
  return {
    name: t.name,
    label: t.name,
    description: t.description ?? t.name,
    // MCP tools carry a JSON Schema; typebox wraps it verbatim for pi's validator.
    parameters: Type.Unsafe(t.inputSchema ?? { type: "object" }),
    execute: async (_toolCallId, params) => {
      const res = await client.callTool({
        name: t.name,
        arguments: (params ?? {}) as Record<string, unknown>,
      });
      const content = normalizeContent(res.content);
      if (res.isError) {
        // Throw so pi marks it an error — lets decision-integrity catch "claimed success, call failed".
        const text = content.map((c) => (c.type === "text" ? c.text : "")).join(" ").trim();
        throw new Error(text || `${t.name} failed`);
      }
      return { content, details: res };
    },
  };
}

/** MCP content blocks → pi content blocks (text/image; anything else summarized as text). */
function normalizeContent(content: unknown): (TextContent | ImageContent)[] {
  if (!Array.isArray(content)) return [{ type: "text", text: "" }];
  return content.map((c: any): TextContent | ImageContent => {
    if (c?.type === "text") return { type: "text", text: String(c.text ?? "") };
    if (c?.type === "image") return { type: "image", data: String(c.data ?? ""), mimeType: String(c.mimeType ?? "application/octet-stream") };
    return { type: "text", text: `[${c?.type ?? "unknown"}] ${JSON.stringify(c)}` };
  });
}
