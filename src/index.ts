/**
 * TradeGuard — public API surface.
 *
 * Layout:
 *   core/          the guard, policy gate, hash-chained trace, domain + pi types
 *   engines/       screening engines (chain-safety, trade-safety, decision-integrity)
 *   reputation/    the ReputationProvider interface + mock and live backends
 *   integrations/  LLM platforms, Agent OS (MCP) connection + OAuth
 *   cli/           runnable entrypoints (agentos:login)
 *   demos/         the demo scripts
 *
 * Everything a consumer needs is re-exported here.
 */

// ── core ─────────────────────────────────────────────────────────────────────
export { createTradeGuard } from "./core/guard.ts";
export type { TradeGuardOptions } from "./core/guard.ts";
export { TraceStore } from "./core/trace.ts";
export { decide, blockReason } from "./core/policy.ts";
export type {
  Severity,
  Verdict,
  EngineId,
  Finding,
  EngineResult,
  PreToolEngine,
  PostToolEngine,
  TraceEntry,
} from "./core/types.ts";
export type {
  AssistantMessage,
  ToolCall,
  TextContent,
  ImageContent,
  AgentContext,
  AgentToolResult,
  BeforeToolCallContext,
  BeforeToolCallResult,
  AfterToolCallContext,
  AfterToolCallResult,
} from "./core/pi.ts";

// ── engines ──────────────────────────────────────────────────────────────────
export { ChainSafetyEngine } from "./engines/chain-safety.ts";
export { TradeSafetyEngine, DEFAULT_TRADE_LIMITS } from "./engines/trade-safety.ts";
export type { TradeLimits } from "./engines/trade-safety.ts";
export { DecisionIntegrityEngine, extractReasoning, reconcileClaims } from "./engines/integrity.ts";
export type { ToolOutcome } from "./engines/integrity.ts";

// ── reputation ───────────────────────────────────────────────────────────────
export { MockReputationProvider } from "./reputation/provider.ts";
export type { ReputationProvider, ContractInfo, AddressInfo } from "./reputation/provider.ts";
export { LiveReputationProvider } from "./reputation/live.ts";
export type { LiveReputationOptions } from "./reputation/live.ts";

// ── integrations ─────────────────────────────────────────────────────────────
export { createLlm, PLATFORMS } from "./integrations/llm.ts";
export type { Llm, LlmPlatform, CreateLlmOptions } from "./integrations/llm.ts";
export { connectAgentOs, toolsFromClient, AGENT_OS_MCP_URL } from "./integrations/agent-os.ts";
export type { AgentOsConnection, ConnectAgentOsOptions } from "./integrations/agent-os.ts";
export {
  authorizeAgentOs,
  connectAgentOsWithOAuth,
  FileOAuthProvider,
} from "./integrations/agent-os-auth.ts";
export type { OAuthConnectOptions } from "./integrations/agent-os-auth.ts";
