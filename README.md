# TradeGuard (skeleton)

A **trading safety layer** for pi-hosted agents. It plugs into pi's
`beforeToolCall` / `afterToolCall` hooks and screens every tool call *before* it
reaches Binance Agent OS — for on-chain risk and for AI decision hallucination.

Product framing (contest Track A — Agent Creation): a trading agent whose every
action passes through a safety layer.

## Run it

```bash
npm install
npm run demo         # four scenes via direct hook calls, no network, no pi build
npm run demo:pi      # runs a REAL pi Agent loop offline; guard blocks the bad approval
npm run demo:agentos # REAL MCP: guard blocks an Agent-OS-shaped MCP tool before it runs
npm run demo:agent   # REAL LLM drives 4 live scenarios (block contract/addr, allow, hallucination)
npm run demo:real    # REAL LLM (DMX) drives the agent; guard blocks a live decision
npm run demo:pitch   # the 4 beats offline & deterministic (no key) — for a video
npm run demo:live    # real OFAC + GoPlus checks (BSCSCAN_KEY=xxx adds contract checks)
npm run typecheck
```

For `demo:real`, `cp .env.example .env` and set `DMX_API_KEY`. `.env` is gitignored;
never commit real keys.

```
```

Expected: malicious unlimited approval **blocked**, normal buy **allowed**,
execution hallucination **flagged**, trace tamper **detected**.

## How it maps to the architecture

```
pi Agent runtime
  beforeToolCall ── TradeGuard ─┐   L1 capture (reasoning+args)
                                │   L2 pre-engines: chain-safety + trade-safety
                                │   L3 policy gate → block?
                                │   L5 trace(pre, hash-chained)
     (only if allowed) ─────────┘
        │  forward to Agent OS MCP tool
        ▼
  afterToolCall ── TradeGuard ──    L2 post-engines: decision-integrity (claim vs result)
                                    L5 trace(post)  + inject warning to agent
```

Layout (layered; add a check by writing an engine, no core change):

```
src/
  core/          guard (engine pipeline) · policy gate · hash-chained trace · domain + pi types
  engines/       chain-safety · trade-safety · decision-integrity
  reputation/    ReputationProvider interface + mock and live (BscScan/GoPlus/OFAC) backends
  integrations/  llm (swappable platform+model) · agent-os (MCP) · agent-os-auth (OAuth)
  cli/           agentos-login
  demos/         basic · pi · agent-os · real · agent · pitch · live
  index.ts       public barrel (re-exports everything)
```

| Path | Role |
|------|------|
| `core/guard.ts` | `createTradeGuard()` → runs the pre/post engine pipeline, one verdict, trace, block/warn/inject |
| `core/policy.ts` · `core/trace.ts` | L3 gate (findings → allow/warn/block) · L5 append-only hash-chained trace |
| `core/types.ts` · `core/pi.ts` | domain types + `PreToolEngine`/`PostToolEngine` · pi's REAL hook contracts |
| `engines/chain-safety.ts` | on-chain: unlimited-approval & sanctioned/scam recipient hard blocks; poisoning + blacklist-linked-recipient warns |
| `engines/trade-safety.ts` | trade ops: excessive leverage · full cross-margin · oversized notional (configurable) |
| `engines/integrity.ts` | decision integrity: same-call + cross-step execution hallucination |
| `reputation/provider.ts` · `reputation/live.ts` | data-source interface + mock · BscScan + GoPlus + OFAC SDN |
| `integrations/agent-os.ts` · `agent-os-auth.ts` | MCP connection to Agent OS · interactive OAuth (CIMD, browser login) |
| `integrations/llm.ts` | swappable LLM brain: platform (DMX/OpenAI/DeepSeek/custom) + model both replaceable |

## Wiring into real pi

pi is a real dependency (`@earendil-works/pi-agent-core`, v0.85.1). The guard's
hooks plug straight into an `Agent`:

```ts
import { Agent } from "@earendil-works/pi-agent-core";
import { createTradeGuard, MockReputationProvider } from "tradeguard";

const guard = createTradeGuard({ reputation: new MockReputationProvider(/* … */) });
const agent = new Agent({
  streamFn,          // your provider stream (or a scripted one — see src/demo-pi.ts)
  convertToLlm,
  beforeToolCall: guard.beforeToolCall,
  afterToolCall: guard.afterToolCall,
  initialState: { systemPrompt, model, thinkingLevel: "off", tools },
});
await agent.prompt("…");
```

`src/demo-pi.ts` runs exactly this against a real `Agent` loop offline (scripted
LLM, real hook dispatch) and shows the malicious approval blocked before the tool
executes. The hook contract types come from `src/pi-types.ts`, which re-exports the
genuine `@earendil-works/pi-agent-core` / `pi-ai` types — no hand-written shims.

## Swappable LLM (platform + model)

TradeGuard is a tool others run, so the brain is pluggable — both the **platform**
(API gateway) and the **model** swap without touching the guard (`src/llm.ts`):

