# TradeGuard — Pitch Kit

> The security layer for AI that trades your money. It sits between the trading
> agent and Binance Agent OS and screens every action **before** it executes —
> stopping wallet drains and catching AI hallucinations in real time.

---

## The one-liner

**"Everyone's building AI agents that trade. We built the one that guards them."**

## The problem (say this first)

In Aug 2026 Binance shipped **Agent OS** — AI agents can now place trades and move
funds for you. Binance itself admits it **can't see the reasoning** behind an
agent's decisions. Two holes open at once:

1. **The agent can be tricked** into signing an *unlimited token approval* to a
   scam contract, or sending funds to a *sanctioned / drainer* address — the two
   biggest ways crypto gets stolen on-chain.
2. **The agent hallucinates** — claims it filled an order that actually errored,
   cites prices that don't exist — and nobody checks.

## The solution

TradeGuard hooks pi's tool-call pipeline (zero code change to the agent). Every
call passes through it **before** reaching Agent OS:

- **Chain-safety engine** — hard-blocks unlimited approvals to unverified/flagged
  contracts and transfers to sanctioned/scam addresses (real OFAC + GoPlus data).
- **Decision-integrity engine** — reconciles what the agent *claims* against the
  tool's *actual* result; flags execution hallucinations and injects the warning
  back so the agent self-corrects.
- **Hash-chained trace** — every verdict is tamper-evident; the agent can't forge
  a clean history.

Zero-trust: TradeGuard never holds trade or withdrawal permissions. It's a gate.

## Why it wins

- Fills the exact gap Binance publicly admitted (they can't see agent reasoning).
- Hard signals decide — OFAC lists, on-chain verification, hash chains — not an
  LLM guessing. LLM judgment is only ever an advisory down-weight.
- It's real: real pi Agent loop, real Agent OS MCP connection, real LLM (via DMX),
  real OFAC/GoPlus. Judges can reproduce every beat.

---

## The 30–60s video

**Screen:** a terminal. **Command to record:**

```bash
npm run demo:pitch
```

(Paced, colorized, offline, deterministic — runs in ~15–20s. Narrate over it.)

### Narration — English (≈45s)

> "In 2026 Binance launched Agent OS — AI agents can now trade and move your money.
> But the platform can't see *why* an agent decides anything. That's dangerous.
>
> This is TradeGuard — a safety layer that screens every agent action before it
> executes.
>
> *(beat 1)* Here the agent is tricked into approving an unlimited token allowance
> to a known drainer. TradeGuard blocks it — before it ever reaches Binance.
>
> *(beat 2)* A normal trade? It passes untouched. We're a scalpel, not a wall.
>
> *(beat 3)* Now the agent hallucinates — claims the order filled, but it actually
> errored. TradeGuard catches the lie and warns the agent to self-correct.
>
> *(beat 4)* And every decision is hash-chained — edit one record and the whole
> chain breaks. The scoring can't be gamed.
>
> Everyone's building agents that trade. We built the one that guards them."

### 中文解说（≈45 秒）

> “2026 年 Binance 推出了 Agent OS——AI 可以直接替你下单、动你的钱。但平台自己承认:
> 看不到 agent 为什么这么决策。这很危险。
>
> 这是 TradeGuard,一个在每笔操作真正执行**之前**就把它拦下来审查的安全层。
>
> *(第一幕)* 这里 agent 被诱导,给一个已知的盗币合约授权了无限额度。TradeGuard 直接
> 拦下——根本没到 Binance。
>
> *(第二幕)* 正常交易呢?顺畅放行。我们是手术刀,不是一刀切的墙。
>
> *(第三幕)* 现在 agent 开始幻觉,声称订单成交了,实际却报了错。TradeGuard 当场抓出
> 谎言,并把告警回注给 agent 让它自我纠正。
>
> *(第四幕)* 而且每一个裁决都上了哈希链——改动任何一条历史,整条链立刻断裂。评分无法
> 被钻空子。
>
> 满赛道都在造会交易的 agent,我们造的是那个管住它们的。”

---

## If you have a live terminal (backup / deeper demos)

| Command | Shows |
|---|---|
| `npm run demo:pitch` | the 4-beat story (use this for the video) |
| `npm run demo:real` | a **real LLM** (DMX) gets socially engineered; guard blocks it live |
| `npm run demo:agentos` | guard blocks a tool served over the **real MCP protocol** (Agent OS shape) |
| `npm run demo:live` | **real OFAC + GoPlus** flag a sanctioned address on the network |

## Likely questions

- **"Is the AI just judging the AI?"** No — blocks come from hard signals (OFAC,
  on-chain verification, hash chains). LLM judgment is only an advisory down-weight.
- **"Does it really run on Binance?"** Agent OS is a real MCP server; we connect via
  OAuth (CIMD). The interception path is proven end-to-end over the real MCP protocol.
- **"Does it hold my funds?"** Never. It requests no trade/withdraw permission — it's
  a gate that can only *block*, not act.
- **"What's not done?"** A pre-trade confidence score and a dashboard are the next
  iterations; the hard-signal core is working today.
