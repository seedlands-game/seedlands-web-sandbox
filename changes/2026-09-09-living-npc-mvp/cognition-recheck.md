# A2 cognition 增量复审报告

## Review identity 与范围

- 冻结对象：`58ef3f4cb74f8bad8c6fe496e3e9fe93f699d9c9 → b69c42d5d07165f4a37193e6dc5e8313733ed4ff`（first parent → head）。
- 合同：`living-npc-cognition-recheck`，SHA-256 `783787dd51265f4a43d7a7e004170ca8c2526270fdfcc4d7699ab60b2c9aa74c`。
- 已从 frozen base/head tree 读取 9/9 changed paths、base 审阅规则、上轮报告及所需邻接 A2 源码；未读取 WIP 源码。`/tmp/seedlands-living-npc/live-full-history-smoke.json` 是本轮授权引用的真实 RED 证据：Flash 合法返回 `available_actions` + `inspect_visible`，旧 host 将其判为 `invalid-tool`。

## 结论

上一轮 P1 已解决：在 Flash 在途期间到达、但角色 revision 不变的新增 event 现在作为并发尾部保存，且先补齐 intent 的 Authority tool receipt 再恢复 event，既不丢事实也不破坏 provider tool-pair 顺序。没有发现新的 P0/P1；有一个暂停状态反馈的 P2。

## 增量 codemap 与 coverage

| 已读路径（9/9）                                                                            | 角色和复核结果                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.prettierignore`                                                                          | 忽略此 change 的冻结 contracts；无运行时逻辑。                                                                                                                                                      |
| `apps/agent-server/src/context-session.ts`                                                 | 增加 snapshot 长度与 `extractTail()`，边界非法 fail closed。rotation 的 frozen prefix/ACK commit 原子性未改变。                                                                                     |
| `apps/agent-server/src/runtime.ts`                                                         | 决定前 snapshot context；在途 event 保存为 tail；intent pending 时持续暂存，receipt 先关闭 tool call 再接回 tail；memory candidate 发出后立即返回，并以 `pendingMemoryRequestId` 阻止下一次 Flash。 |
| `apps/agent-server/src/cognition-graph.ts`                                                 | 同轮允许多个只读 calls；唯一 intent 仍须单独出现；重复 ID、mixed intent、无效或过量 read 均产生每个 call 的拒绝 tool reply 并停止，不产生世界写入。                                                 |
| `tests/agent-server/cognition-graph.test.ts`                                               | 覆盖真实 RED 形态的两项只读批次、mixed/multi intent、不可见引用、5-read budget 与 tool reply 覆盖。                                                                                                 |
| `tests/agent-server/runtime.test.ts`                                                       | 覆盖同 revision event 的 Flash-in-flight tail、receipt 后下一轮可见、memory ACK 前无 Flash；既有 dispose/death/missing-key 测试仍在文件内。                                                         |
| `changes/2026-09-09-living-npc-mvp/cognition-delivery.md`                                  | 将 focused suite 更新为 28 tests，并明确新的覆盖边界。                                                                                                                                              |
| `changes/2026-09-09-living-npc-mvp/cognition-review.md`; `contracts/cognition-review.json` | 归档上一轮独立 review 与授权合同；不改变生产行为。                                                                                                                                                  |

## 上轮 P1 复核

**已解决（高置信）。** `runDecision()` 在调用 graph 前冻结 `graphSnapshotLength` 和 messages（`runtime.ts:303-306`）。在模型 await 期间到达的 event 会先写 context；结果返回后 `extractTail(graphSnapshotLength)` 将它从旧快照末尾取出，替换 graph 的结果后：

- no-intent/over-budget 分支立即 append tail（`317-328`）；
- intent 分支把 tail 暂存，等匹配 Authority receipt 的 `tool` 消息先写入，再 append tail（`330-341`、`233-249`）；
- intent pending 期间继续到达的 events 同样移入该 tail（`139-146`）。

所以 intent assistant call 与 matching tool receipt 连续，新增 event 仍进入后续 Flash history。`runtime.test.ts:129-200` 以延迟的 mock Flash、cursor 2、相同 revision 复现旧失败路径，并断言 receipt 之后的下一请求同时含 tool receipt 和 cursor 2 event。

rotation 也已闭合：Pro 返回 memory candidate 后 runtime 发 memory 并 return（`285-300`）；`beginDispatch()` 在 `pendingMemoryRequestId` 存在时拒绝新的 Flash（`257-275`）。Pro/ACK 之间的 events 留在 context 的 frozen tail，accepted 由 `commitPreparedRotation()` 保留，rejected 仅清 prepared、保留全部旧 history。pause/death/dispose 分别 abort、terminal/dispose 并清 pending references；没有发现由这些分支重启 Flash 或提交旧 result 的路径。

## 证据与未验证项

任务提供的 SHA 绑定结果为 `@seedlands/agent-server` 8 files/28 focused tests、typecheck、build、Prettier/ESLint 均通过；本轮未重复执行（合同禁止 full suite，且 review 不以当前 WIP 代替 frozen source）。这些 mocks 证明本地时序和 schema 路径，不替代真实 provider 或 Browser 验收。

Pro full-history 问题保持开放：`context-session.ts` 仍在 Pro 压缩时删除 `reasoning_content`、保留 native assistant tool calls/tool roles，transport 又开启 thinking。旧 DeepSeek tools 续写规则不能直接证明无 tools 的 Pro 请求必失败；Root 应按既定计划在真实 Pro 上验证完整 Flash tool-pair history，必要时改为带 cursor/来源的公开事实 transcript，绝不写入 private reasoning。

## 人类复核建议

1. `runtime.ts:317-341`：确认 event 在世界时间上可能早于 intent receipt 时，优先维持 provider 工具协议的记录顺序符合产品语义。
2. `cognition-graph.ts:92-139`：真实 Flash 继续采样多只读 batch、mixed intent 与 duplicate tool IDs，确认 provider 的 role/tool-history 接受性。
3. Root 的真实 Pro full-history run：这是当前唯一未闭合的 provider 行为证据。

## 独立审阅 Findings

### [P2] 暂停后接收回执会把可见状态改回 ready/awaiting-receipt

- 位置：`apps/agent-server/src/runtime.ts:187-192,223-254`。
- 触发：用户发送 `pause` 后，在尚未闭合的 intent 或 memory request 的 Authority receipt 到达。
- 影响：scheduler 仍是 paused，且不会启动模型；但 `receiveReceipt()` 无条件发出 `ready` 或 `awaiting-receipt`，覆盖此前的 `paused` status。Browser 若直接渲染状态，会错误显示服务已恢复。
- 证据：`pause()` 发 `status('paused')`；memory 分支在 230 行和 intent 分支在 254 行未检查 `this.paused`。现有 pause/dispose 测试只覆盖 abort，未覆盖 paused pending receipt。
- 建议：receipt 仍可更新内部 context/ACK，但 status 统一选择 `this.paused ? 'paused' : ...`，并补 memory/intention receipt-after-pause 两个断言。
- 置信度：高。

Coverage：完整（9/9 changed files；上轮 P1 已解决；未发现可证实 P0/P1）。
