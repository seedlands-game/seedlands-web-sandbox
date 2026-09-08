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

## 冻结诊断与完整 Chromium 候选

- 干净 b7e695a 本机执行完整脚本：11文件36项Vitest、2项Chromium全绿。40个sourceInputs逐一匹配，durableStop=1038，放置[1,19,-1] voxel2/revision2；root视检原始placed帧。记录在 `/tmp/seedlands-web-node-playable/local-b7e695a/`。
- CI34226402889 的默认首屏三次超时，forced通过W但转向yaw差0。两端输入累计对账一致：103 received/sent、69 accepted、28 late、33 resync；含4次target-out-of-order、1次too-far-ahead。真实Pointer Lock、focus、visibility有效且interactionBlocked=false。这证明迟到及target回退确实存在，但不证明它们导致鼠标yaw失败。
- CI源码为merge a1f6dd30，parents=637a8d2+b7e695a、tree=af0dfab3。随后本地正常合并origin/main的CI路径选择和review指南，80e781b的tree与该CI完全相同，生产行为没有新增差异。
- 独立审阅允许保持原forced配置，仅新增完整Chromium channel兼容对照；参考对象是前一forced旅程，不是default gate。不能给channel或GL flags单独做根因归因。
- 本机候选语法/ESLint/typecheck通过。实际managed Chromium151/SwiftShader、channel=chromium正确回读；认证失败、首屏、W、转向、跳跃通过，随后挖掘15秒等待失败，完整兼容候选尚未通过。该记录在 `/tmp/seedlands-web-node-playable/full-chromium-local/`，不是交付证据。Linux继续用原完整断言评估，保留default gate，不采用或放宽产品合同。
