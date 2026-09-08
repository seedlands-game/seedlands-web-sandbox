# Web↔Node movement-window 诊断记录

状态：Active，仅收集有界故障证据；不是性能采样或产品调参。

## RED 观察

- CI `34222361251` 的显式 SwiftShader 完整旅程通过 initial 9 块和 Pointer Lock，但 W 5 秒权威水平位移仅约 `0.01964`；默认与显式对照均回读 SwiftShader，不能据此固定 renderer。
- 既有失败只保留位移断言与最终 Node 日志，没有 W 前/失败后的完整 snapshot，也没有 Web 发送、匹配 decision 与 Node admission 的逐层对账。
- 可疑的 `snapshot tick + elapsed + 2` 仅是假设；在看到 sent/late/resync/currentTickAtAdmission 之前，禁止修改 lead、lease 或 Node late 规则。

## GREEN 设计

- Web Harness 与 Node E2E 开关外不分配诊断窗口。两端累计值不设逐帧日志；非中性样本最多 16 条，neutral idle 不占窗口。
- Web 样本绑定发送时 snapshot tick/elapsed 和匹配 decision；Node 样本绑定真实 admission current tick 与最终 decision，并只在 session terminal 输出一次汇总。
- 旅程进度与失败 JSON 独立写入 `/tmp`，每次 retry 分开；包含 stage、initial/current、W 前 snapshot、`interactionBlocked`、Pointer Lock/focus/visibility、graphics identity 与脱敏 Node 日志。任何诊断读取失败只作为字段记录，不能遮蔽原失败。

## 本机功能验证

- `pnpm exec vitest run tests/client/remote-authority-client.test.ts tests/node/node-playable-network-session.test.ts --maxWorkers=1`：2 文件 12 用例通过。受控时钟覆盖 accepted/late/resync、未知 decision、发送到匹配 decision 延迟、16 条非中性样本上限，以及 Node terminal 只输出一份汇总。
- 同 base path、独立 Node 数据目录和 `/tmp` 证据目录执行真实 Chromium：错误认证后的 graphics identity 缓存用例通过；完整旅程的 W 阶段从 `[-3.5,18,-3.5]` 移动到 `[-1.52877,18,-2.49377]`，`movement-window-after` 已保存。Web 对账为 sent `70`、matched `70`、accepted `65`、late/resync 各 `5`；会话结束 Node 汇总为 received `164`、accepted `119`、late/resync 各 `45`，非中性样本 `14` 条且含 `inputSequence`。
- 该旅程随后在既有挖放 mesh revision 等待处失败；本轮不据此改变产品规则。失败路径仍保存 live current evidence、Pointer Lock/focus/visibility、graphics identity、原错误与关闭连接后新增的 Node terminal 汇总，证明诊断不会等到完整旅程成功才产出。
- 原始功能诊断位于 `/tmp/seedlands-web-node-playable/movement-diagnostics-local-ffd9-v2/diagnostics/journey-progress-retry-0.json` 与 `journey-failure-retry-0.json`。该运行基于本地未提交诊断源码，只证明字段和生命周期可工作，不作为冻结 source-bound 交付或性能结论。
