# TradeGuard (skeleton)

A **trading safety layer** for pi-hosted agents. It plugs into pi's
`beforeToolCall` / `afterToolCall` hooks and screens every tool call *before* it
reaches Binance Agent OS — for on-chain risk and for AI decision hallucination.

Product framing (contest Track A — Agent Creation): a trading agent whose every
action passes through a safety layer.

## Run it

```bash
npm install
npm run demo        # three scenarios + tamper check, no network, no pi build
npm run typecheck
```

Expected: malicious unlimited approval **blocked**, normal buy **allowed**,
execution hallucination **flagged**, trace tamper **detected**.

## How it maps to the architecture

```
pi Agent runtime
  beforeToolCall ── TradeGuard ─┐   L1 capture (reasoning+args)
                                │   L2 chain-safety screen
                                │   L3 policy gate → block? 
                                │   L5 trace(pre, hash-chained)
     (only if allowed) ─────────┘
        │  forward to Agent OS MCP tool
        ▼
  afterToolCall ── TradeGuard ──    L2 decision-integrity (args vs result)
                                    L5 trace(post)  + inject warning to agent
```

| File | Role |
|------|------|
| `src/index.ts` | `createTradeGuard()` → the pi hook pair |
| `src/engines/chain-safety.ts` | L2 on-chain: unlimited-approval & sanctioned/scam recipient hard blocks, poisoning warn |
| `src/engines/integrity.ts` | L2 decision integrity: execution-hallucination (same-call case) |
| `src/engines/reputation.ts` | data-source interface + offline mock (swap for GoPlus/OFAC/BscScan) |
| `src/policy.ts` | L3 gate: findings → allow/warn/block |
| `src/trace.ts` | L5 append-only, hash-chained, tamper-evident trace |
| `src/pi-types.ts` | shims of pi's hook contracts — delete on real integration |

## Wiring into real pi

```ts
import { Agent } from "@earendil-works/pi-agent";
import { createTradeGuard, MockReputationProvider } from "tradeguard";

const guard = createTradeGuard({ reputation: new MockReputationProvider(/* … */) });
new Agent({
  ...opts,
  beforeToolCall: guard.beforeToolCall,
  afterToolCall: guard.afterToolCall,
});
```

Then delete `src/pi-types.ts` and import the identical types from
`@earendil-works/pi-agent`.

## Deliberately left for the next iteration

- **Cross-step execution hallucination** — agent claims "bought 0.5 BTC" in a
  *later* message. The ground-truth results are already stored in the trace;
  the reconciliation check reads future `assistantMessage`s against them.
- **Confidence / credibility** — coherence (LLM judge, ring-fenced),
  reproducibility (replay flip-rate), long-run calibration (Brier).
- **Real reputation adapters** — BscScan, GoPlus Security, OFAC SDN.
- **Dashboard** over the JSONL trace.

## Verify before building further

1. pi's hooks fire for **MCP-provided** tools too (Agent OS tools), not only
   built-in tools. (Loop applies them to all tool calls; confirm with a live MCP tool.)
2. Which Agent OS tool names/args carry on-chain `approve`/`transfer` semantics,
   so `parseAction()` matches the real surface.
