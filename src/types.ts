/** Core TradeGuard domain types shared across engines, policy, and trace. */

/** Severity of a single finding. Ordering matters: CRITICAL > WARN > INFO. */
export type Severity = "CRITICAL" | "WARN" | "INFO";

/** Final gate decision for one tool call. */
export type Verdict = "block" | "warn" | "allow";

/** Which engine produced a finding. */
export type EngineId = "chain-safety" | "decision-integrity";

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
