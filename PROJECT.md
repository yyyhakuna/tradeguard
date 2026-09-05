# TradeGuard — AI 交易的安全层

> 一个坐在交易 agent 和 Binance Agent OS 之间的安全层:在每一笔交易真正发生**之前**,
> 拦下危险的链上操作,并识别 AI 决策中的幻觉与低置信度。

---

## 1. 我们要解决什么问题

2026 年 8 月,Binance 推出 **Agent OS**——让 Claude、ChatGPT、Codex 这类 AI agent
可以直接分析行情并**代替用户下单交易**。能力打开了,但两个风险敞口也一起打开了:

1. **AI 决策不可见、不可信。** Binance 产品负责人公开承认:平台**看不到 agent 做决策的理由**。
   agent 可能"幻觉"——以为自己成交了其实没有、引用了不存在的行情、算错了数字就下单。
   没有人在中间核对。

2. **链上交易随时可能被盗。** agent 一旦被诱导签下一笔**无限额授权**,或把资产**转给一个诈骗/
   被制裁地址**,资金就没了。这是链上最主要的两条盗币路径,而 agent 不具备安全判断力。

**一句话:我们给"拿到交易许可证的 AI"配一个随身安检员。**

---

## 2. 项目目标

| 目标 | 说明 |
|------|------|
| **交易前拦截** | 危险操作在到达 Agent OS **之前**被挡下,而不是事后报告 |
| **决策可信度评分** | 从 agent 的推理链(trace)判断:这次决策有没有幻觉、置信度高不高 |
| **链上安全审核** | 交易前核对合约地址、收款地址、授权额度的安全性 |
| **不可篡改的留痕** | 每一次决策与裁决都上哈希链,agent 无法事后伪造干净记录 |
| **零信任、不碰钱** | 安全层自身不申请交易/提币权限,只做"闸门" |

**参赛定位:Track A — Agent Creation。** 我们交付的是一个**自带安全层的交易 agent**:
它的每一步动作都要过 TradeGuard。在一个人人都在造交易 agent 的赛道里,我们造的是那个**盯着它们的 agent**。

---

## 3. 最重要的呈现效果(Demo)

评委在 90 秒内应该看到四幕。每一幕都是**真实拦截 / 真实识别**,不是解说:

### 第 1 幕 —— 一次盗币被挡在链下 🛑
交易 agent 试图执行 `approve(spender=诈骗合约, amount=无限额)`。
TradeGuard 在 `beforeToolCall` 拦下,调用**根本没到 Agent OS**。

```
[1] unlimited approval to known-drainer
    -> BLOCKED ✅
    TradeGuard blocked this action:
      - [unlimited-approval-to-unverified-contract] ...
```

### 第 2 幕 —— 正常交易顺畅放行 ✅
一次正常的现货买入,安全层不打扰,直接通过。证明我们**不是一刀切**。

### 第 3 幕 —— AI 幻觉被当场抓出 🔎
agent 在推理里写"已成交,买入 0.01 BTC",但工具实际返回**报错**。
TradeGuard 在 `afterToolCall` 对账后标记为**执行幻觉**,并把告警注入回 agent 让它自纠。

```
[3] agent claims 'filled' but the call errored
    -> HALLUCINATION FLAGGED ✅
```

### 第 4 幕 —— 记录改不动 🔗
现场篡改一条历史 trace,哈希链立即断裂、定位到被改的那一条。
这证明我们的评分**无法被 agent 反向钻空子**。

```
after editing entry[0].args: ❌ broken@seq0 (tamper detected)
```

> 当前 `npm run demo` 已经能完整跑出以上四幕(离线、无需真实资金)。

---

## 4. 系统怎么工作

TradeGuard 挂在 pi(agent 运行时)的工具调用管线上,**零侵入**:

```
交易 agent 推理
      │  MCP 调用:下单 / 转账 / 授权
      ▼
 beforeToolCall ── TradeGuard ─┐  L1 采集意图+推理
                               │  L2 链上安全引擎(合约/地址/授权)
                               │  L3 Policy Gate → 命中风险则 block
                               │  L5 哈希链留痕(pre)
   (放行才继续) ───────────────┘
      │
      ▼  转发给 Binance Agent OS 执行
      │
 afterToolCall ── TradeGuard ──   L2 决策完整性引擎(声称 vs 实际 = 幻觉)
                                  L5 哈希链留痕(post)+ 告警回注 agent
```

**两个引擎:**
- **链上安全引擎** —— 无限授权给未验证合约、转账给制裁/诈骗地址 → 硬阻断;地址投毒 → 告警。
- **决策完整性引擎** —— 幻觉分(硬,拿账户事实对账)+ 置信度分(过程,不看盈亏)。

**一条底线原则:** 能拿事实钉死的当硬证据扣分;钉不死的只当降权参考,且所有留痕用哈希链兜底,谁都改不了。

---

## 5. 为什么这个能赢

- **踩在官方亲口承认的空白上** —— 平台自己说看不到 agent 的决策依据,我们补的正是这一层。
- **Demo 一眼看懂、可复现** —— 拦下盗币 + 抓出幻觉,评委跑一遍就出同样结果,不靠运气。
- **不靠 AI 拍脑袋打分** —— 硬信号(账户对账、哈希链、地址核验)说了算,LLM 判断只做降权参考。
- **叙事独特** —— 满赛道的交易 agent 里,唯一一个专门管住它们的。

---

## 6. 当前进度

- ✅ 架构确定,pi 钩子契约已核实(`beforeToolCall`/`afterToolCall` 可拦截、可拿推理链)
- ✅ 骨架可运行:链上安全硬阻断 + 执行幻觉识别 + 哈希链留痕 + 四幕 demo
- ⏳ 置信度引擎(逻辑自洽 / replay 翻转率 / 长期校准)
- ⏳ 真实数据源接入(BscScan / GoPlus / OFAC)
- ⏳ 接真 pi + Agent OS 跑一次端到端真实 run
- ⏳ Dashboard

## 7. 仍需确认(依赖外部)

1. pi 的钩子对 **Agent OS 的 MCP 工具**是否同样触发(架构上是,需实测一次)。
2. Agent OS 中 `approve`/`transfer` 等链上操作的**真实工具名与参数字段**。
3. MCP 代理 / 拦截模式是否符合比赛与 Agent OS 条款。

---

*运行:`npm install && npm run demo`。技术细节见 [README.md](./README.md)。*
