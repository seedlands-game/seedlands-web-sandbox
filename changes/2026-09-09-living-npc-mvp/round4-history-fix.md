# A2 Round 4 分页历史修复报告

固定合同：`living-npc-round4-history-fix`，SHA-256 `7f72e3512015f61320756b52a1ce62b3a64ce3769d78efabee35bccc0ae40237`。冻结基线：`22f27f8984f890b011ff8e0903300a576e26baae`。

## 变更

- `CognitionRuntime` 从首个有效 observation 的 `character.eventCursor` 建立一次性 `initialHistoryThroughCursor`，整个连接生命周期不再追随后续 head 变化。
- 首帧仍把本页事件写入上下文并以 page-end `observation.cursor` 初始化 `latestEventCursor`；`lastDecisionCursor` 则初始化为完整历史 head，阻止 fallback 把尚在分页的历史当作未决定事件。
- 后续分页继续按 page cursor 去重、追加所有历史事件并推进 `latestEventCursor`，但只有 `event.cursor > initialHistoryThroughCursor` 的显著事件才通知 scheduler。
- 最后一页同时包含冻结历史和分页期间新增事件时，历史部分只进入上下文；超过冻结边界的新事件正常触发一次有界 debounce 决定。暂停/恢复不改变该边界。

## 验证

- 本地 RED：首帧 1–32、暂停期间第二页 33–64 后恢复并推进完整 60 秒 fallback，修复前发生 1 次 provider 调用，预期为 0。
- Root 提供的真实 Browser RED：70 条保留历史的后续 `cursor=64` 与 `cursor=70` 页面触发 2 次旧决定；日志为 `/tmp/seedlands-living-npc/round4-browser-red.log`。该 Browser RED 由 Root 运行，本实施者未运行 Browser。
- GREEN：`./node_modules/.bin/vitest run tests/agent-server/round4-history.test.ts`：1 file / 1 test 通过。
- 回归使用 80 条冻结历史，前两页经过 pause/resume 与完整 fallback 保持 0 调用；混合页包含 65–80 历史与新事件 81，只生成 1 个 intent。模型请求逐条包含 `history-1` 至 `history-80`，证明分页历史未被丢弃；Authority ACK 后下一完整 fallback 仍无第二次调用。
- 聚合 focused GREEN：`./node_modules/.bin/vitest run tests/agent-server`：12 files / 44 tests 全部通过。
- `git diff --check` 通过；仅修改合同允许的 `runtime.ts` 并新增 `round4-history.test.ts`，约新增 99 行。

## 风险

- 本实施者未运行 provider、Browser、安装、全量仓库测试、全局格式化、构建或 Git 写入。Root 仍需在修复后复跑真实 Browser >32 历史 fixture 和全局门禁。
- 恢复语义继续明确为：连接前已存在且位于冻结 head 内的事件只重建上下文，不自动重放离线期间未确认命令；连接后超过冻结边界的新事件才可唤醒认知。
- 首个 observation 的 `character.eventCursor` 由 Authority 提供并作为可信历史 head；本修复不扩展协议或建立额外 watermark。

## 实际成本

- 本次约 0.18 agent 小时，低于 0.4 小时合同上限；未派发子任务，未做外部写入。
- 真实模型与 Browser 调用 0，API 费用 0。
- token、credits 与平台计费分母不可见，记为 unknown。
