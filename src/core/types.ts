/** Core TradeGuard domain types shared across engines, policy, and trace. */
import type { AfterToolCallContext, BeforeToolCallContext } from "./pi.ts";

/** Severity of a single finding. Ordering matters: CRITICAL > WARN > INFO. */
export type Severity = "CRITICAL" | "WARN" | "INFO";

/** Final gate decision for one tool call. */
export type Verdict = "block" | "warn" | "allow";

/** Which engine produced a finding. */
export type EngineId = "chain-safety" | "trade-safety" | "decision-integrity";

/**
 * A single evidence-backed observation. The golden rule: every finding MUST
 * carry `evidence` — concrete ids/values that let a human reproduce the call.
 * A finding without evidence is an opinion, and opinions never move the score.
 */
export interface Finding {
  engine: EngineId;
  /** kebab-case check id, e.g. "unlimited-approval-to-unverified-contract". */
  code: string;
  severity: Severity;
  summary: string;
  /** Concrete proof: addresses, amounts, tool-call ids, snapshots. */
  evidence: Record<string, unknown>;
}

/** Result of running a screening engine over one tool call. */
export interface EngineResult {
  findings: Finding[];
}

/**
 * An engine that screens a tool call BEFORE it executes (in `beforeToolCall`).
 * Add a pre-trade check by implementing this and passing it to `createTradeGuard`.
 */
export interface PreToolEngine {
  readonly id: EngineId;
  screen(ctx: BeforeToolCallContext): EngineResult | Promise<EngineResult>;
}

/**
 * An engine that screens a tool call AFTER it executes (in `afterToolCall`),
 * with the ground-truth result available.
 */
export interface PostToolEngine {
  readonly id: EngineId;
  screen(ctx: AfterToolCallContext): EngineResult | Promise<EngineResult>;
}

/** One append-only, hash-chained record of a screened tool call. */
export interface TraceEntry {
  seq: number;
  ts: string; // ISO8601
  phase: "pre" | "post";
  toolCallId: string;
  toolName: string;
  /** Truncated excerpt of the agent's reasoning that requested this call. */
  reasoningExcerpt: string;
  args: unknown;
  findings: Finding[];
  verdict: Verdict;
  prevHash: string;
  hash: string;
}