```ts
import { createLlm } from "./llm.ts";

const llm = createLlm({ platform: "dmx", model: "claude-haiku-4-5-20251001" });
// platform: "dmx" | "openai" | "deepseek" | a custom LlmPlatform object
// model:    any id the platform serves

new Agent({
  streamFn: llm.streamFn,
  beforeToolCall: guard.beforeToolCall,
  afterToolCall: guard.afterToolCall,
  initialState: { model: llm.model, systemPrompt, thinkingLevel: "off", tools },
});
```

Platforms are OpenAI-compatible endpoint descriptors; add your own by mutating
`PLATFORMS` or passing an `LlmPlatform`. Keys are read from env (`DMX_API_KEY` for
DMX) — never hardcoded. `npm run demo:real` runs a real DMX-hosted model driving the
guarded agent; the model gets socially engineered into an unlimited approval and
TradeGuard blocks it before it executes (the model then self-corrects from the
injected result).

## Connecting Binance Agent OS

Agent OS (launched 2026-08) is an **MCP server** at `https://agent.binance.com/mcp/agentic`.
pi has no built-in MCP client, so `src/agent-os.ts` is the bridge: it connects an
MCP client, lists the server's tools, and wraps each as a pi `AgentTool`. Register
those on a guarded `Agent` and every Agent OS call passes through TradeGuard first.

```ts
import { Agent } from "@earendil-works/pi-agent-core";
import { connectAgentOs } from "./agent-os.ts";

const os = await connectAgentOs({ authToken });   // bearer from the OAuth flow
const agent = new Agent({
  streamFn, convertToLlm,
  beforeToolCall: guard.beforeToolCall,
  afterToolCall: guard.afterToolCall,
  initialState: { systemPrompt, model, thinkingLevel: "off", tools: os.tools },
});
```

`npm run demo:agentos` runs this end-to-end over the **real MCP protocol** against a
local server that mimics Agent OS (in-memory transport), and shows a malicious
`wallet_approve` blocked before the server executes it.

**Going live:** the endpoint is OAuth-protected (`401` + `WWW-Authenticate`). Its auth
server advertises `client_id_metadata_document_supported` — i.e. **CIMD / URL-based
client ids**, so there's *no* developer-portal registration. You host one small JSON
doc at a public HTTPS URL and that URL is your client_id:

```bash
npm run agentos:login          # 1st run: writes agent-os-client.json + instructions
# host agent-os-client.json at an HTTPS URL, set its "client_id" to that URL,
# then in .env:  AGENT_OS_CLIENT_METADATA_URL=<that url>
npm run agentos:login          # 2nd run: opens the browser, you authorize, token stored
```

The full flow (discovery, CIMD, PKCE, loopback redirect, token storage/refresh, tool
wrapping) is in `src/agent-os-auth.ts`. The only human parts are hosting that JSON and
clicking authorize with an eligible Binance account.

It starts a loopback server, lets the MCP SDK discover the auth server + register the
client, opens Binance's consent page, exchanges the code (PKCE) for a token, and saves
it to `.agentos-auth.json` (gitignored; refreshed automatically). Then in code:

```ts
import { connectAgentOsWithOAuth } from "./agent-os-auth.ts";
const os = await connectAgentOsWithOAuth();     // silent if a valid token is stored
new Agent({ ...guardHooks, initialState: { tools: os.tools, ... } });
```

The only thing that can't be scripted is the human parts of that browser step: an
**eligible Binance account** and clicking **authorize** (plus choosing the subaccount
+ scopes). Everything around it — discovery, registration, PKCE, token storage and
refresh, tool wrapping — is done. (A stored bearer token still works too, via
`connectAgentOs({ authToken })`.)

**Caveat:** per Binance, on-chain `approve`/`transfer` are **not in the MCP server
yet** (they live behind the Wallet Agentic Hub / Binance APIs / x402). So this MCP
path mainly feeds the decision-integrity engine; the chain-safety engine hooks the
wallet surface once it is exposed.

## Deliberately left for the next iteration

- **Pre-execution confidence score** — coherence of the agent's reasoning and
  data-citation checks (e.g. reconcile a claimed price against a live quote),
  reproducibility (replay flip-rate), long-run calibration (Brier). Runs as another
  `PreToolEngine`; hard-verifiable checks can block, softer ones warn.
- **Dashboard** over the JSONL trace.

## Verify before building further

Proven: pi's loop invokes `beforeToolCall` / `afterToolCall` for tool calls
(`npm run demo:pi`), a `{ block: true }` return stops execution, and this holds for
**MCP-provided tools over the real MCP protocol** (`npm run demo:agentos`). Still to
confirm against the **live** Agent OS:

1. End-to-end against `agent.binance.com/mcp/agentic` with a real OAuth token (the
   in-memory demo uses the identical client/wrapping path).
2. Which live Agent OS tool names/args carry on-chain `approve`/`transfer` semantics,
   so `parseAction()` matches the real surface.
