# Round 7 Wire / Core 独立复核

冻结范围：9803ce91a802103e99669ffbab4d3b84860b296c..06b4ced522ac09cb75d38ddceb9c3be0dde36fc8。合同 round7-recheck.json SHA-256 6d9fffae66c89053b171489a1a5af057632b7d544d58bf4368c55833da69bf56 已核对。只读审阅，未运行测试、Browser、provider 或门禁。

## 结论

Core target headroom 和空 event tail 的恢复拒绝正确，Host 也正确接受真实的 32 条分页/128 条保留语义并在认证后对已知坏帧返回 BAD_FRAME。不过 event page validator 仍接受一类 Authority 不可能产生的缺口页，见 P1。

### P1：Host 接受事件 cursor 有缺口的认证首帧

**位置：** apps/agent-server/src/wire-validation.ts:22-50

**触发：** validEventPage() 只要求 cursor 严格递增，未要求连续。实际 Authority 的 record() 每次加一，eventPage() 只对连续保留数组 filter/slice，所以真实页面的 event cursor 必定连续。认证浏览器可发送 head=104、page cursor=104、32 条事件 [73..103,104]（缺 1 条）；该页满足当前 safe/bounds/retention/last-cursor/full-page 检查并被接受为首观察。

**影响：** Runtime 在首帧建立 baseline 并把缺失历史写入 context，Host 不会发 BAD_FRAME/关闭连接。该关系在实际 Authority 下不可能出现，因此不需要、也没有声称能判定“所有 cursor 自洽的伪造世界状态”。

**最小修复：** 在 validEventPage() 要求每个 cursor 等于前一个 + 1；补一个 32 条、在 retained window 内但中间缺 cursor 的 BAD_FRAME/parser reject 回归。

## 已确认路径

- page cursor 与 head 都为非负 safe integer，page 不得超过 head；短尾页与空页必须正好落在 head，32 条满页可继续分页。该规则接受真实 1–32/33–64/65–81 和 head=200 的保留窗口页。
- 超出 128 条保留窗、重复 cursor、页尾不匹配、短页未到 head 和空页不在 head 都被拒绝。WebSocket 在认证后以同一 parser 拒绝 BAD_FRAME，尚未转交 Runtime.receive，因此不会建立 baseline。
- Character checkpoint targetSequence 额外要求下一次递增仍为 safe integer；record.events 为空但 eventCursor 正数被拒绝。新增 server 回归通过持久化 restore 验证原 world snapshot 未改变，之后真实 attackEntity 仍正常进入 suspended。
- Authority eventPage() 的 cursor 是本页末条事件（无事件为 since cursor），character.eventCursor 是全量 head，最多 32 条；retained tail 最大 128 条。该语义与 Host 的允许集一致。

## 覆盖与验证

14 个冻结变更文件均已覆盖：Host wire source、Core snapshot validation、三项 focused tests、两份合同、证据/实施报告、spec/delivery/estimates。Root 报告 60 个集成 focused tests GREEN，static/build/Browser 仍在执行；本复核未运行。未发现 P0 或其他 P2。

## 风险

P1 修复与窄复核前，不能声称认证后首观察全部满足实际 Authority event page 连续性。静态、构建和 Browser 未独立执行也是证据缺口。

## 实际成本

约 0.22 agent 小时；未派发、未写仓库、未调用外部服务。

Root复现勘误：报告示例 `[73..103,104]` 实际连续；已用 `[1..31,104]`（32条、head/page=104，均在128条保留窗）取得RED，同时补零号事件拒绝。修复按页尾和长度推导起点，每条严格加1。
