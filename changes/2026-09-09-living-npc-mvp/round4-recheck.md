# A2 Round 4 分页历史独立复核

冻结范围：`22f27f8984f890b011ff8e0903300a576e26baae..7ff63253322c0b4168e8445e1b53efde2b63d6b7`。合同 `round4-recheck.json` SHA-256 `1fbd42935df0305740ac8ba67561acb476e4ae01a65c55641e8948937deb886d` 已核对。只读审阅，未运行测试、Browser 或 provider。

## 结论

review5153227643 的历史分页 P1 已解决；本次九个变更文件均已覆盖，未发现新的可证实 P0/P1/P2。

Authority 的 `eventPage()` 将 `observation.cursor` 定义为本页末条事件 cursor（无事件时为请求 cursor），而 `character.eventCursor` 是记录的完整 head。运行时现在在首个有效 observation 分别使用二者，符合该协议语义。

## P1 复核：已解决

`apps/agent-server/src/runtime.ts:150-167` 在首帧把 `character.eventCursor` 固化到 `initialHistoryThroughCursor`，用它初始化 `lastDecisionCursor`；同时以当前页 `observation.cursor` 初始化 `latestEventCursor`。因此 80 条保留历史首帧 1–32 时，60 秒 fallback 仍看到 `lastDecisionCursor=80`，不会把第 32 页尾当作未处理事件。

后续页只以大于 `latestEventCursor` 的事件去重并追加到 context；只有 `cursor > initialHistoryThroughCursor` 的 significant event 才 `notifyEvent`。故 33–64、65–80 都保留为模型上下文但不能通知或触发 fallback。若第二页到达时 Authority head 已从 80 增至 81，冻结边界仍为 80；混合末页的 65–80 被抑制、81 正常通知。边界不会跟随分页页面的最新 head 移动。

`packages/game-core/src/server/simulation/character-runtime.ts:487-497` 支持上述判断：每页最多返回保留队列中大于 since cursor 的前 32 条，响应 cursor 为该页最后一条。这也保证有事件的页 `latestEventCursor` 逐页前进、不重放前页。

## 覆盖与验证审查

- 生产：`apps/agent-server/src/runtime.ts`。
- focused 回归：`tests/agent-server/round4-history.test.ts` 覆盖 1–32 / 33–64 历史页、pause/resume、完整 fallback 无调用、65–81 混合页的一次 intent、80 条历史进入请求上下文、ACK 后无额外 fallback 调用。
- Browser E2E：`changes/2026-09-09-living-npc-mvp/e2e/controller-connection.spec.ts` 预置 70 条历史，连接期间要求零模型调用，之后验证新对话和断连重连各只触发一次。
- 合同、RED 日志、实现报告、spec、delivery 和长期 cognition 文档均准确记录“完整首帧 head 冻结、页尾 cursor 推进”的边界；没有超出本修复的生产改动。

实现报告声称 focused 44 tests GREEN，Root 声称修复后 Browser 1/1 GREEN；本复核未执行它们，静态/构建仍由 Root 的进行中门禁覆盖。

## 风险

没有可定位的残余正确性问题。未执行真实 provider、Browser、完整静态或构建门禁，故这些属于未独立复验的证据缺口，不改变本次代码逻辑结论。

## 实际成本

约 0.18 agent 小时；未派发、未写仓库、未调用外部服务。
