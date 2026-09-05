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
 * This MVP catches the same-call case (agent's reasoning already asserts success
 * while the tool errored / returned no fill). The cross-step case — the agent
 * claims "bought 0.5 BTC" in a LATER message — is caught by keeping these
 * ground-truth results in the TraceStore and checking future `assistantMessage`s
 * against them. That reconciliation is the next iteration; the storage it needs
 * already exists.
 */
export class DecisionIntegrityEngine {
  screen(ctx: AfterToolCallContext): EngineResult {
    const findings: Finding[] = [];
    const reasoning = extractReasoning(ctx.assistantMessage);
    const claimsSuccess = /\b(bought|sold|filled|executed|success|done|transferred)\b/i.test(reasoning);

    if (claimsSuccess && ctx.isError) {
      findings.push({
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
      });
    }
    return { findings };
  }
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
