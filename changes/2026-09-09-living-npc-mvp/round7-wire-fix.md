# A2 Round 7 Wire 校验修复报告

固定合同：`living-npc-round7-wire-fix`，SHA-256 `c1b99649fcb84e76eca9322576b7c2a6a6ece131a28f92e51feb2621917d1842`。冻结基线：`9803ce91a802103e99669ffbab4d3b84860b296c`。

## 变更

- observation parser 现在要求 `character.eventCursor` 与 page cursor 都是安全非负整数，且 page cursor 不超过完整 head。
- 非空事件页必须严格递增，事件不得超过 page/head，也不得早于 Authority 的 128 条保留窗口；本页最后事件必须等于 page cursor。
- 32 条满页可以停在 head 之前继续分页；少于 32 条的尾页必须到达 head。空页必须满足 page cursor 等于 head。
- WebSocket 已认证后的首个 malformed observation 由同一 parser 拒绝，返回不包含原始帧内容的 `BAD_FRAME` 并关闭连接。
- 仅修正最大中文 observation 测试中原本不一致的 fixture：32 条事件对应 `eventCursor=32`。

## 验证

- RED：`wire-validation.test.ts` 与 `websocket-host.test.ts` 在修复前共 10 个预期失败，覆盖缺失/负数/unsafe head、page 超过 head、重复 cursor、last event 与 page cursor 不同、短页未到 head、事件超出 128 保留窗口、空页 cursor 与 head 不同，以及认证后 malformed 首帧未返回 `BAD_FRAME`。
- GREEN：最终受影响命令 `./node_modules/.bin/vitest run tests/agent-server/wire-validation.test.ts tests/agent-server/websocket-host.test.ts`：2 files / 17 tests 全部通过。
- 聚合 focused 回归 `./node_modules/.bin/vitest run tests/agent-server`：12 files / 55 tests 全部通过。
- 正例覆盖 32 条历史满页、分页期间 head 增长、17 条混合历史/新事件尾页、head 空页，以及 head=200 时位于最后 128 条保留窗口内的页面。
- `git diff --check` 通过；只修改合同允许的 `wire-validation.ts` 和 agent-server 测试，三个修改文件合计 447 行，本次净新增 119 行。

## 风险

- Host 能拒绝内部不一致或数值不安全的认证帧，但无法证明一个所有 cursor 都自洽的认证浏览器状态是否由真实 Authority 产生；本修复不作此安全声明。
- core snapshot validator 理论上仍允许 `events=[]` 且 positive event head 的恢复状态；正常 Authority runtime 不会自然生成该组合，而 Host 按本合同会拒绝其 `empty cursor != head` 页面。本次权限不包含 core，因此未扩大修复范围。
- 本实施者未运行 Browser、provider、安装、全局格式化、构建或 Git 写入；Root 负责 target-sequence、真实 Browser 和全局门禁。

## 实际成本

- 本次约 0.28 agent 小时，低于 0.5 小时合同上限；未派发子任务，未做外部写入。
- 真实模型与 Browser 调用 0，API 费用 0。
- token、credits 与平台计费分母不可见，记为 unknown。
