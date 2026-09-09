# Living NPC GitHub 复核报告

冻结范围：`6a24891142dc0abc196a8c07c2488eb308f902fe..38771ccac7864b2744c64f6d78a0c3204efc8221`。已核对 `github-recheck.json` 合同 SHA-256：`d42c13e52676bda10150acb63a968fa667396967c7f0fe5cafb8b1ccdef060e2`。读取既有 triage、world/host 修复报告和全部 28 个差异文件；仅从冻结树静态审阅，未运行测试、Browser、provider、依赖或 Git 写操作。

## 覆盖

- A2 Host：`cognition-tools.ts`、`context-session.ts`、`deepseek-transport.ts`、`runtime.ts` 及 `cognition-graph`、`deepseek-transport`、`github-host-fix`、`runtime` 测试。
- Browser/协议传播：Authority client contract、character control port、controller bridge、worker bound-control，及三组 client/authority 测试。
- Core：Authority worker 协议、character control 协议、character runtime/validation，及 `character-control-correctness.test.ts`。
- 交付材料：三份 GitHub 修复/triage 合同、三份对应报告、`spec.md`、`delivery.md`。

## 六项复核

| GitHub finding                       | 结论          | 冻结证据                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------ | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3966614818 event cursor freshness    | **已解决 P1** | `expectedCursor` 由 controller bridge → bound port → worker → `CharacterRuntime.applyIntent()` 全链携带；worker 在消耗 sequence 前验证 cursor，core 在所有状态 mutation 前比较 cursor。重复 requestId 在 freshness 比较前返回已保存结果，保留幂等重试。Host 在同 revision/cursor 改变时丢弃旧 Flash 提案；Authority 返回 conflict 后只接受 cursor 前进或 revision 变化的新 observation，不能被旧 receipt cursor 诱发重试。对应 host/core/Browser 负向用例覆盖。 |
| 3966614829 pause prepared rotation   | **已解决 P1** | `ContextSession.performRotation()` 在 abort 后返回 none，不产生 deterministic prepared candidate；忽略 abort 的迟到成功候选在 Runtime paused/disposed/deceased 分支被 `rejectPreparedRotation()` 清理。已发出的 memory 请求与已有 ACK 路径未改，测试覆盖 pause 后恢复可重新旋转。                                                                                                                                                                               |
| 3966614840 response stream cap       | **已解决 P1** | 成功 body 改为逐块 reader 累计原始字节，越过上限立即 cancel 并抛错；HTTP、已知超限 Content-Length 也 cancel 未消费 body。测试覆盖分块 overflow、Content-Length quick reject 与 HTTP body 取消。                                                                                                                                                                                                                                                                 |
| 3966614844 restored action ownership | **已解决 P1** | restore map swap 前校验 action 存在、id/actor 属于该 character、类型为 move-to、goal active 且目标与 move/return/forage/follow 的执行关系一致；follow 还校验 ref binding。相同类型和相同目标位置但归属另一 actor 的夹具被拒绝，证明 owner 校验不可被其他字段替代。合法终态 action 仍允许 restore，并由下一 tick 收敛。                                                                                                                                          |
| 3966614855 already-aborted signal    | **已解决 P1** | transport 在 fetch 前检查 signal，注册 listener 后再次检查竞争窗口；预先 abort 时不创建 fetch。回归断言 fetch 零调用。                                                                                                                                                                                                                                                                                                                                          |
| 3966614865 POI follow schema         | **已解决 P2** | follow schema 固定 `target.kind: 'entity'`，本地 `targetRef()` 只接受 visible entity，`available_actions` 对 POI 不再宣称 follow；POI proposal 在 tool 层被拒绝。                                                                                                                                                                                                                                                                                               |

## 新发现

未发现新的 P0/P1/P2。

## 未验证边界

- 本复核没有执行全量 static/build、Browser 或真实 provider；Root 的独立运行证据仍是这些层的准出依据。
- 通用开发 `CharacterControlRequest` 保留不传 `expectedCursor` 的兼容入口；受控 Browser/认知路径强制该字段，因此本次修复的 freshness 安全边界未被该兼容入口绕过。
- Host 的 conflict 重试刻意等候后续 observation；其活性依赖已存在的 Bridge 观察轮询，属于设计中的有界等待，而不是依据 receipt 自旋。

## 实际成本

约 0.35 agent-hour，低于 0.5 小时合同上限。未执行外部调用、测试、浏览器、依赖操作、提交或外部写入；API 费用为 0。
