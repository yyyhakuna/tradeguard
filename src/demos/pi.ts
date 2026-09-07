/**
 * REAL pi integration demo — no fabricated hook contexts.
 *
 * Unlike `src/demo.ts` (which calls the guard's hooks directly with hand-built
 * contexts), this constructs an actual `Agent` from `@earendil-works/pi-agent-core`,
 * installs TradeGuard as its `beforeToolCall` / `afterToolCall`, and runs the real
 * agent loop. pi itself invokes our hooks — proving the interception path works on
 * the genuine runtime, not a mock of it.
 *
 * It stays offline by swapping only the LLM: a scripted `streamFn` plays back
 * pre-written assistant turns (one with a malicious approval + a normal buy) instead
 * of calling a provider. Everything else — tool validation, hook dispatch, tool
 * execution, transcript building — is real pi.
 *
 * Run:  npm run demo:pi
 */
import { Agent } from "@earendil-works/pi-agent-core";
import type { AgentTool, StreamFn } from "@earendil-works/pi-agent-core";
import { Type, createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { AssistantMessage, Message, Model, ToolCall, Usage } from "@earendil-works/pi-ai";
import { createTradeGuard, MockReputationProvider } from "../index.ts";

const SCAM_SPENDER = "0xbadc0ffee0ddf00ddead1337beef00000000cafe";
const MAX_UINT256 = ((1n << 256n) - 1n).toString();

const ZERO_USAGE: Usage = {
  input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

// ── The trading agent's tools (what Agent OS would expose). Real AgentTools. ──

const walletApprove: AgentTool = {
  name: "wallet_approve",
  label: "Approve token spender",
  description: "Approve a spender to move an ERC-20 token.",
  parameters: Type.Object({
    token: Type.String(),
    spender: Type.String(),
    amount: Type.String(),
  }),
  execute: async (_id, params) => {
    // If this ever runs for the scam spender, the guard failed. It shouldn't.
    console.log(`      ⚠️  wallet_approve ACTUALLY EXECUTED for ${(params as any).spender}`);
    return { content: [{ type: "text", text: "approval submitted" }], details: null };
  },
};

const spotPlaceOrder: AgentTool = {
  name: "spot_place_order",
  label: "Place spot order",
  description: "Place a spot order on the exchange.",
  parameters: Type.Object({
    symbol: Type.String(),
    side: Type.String(),
    qty: Type.Number(),
  }),
  execute: async (_id, params) => {
    const p = params as { symbol: string; side: string; qty: number };
    return {
      content: [{ type: "text", text: `order FILLED: ${p.side} ${p.qty} ${p.symbol}` }],
      details: { status: "FILLED", ...p },
    };
  },
};

// ── Scripted LLM: replays fixed assistant turns instead of calling a provider. ──

function assistantTurn(
  text: string,
  toolCalls: ToolCall[],
  stopReason: "toolUse" | "stop",
): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }, ...toolCalls],
    api: "anthropic-messages",
    provider: "anthropic",
    model: "scripted",
    usage: ZERO_USAGE,
    stopReason,
    timestamp: Date.now(),
  } as AssistantMessage;
}

/** A streamFn that emits each scripted turn in order (last one repeats). */
function scriptedStream(turns: AssistantMessage[]): StreamFn {
  let i = 0;
  return () => {
    const msg = turns[Math.min(i, turns.length - 1)];
    i += 1;
    const stream = createAssistantMessageEventStream();
    stream.push({ type: "start", partial: msg });
    if (msg.stopReason === "toolUse") {
      stream.push({ type: "done", reason: "toolUse", message: msg });
    } else {
      stream.push({ type: "done", reason: "stop", message: msg });
    }
    return stream;
  };
}

function toolCall(id: string, name: string, args: Record<string, any>): ToolCall {
  return { type: "toolCall", id, name, arguments: args };
}

async function run() {
  console.log("=== TradeGuard × real pi Agent loop ===\n");

  const reputation = new MockReputationProvider(
    { [SCAM_SPENDER]: { verified: false, ageDays: 1, flags: ["known-drainer"] } },
  );

  const verdicts: string[] = [];
  const guard = createTradeGuard({
    reputation,
    onVerdict: (v) => verdicts.push(`${v.verdict.toUpperCase()} ${v.toolCall} (${v.reasons.join(",")})`),
  });

  // The agent "decides" to do two things at once: a malicious unlimited approval
  // (must be blocked BEFORE wallet_approve runs) and a normal buy (must go through).
  const turns = [
    assistantTurn(
      "Approving USDT so the strategy can trade, and buying a small BTC clip.",
      [
        toolCall("call-approve", "wallet_approve", { token: "USDT", spender: SCAM_SPENDER, amount: MAX_UINT256 }),
        toolCall("call-buy", "spot_place_order", { symbol: "BTCUSDT", side: "buy", qty: 0.01 }),
      ],
      "toolUse",
    ),
    assistantTurn("Done for now.", [], "stop"),
  ];

  const agent = new Agent({
    streamFn: scriptedStream(turns),
    convertToLlm: (messages) => messages as Message[],
    beforeToolCall: guard.beforeToolCall,
    afterToolCall: guard.afterToolCall,
    initialState: {
      systemPrompt: "You are a trading agent.",
      model: { id: "scripted", api: "anthropic-messages", provider: "anthropic" } as unknown as Model<any>,
      thinkingLevel: "off",
      tools: [walletApprove, spotPlaceOrder],
    },
  });

  await agent.prompt("Set up the strategy.");
  await agent.waitForIdle();

  // Inspect the REAL transcript pi built to see what each tool call resolved to.
  const results = agent.state.messages.filter((m: any) => m.role === "toolResult") as any[];
  console.log("tool results in the real transcript:");
  for (const r of results) {
    const text = (r.content ?? []).map((c: any) => c.text).filter(Boolean).join(" ");
    const blocked = /TradeGuard blocked/.test(text);
    console.log(`  - ${r.toolName}: ${blocked ? "🛑 BLOCKED by TradeGuard" : "ran"} — ${text.replace(/\n/g, " ")}`);
  }

  console.log("\nverdict log (emitted by the guard as pi called it):");
  verdicts.forEach((v) => console.log("   ", v));

  console.log("\ntamper-evident trace:");
  const entries = guard.trace.all();
  console.log(`    entries recorded: ${entries.length}, chain valid: ${guard.trace.verify(entries).ok ? "✅" : "❌"}`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
