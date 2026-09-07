import type {
  AfterToolCallContext,
  AfterToolCallResult,
  BeforeToolCallContext,
  BeforeToolCallResult,
} from "./pi-types.ts";
import { ChainSafetyEngine } from "./engines/chain-safety.ts";
import { DecisionIntegrityEngine, extractReasoning } from "./engines/integrity.ts";
import type { ReputationProvider } from "./engines/reputation.ts";
import { blockReason, decide } from "./policy.ts";
import { TraceStore } from "./trace.ts";

export interface TradeGuardOptions {
  reputation: ReputationProvider;
  /** Optional JSONL path to persist the hash-chained trace. */
  traceSink?: string;
  /** Called whenever a call is blocked or warned (for alerting / dashboard). */
  onVerdict?: (v: { verdict: string; toolCall: string; reasons: string[] }) => void;
}

/**
 * Build the pi hook pair. Plug the returned handlers straight into the Agent:
 *
 *   const guard = createTradeGuard({ reputation });
 *   new Agent({ ...opts, beforeToolCall: guard.beforeToolCall,
 *                        afterToolCall:  guard.afterToolCall });
 *
 * `beforeToolCall`  = L1 capture + L2 chain-safety + L3 gate + L5 trace(pre)
 * `afterToolCall`   = L2 decision-integrity + L5 trace(post)
 */
export function createTradeGuard(opts: TradeGuardOptions) {
  const chain = new ChainSafetyEngine(opts.reputation);
  const integrity = new DecisionIntegrityEngine();
  const trace = new TraceStore(opts.traceSink);

  async function beforeToolCall(
    ctx: BeforeToolCallContext,
  ): Promise<BeforeToolCallResult | undefined> {
    const { findings } = await chain.screen(ctx.toolCall);
    const verdict = decide(findings);

    trace.append({
      phase: "pre",
      toolCallId: ctx.toolCall.id,
      toolName: ctx.toolCall.name,
      reasoningExcerpt: extractReasoning(ctx.assistantMessage).slice(0, 240),
      args: ctx.args,
      findings,
      verdict,
    });

    if (verdict === "block") {
      opts.onVerdict?.({
        verdict,
        toolCall: ctx.toolCall.name,
        reasons: findings.filter((f) => f.severity === "CRITICAL").map((f) => f.code),
      });
      return { block: true, reason: blockReason(findings) };
    }
    if (verdict === "warn") {
      opts.onVerdict?.({
        verdict,
        toolCall: ctx.toolCall.name,
        reasons: findings.map((f) => f.code),
      });
    }
    return undefined; // allow
  }

  async function afterToolCall(
    ctx: AfterToolCallContext,
  ): Promise<AfterToolCallResult | undefined> {
    const { findings } = integrity.screen(ctx);
    const verdict = decide(findings);

    trace.append({
      phase: "post",
      toolCallId: ctx.toolCall.id,
      toolName: ctx.toolCall.name,
      reasoningExcerpt: extractReasoning(ctx.assistantMessage).slice(0, 240),
      args: ctx.args,
      findings,
      verdict,
    });

    if (findings.length > 0) {
      // The tool already ran, so this is a detection, not a block — report it honestly.
      opts.onVerdict?.({
        verdict: verdict === "block" ? "flagged" : verdict,
        toolCall: ctx.toolCall.name,
        reasons: findings.map((f) => f.code),
      });
      // Inject the warning into what the agent sees next, so it can self-correct.
      return {
        content: [
          ...ctx.result.content,
          { type: "text", text: `\n[TradeGuard] ${findings.map((f) => f.summary).join("; ")}` },
        ],
      };
    }
    return undefined;
  }

  return { beforeToolCall, afterToolCall, trace };
}

export { TraceStore } from "./trace.ts";
export { MockReputationProvider } from "./engines/reputation.ts";
export type {
  AddressInfo,
  ContractInfo,
  ReputationProvider,
} from "./engines/reputation.ts";
export { LiveReputationProvider } from "./engines/live-reputation.ts";
export type { LiveReputationOptions } from "./engines/live-reputation.ts";

// Swappable LLM brain (platform + model both replaceable).
export { createLlm, PLATFORMS } from "./llm.ts";
export type { Llm, LlmPlatform, CreateLlmOptions } from "./llm.ts";

// Agent OS (MCP) connector.
export { connectAgentOs, toolsFromClient, AGENT_OS_MCP_URL } from "./agent-os.ts";
export type { AgentOsConnection, ConnectAgentOsOptions } from "./agent-os.ts";

// Agent OS interactive OAuth (browser login).
export {
  authorizeAgentOs,
  connectAgentOsWithOAuth,
  FileOAuthProvider,
} from "./agent-os-auth.ts";
export type { OAuthConnectOptions } from "./agent-os-auth.ts";
