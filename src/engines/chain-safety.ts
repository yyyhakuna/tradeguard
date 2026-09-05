import type { ToolCall } from "../pi-types.ts";
import type { EngineResult, Finding } from "../types.ts";
import type { ReputationProvider } from "./reputation.ts";

/** 2^256 - 1: the canonical "unlimited" ERC-20 approval amount. */
const MAX_UINT256 = (1n << 256n) - 1n;
/** Anything above this we treat as an effectively-unlimited allowance. */
const UNLIMITED_THRESHOLD = 1n << 200n;

/**
 * Recognize on-chain tool calls and normalize their intent. Real Agent OS tool
 * names go here; we match loosely so renames don't silently disable screening.
 */
interface OnchainAction {
  kind: "approve" | "transfer" | "other";
  spender?: string;
  recipient?: string;
  contract?: string;
  amount?: bigint;
}

function parseAction(call: ToolCall): OnchainAction | undefined {
  const name = call.name.toLowerCase();
  const a = call.arguments ?? {};
  const isOnchain = /(approve|transfer|send|swap|wallet|tx|transaction)/.test(name);
  if (!isOnchain) return undefined;

  if (name.includes("approve")) {
    return {
      kind: "approve",
      spender: str(a.spender ?? a.to ?? a.operator),
      contract: str(a.token ?? a.contract ?? a.asset),
      amount: big(a.amount ?? a.value ?? a.allowance),
    };
  }
  if (/(transfer|send)/.test(name)) {
    return {
      kind: "transfer",
      recipient: str(a.to ?? a.recipient ?? a.dest),
      contract: str(a.token ?? a.contract ?? a.asset),
      amount: big(a.amount ?? a.value),
    };
  }
  return { kind: "other" };
}

/**
 * L2 — On-chain safety. Runs BEFORE the call reaches Agent OS.
 * MVP hard blocks: (1) unlimited approval to an unverified/flagged contract,
 * (2) transfer to a sanctioned or known-scam address. Plus a poisoning WARN.
 */
export class ChainSafetyEngine {
  constructor(private readonly rep: ReputationProvider) {}

  async screen(call: ToolCall): Promise<EngineResult> {
    const action = parseAction(call);
    if (!action || action.kind === "other") return { findings: [] };
    const findings: Finding[] = [];

    if (action.kind === "approve" && action.spender) {
      const unlimited = action.amount !== undefined && action.amount >= UNLIMITED_THRESHOLD;
      const info = await this.rep.getContract(action.spender);
      if (unlimited && (!info.verified || info.flags.length > 0)) {
        findings.push({
          engine: "chain-safety",
          code: "unlimited-approval-to-unverified-contract",
          severity: "CRITICAL",
          summary: `Unlimited token approval to unverified/flagged spender ${action.spender}`,
          evidence: {
            spender: action.spender,
            amountIsMax: action.amount === MAX_UINT256,
            verified: info.verified,
            flags: info.flags,
            toolCallId: call.id,
          },
        });
      }
    }

    if (action.kind === "transfer" && action.recipient) {
      const info = await this.rep.getAddress(action.recipient);
      if (info.sanctioned || info.knownScam) {
        findings.push({
          engine: "chain-safety",
          code: info.sanctioned ? "transfer-to-sanctioned-address" : "transfer-to-known-scam",
          severity: "CRITICAL",
          summary: `Transfer to ${info.sanctioned ? "sanctioned" : "known-scam"} address ${action.recipient}`,
          evidence: { recipient: action.recipient, ...info, toolCallId: call.id },
        });
      }
      const poison = await this.detectPoisoning(action.recipient);
      if (poison) findings.push(poison);
    }

    return { findings };
  }

  /** Address poisoning: recipient looks like a known counterparty but isn't. */
  private async detectPoisoning(recipient: string): Promise<Finding | undefined> {
    const known = await this.rep.knownCounterparties();
    const r = recipient.toLowerCase();
    for (const k of known) {
      if (k !== r && looksAlike(k, r)) {
        return {
          engine: "chain-safety",
          code: "possible-address-poisoning",
          severity: "WARN",
          summary: `Recipient resembles known counterparty ${k} but differs`,
          evidence: { recipient: r, resembles: k },
        };
      }
    }
    return undefined;
  }
}

/** Same 4-char prefix and suffix but not identical = classic poisoning lure. */
function looksAlike(a: string, b: string): boolean {
  const head = 6; // "0x" + 4
  const tail = 4;
  return (
    a.length === b.length &&
    a.slice(0, head) === b.slice(0, head) &&
    a.slice(-tail) === b.slice(-tail) &&
    a !== b
  );
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}
function big(v: unknown): bigint | undefined {
  try {
    if (typeof v === "bigint") return v;
    if (typeof v === "number") return BigInt(Math.trunc(v));
    if (typeof v === "string" && v.trim() !== "") return BigInt(v);
  } catch {
    /* unparseable amount -> treat as unknown */
  }
  return undefined;
}
