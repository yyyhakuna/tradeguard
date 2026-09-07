/**
 * createTradeGuard — composes the engine pipeline into the pi hook pair.
 *
 * The guard is a thin orchestrator: it runs a list of PRE-tool engines in
 * `beforeToolCall` and POST-tool engines in `afterToolCall`, collapses their
 * findings into one verdict (policy), records everything on the hash-chained
 * trace, and blocks / warns / injects accordingly.
 *
 * Extensibility: pass your own `preEngines` / `postEngines` to add or replace
 * checks without touching this file. The defaults are:
 *   pre  = [ ChainSafetyEngine, TradeSafetyEngine ]
 *   post = [ DecisionIntegrityEngine ]
 *
 *   const guard = createTradeGuard({ reputation });
 *   new Agent({ ...opts, beforeToolCall: guard.beforeToolCall,
 *                        afterToolCall:  guard.afterToolCall });
 */
import type {
  AfterToolCallContext,
  AfterToolCallResult,
  BeforeToolCallContext,
  BeforeToolCallResult,
} from "./pi.ts";
import type { Finding, PostToolEngine, PreToolEngine } from "./types.ts";
import { blockReason, decide } from "./policy.ts";
import { TraceStore } from "./trace.ts";
import { ChainSafetyEngine } from "../engines/chain-safety.ts";
import { TradeSafetyEngine } from "../engines/trade-safety.ts";
import type { TradeLimits } from "../engines/trade-safety.ts";
import { DecisionIntegrityEngine, extractReasoning } from "../engines/integrity.ts";
import type { ReputationProvider } from "../reputation/provider.ts";

export interface TradeGuardOptions {
  /** Reputation backend for the chain-safety engine (mock or live). */
  reputation: ReputationProvider;
  /** Thresholds for the trade-safety engine (leverage, notional, margin mode). */
  tradeLimits?: Partial<TradeLimits>;
  /** Optional JSONL path to persist the hash-chained trace. */
  traceSink?: string;
  /** Called whenever a call is blocked or warned (for alerting / dashboard). */
  onVerdict?: (v: { verdict: string; toolCall: string; reasons: string[] }) => void;
  /** Override the pre-execution engine pipeline (defaults: chain-safety + trade-safety). */
  preEngines?: PreToolEngine[];
  /** Override the post-execution engine pipeline (default: decision-integrity). */
  postEngines?: PostToolEngine[];
}

export function createTradeGuard(opts: TradeGuardOptions) {
  const pre: PreToolEngine[] =
    opts.preEngines ?? [new ChainSafetyEngine(opts.reputation), new TradeSafetyEngine(opts.tradeLimits)];
  const post: PostToolEngine[] = opts.postEngines ?? [new DecisionIntegrityEngine()];
  const trace = new TraceStore(opts.traceSink);

  async function runPre(ctx: BeforeToolCallContext): Promise<Finding[]> {
    const results = await Promise.all(pre.map((e) => e.screen(ctx)));
    return results.flatMap((r) => r.findings);
  }
  async function runPost(ctx: AfterToolCallContext): Promise<Finding[]> {
    const results = await Promise.all(post.map((e) => e.screen(ctx)));
    return results.flatMap((r) => r.findings);
  }

  async function beforeToolCall(
    ctx: BeforeToolCallContext,
  ): Promise<BeforeToolCallResult | undefined> {
    const findings = await runPre(ctx);
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
      opts.onVerdict?.({ verdict, toolCall: ctx.toolCall.name, reasons: findings.map((f) => f.code) });
    }
    return undefined; // allow
  }

  async function afterToolCall(
    ctx: AfterToolCallContext,
  ): Promise<AfterToolCallResult | undefined> {
    const findings = await runPost(ctx);
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
