import type { Finding, Verdict } from "./types.ts";

/**
 * L3 — Policy gate. Collapses findings into one verdict.
 * MVP rule: any CRITICAL -> block; else any WARN -> warn; else allow.
 * Deliberately dumb and legible; richer policy (per-scope thresholds, user
 * risk profile) plugs in here without touching the engines.
 */
export function decide(findings: Finding[]): Verdict {
  if (findings.some((f) => f.severity === "CRITICAL")) return "block";
  if (findings.some((f) => f.severity === "WARN")) return "warn";
  return "allow";
}

/** Human-readable reason surfaced to the agent when a call is blocked. */
export function blockReason(findings: Finding[]): string {
  const crit = findings.filter((f) => f.severity === "CRITICAL");
  return (
    "TradeGuard blocked this action:\n" +
    crit.map((f) => `  - [${f.code}] ${f.summary}`).join("\n")
  );
}
