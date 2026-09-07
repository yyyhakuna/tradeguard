import type { BeforeToolCallContext, ToolCall } from "../core/pi.ts";
import type { EngineResult, Finding, PreToolEngine } from "../core/types.ts";

/**
 * L2 — Trade-operation safety. Runs BEFORE the order reaches Agent OS.
 *
 * Where chain-safety asks "is the *counterparty* dangerous?", this asks "is the
 * *trade itself* reckless?" — the ways an agent blows up an account even when the
 * venue and token are perfectly legitimate:
 *   - excessive leverage
 *   - full-cross-margin (whole account as collateral for one position)
 *   - oversized notional (position too large in absolute terms)
 *
 * All limits are configurable; hard blocks are reserved for values past the hard
 * cap, softer breaches only warn. Thresholds decide, evidence proves.
 */
export interface TradeLimits {
  /** Leverage at/above this is blocked. Default 20x. */
  maxLeverage: number;
  /** Leverage at/above this warns (but allows). Default 10x. */
  warnLeverage: number;
  /** Order notional (price*qty or quote amount) at/above this is blocked. Default: off. */
  maxNotional?: number;
  /** Cross-margin at/above this leverage is treated as all-in and blocked. Default 10x. */
  crossMarginMaxLeverage: number;
}

export const DEFAULT_TRADE_LIMITS: TradeLimits = {
  maxLeverage: 20,
  warnLeverage: 10,
  crossMarginMaxLeverage: 10,
};

interface TradeAction {
  symbol?: string;
  side?: string;
  leverage?: number;
  marginMode?: "cross" | "isolated" | string;
  reduceOnly?: boolean;
  notional?: number;
}

/** Recognize order-placing tool calls and normalize their risk-relevant fields. */
function parseTrade(call: ToolCall): TradeAction | undefined {
  const name = call.name.toLowerCase();
  const isOrder = /(order|trade|position|futures|perp|margin|leverage|buy|sell)/.test(name);
  if (!isOrder) return undefined;
  const a = call.arguments ?? {};

  const marginMode = str(a.marginMode ?? a.margin_mode ?? a.marginType ?? a.tradeMode)?.toLowerCase();
  return {
    symbol: str(a.symbol ?? a.pair ?? a.instrument),
    side: str(a.side ?? a.direction),
    leverage: num(a.leverage ?? a.lever ?? a.leverageLevel),
    marginMode: marginMode === "crossed" ? "cross" : marginMode,
    reduceOnly: bool(a.reduceOnly ?? a.reduce_only ?? a.closePosition),
    notional: num(a.notional ?? a.quoteQty ?? a.quoteOrderQty ?? a.cost),
  };
}

export class TradeSafetyEngine implements PreToolEngine {
  readonly id = "trade-safety" as const;
  private readonly limits: TradeLimits;

  constructor(limits: Partial<TradeLimits> = {}) {
    this.limits = { ...DEFAULT_TRADE_LIMITS, ...limits };
  }

  screen(ctx: BeforeToolCallContext): EngineResult {
    const call = ctx.toolCall;
    const t = parseTrade(call);
    if (!t) return { findings: [] };
    // Closing/reduce-only orders lower risk — never block those on size/leverage.
    if (t.reduceOnly) return { findings: [] };

    const findings: Finding[] = [];
    const ev = (extra: Record<string, unknown>) => ({ toolCallId: call.id, symbol: t.symbol, ...extra });

    if (t.leverage !== undefined) {
      if (t.leverage >= this.limits.maxLeverage) {
        findings.push({
          engine: "trade-safety",
          code: "excessive-leverage",
          severity: "CRITICAL",
          summary: `Leverage ${t.leverage}x is at/above the hard cap (${this.limits.maxLeverage}x)`,
          evidence: ev({ leverage: t.leverage, maxLeverage: this.limits.maxLeverage }),
        });
      } else if (t.leverage >= this.limits.warnLeverage) {
        findings.push({
          engine: "trade-safety",
          code: "high-leverage",
          severity: "WARN",
          summary: `Leverage ${t.leverage}x exceeds the caution threshold (${this.limits.warnLeverage}x)`,
          evidence: ev({ leverage: t.leverage, warnLeverage: this.limits.warnLeverage }),
        });
      }
    }

    // Cross margin puts the whole account behind one position; block when also levered up.
    if (t.marginMode === "cross" && (t.leverage ?? 1) >= this.limits.crossMarginMaxLeverage) {
      findings.push({
        engine: "trade-safety",
        code: "full-cross-margin-position",
        severity: "CRITICAL",
        summary: `Cross-margin at ${t.leverage ?? "?"}x risks the entire account on one position`,
        evidence: ev({ marginMode: t.marginMode, leverage: t.leverage, threshold: this.limits.crossMarginMaxLeverage }),
      });
    }

    if (this.limits.maxNotional !== undefined && t.notional !== undefined && t.notional >= this.limits.maxNotional) {
      findings.push({
        engine: "trade-safety",
        code: "oversized-order",
        severity: "CRITICAL",
        summary: `Order notional ${t.notional} is at/above the cap (${this.limits.maxNotional})`,
        evidence: ev({ notional: t.notional, maxNotional: this.limits.maxNotional }),
      });
    }

    return { findings };
  }
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}
function num(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}
function bool(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  return undefined;
}
