/**
 * Standalone demo: no pi build, no network. It fabricates the exact context
 * pi would hand our hooks, then shows three outcomes:
 *   1. a malicious unlimited approval  -> BLOCKED before reaching Agent OS
 *   2. a normal spot buy               -> ALLOWED
 *   3. an execution hallucination      -> FLAGGED after the call
 * Finally it proves the trace is tamper-evident.
 *
 * Run:  npm install && npm run demo
 */
import { createTradeGuard, MockReputationProvider } from "./index.ts";
import type { AfterToolCallContext, BeforeToolCallContext } from "./pi-types.ts";
import type { TraceEntry } from "./types.ts";

const SCAM_SPENDER = "0xbadc0ffee0ddf00ddead1337beef00000000cafe";

const reputation = new MockReputationProvider(
  { [SCAM_SPENDER]: { verified: false, ageDays: 1, flags: ["known-drainer"] } },
  {},
  [],
);

const seenVerdicts: string[] = [];
const guard = createTradeGuard({
  reputation,
  onVerdict: (v) => seenVerdicts.push(`${v.verdict.toUpperCase()} ${v.toolCall} (${v.reasons.join(",")})`),
});

function assistant(text: string, toolCall: { id: string; name: string; arguments: Record<string, any> }) {
  return {
    role: "assistant" as const,
    content: [{ type: "text", text }, { type: "toolCall", ...toolCall }],
  };
}

async function run() {
  console.log("=== TradeGuard skeleton demo ===\n");

  // 1) Malicious unlimited approval -> must be blocked pre-execution.
  const evil = { id: "call-1", name: "wallet_approve", arguments: { token: "USDT", spender: SCAM_SPENDER, amount: ((1n << 256n) - 1n).toString() } };
  const beforeEvil: BeforeToolCallContext = {
    assistantMessage: assistant("Approving USDT so the strategy can trade.", evil),
    toolCall: { type: "toolCall", ...evil },
    args: evil.arguments,
    context: {},
  };
  const r1 = await guard.beforeToolCall(beforeEvil);
  console.log("[1] unlimited approval to known-drainer");
  console.log("    ->", r1?.block ? "BLOCKED ✅" : "allowed ❌");
  if (r1?.reason) console.log("   ", r1.reason.replace(/\n/g, "\n    "));
  console.log();

  // 2) Normal spot buy -> allowed.
  const buy = { id: "call-2", name: "spot_place_order", arguments: { symbol: "BTCUSDT", side: "buy", qty: 0.01 } };
  const r2 = await guard.beforeToolCall({
    assistantMessage: assistant("Momentum turning up; buying a small clip.", buy),
    toolCall: { type: "toolCall", ...buy },
    args: buy.arguments,
    context: {},
  });
  console.log("[2] normal spot buy");
  console.log("    ->", r2?.block ? "blocked ❌" : "ALLOWED ✅");
  console.log();

  // 3) Execution hallucination: reasoning claims success, tool errored.
  const afterCtx: AfterToolCallContext = {
    assistantMessage: assistant("Order filled — bought 0.01 BTC.", buy),
    toolCall: { type: "toolCall", ...buy },
    args: buy.arguments,
    result: { content: [{ type: "text", text: "error: insufficient balance" }], isError: true },
    isError: true,
    context: {},
  };
  const r3 = await guard.afterToolCall(afterCtx);
  console.log("[3] agent claims 'filled' but the call errored");
  const flagged = r3?.content?.some((c) => c.text?.includes("[TradeGuard]"));
  console.log("    ->", flagged ? "HALLUCINATION FLAGGED ✅" : "missed ❌");
  console.log();

  // Trace integrity.
  console.log("=== verdict log ===");
  seenVerdicts.forEach((v) => console.log("   ", v));
  console.log("\n=== trace tamper check ===");
  const entries: TraceEntry[] = guard.trace.all();
  console.log(`    entries recorded: ${entries.length}`);
  console.log("    chain valid:", guard.trace.verify(entries).ok ? "✅" : "❌");
  const tampered: TraceEntry[] = structuredClone(entries);
  tampered[0].args = { tampered: true };
  const bad = guard.trace.verify(tampered);
  console.log(
    "    after editing entry[0].args:",
    bad.ok ? "✅ (unexpected!)" : `❌ broken@seq${bad.brokenAtSeq} (tamper detected)`,
  );
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
