import type { AfterToolCallContext } from "../pi-types.ts";
import type { EngineResult, Finding } from "../types.ts";

/**
 * L2 — Decision integrity (execution-hallucination half).
 *
 * Runs AFTER the tool executes, so it can compare what the agent asked for
 * (`args` / reasoning) against the ground-truth `result`. The account/tool
 * result is the single source of truth: if the agent's own words claim a fill
 * that the result contradicts, that's a confirmed execution hallucination.
 *
 * Two modes, both grounded in the tool result as the single source of truth:
 *   - same-call: the requesting message already asserts success while the tool
 *     errored (`screen`).
 *   - cross-step: the agent claims success in a LATER narrative message, which
 *     contradicts a tool result recorded earlier (`reconcileClaims`).
 */

/** A recorded ground-truth outcome of one executed tool call. */
export interface ToolOutcome {
  toolName: string;
  isError: boolean;
  /** Short human-readable result text (or error). */
  summary: string;
}

/** Words an agent uses to assert an action completed. */
const SUCCESS_CLAIM = /\b(bought|sold|filled|executed|success(?:ful|fully)?|done|complete[d]?|transferred|sent|approved|settled|updated|confirmed|went through)\b/i;

export class DecisionIntegrityEngine {
  screen(ctx: AfterToolCallContext): EngineResult {
    const reasoning = extractReasoning(ctx.assistantMessage);
    if (SUCCESS_CLAIM.test(reasoning) && ctx.isError) {
      return {
        findings: [
          {
            engine: "decision-integrity",
            code: "claimed-success-on-failed-call",
            severity: "CRITICAL",
            summary: "Agent's reasoning asserts success, but the tool call returned an error",
            evidence: {
              toolCallId: ctx.toolCall.id,
              reasoningExcerpt: reasoning.slice(0, 240),
              resultIsError: ctx.isError,
              resultText: firstText(ctx.result.content).slice(0, 240),
            },
          },
        ],
      };
    }
    return { findings: [] };
  }
}

/**
 * Cross-step reconciliation: does this narrative `claimText` assert success for
 * a tool call that actually errored earlier? Ground truth (the recorded
 * `outcomes`) wins — the claim is the hallucination, not the other way around.
 */
export function reconcileClaims(claimText: string, outcomes: ToolOutcome[]): Finding[] {
  if (!SUCCESS_CLAIM.test(claimText)) return [];
  return outcomes
    .filter((o) => o.isError)
    .map((o) => ({
      engine: "decision-integrity" as const,
      code: "hallucinated-success-cross-step",
      severity: "CRITICAL" as const,
      summary: `Agent claims success, but ${o.toolName} actually failed`,
      evidence: {
        toolName: o.toolName,
        actualResult: o.summary.slice(0, 200),
        claimExcerpt: claimText.slice(0, 200),
      },
    }));
}

export function extractReasoning(msg: { content: Array<{ type: string; text?: string }> }): string {
  return msg.content
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text as string)
    .join(" ")
    .trim();
}

function firstText(content: Array<{ type: string; text?: string }>): string {
  return content.find((c) => c.type === "text")?.text ?? "";
}
