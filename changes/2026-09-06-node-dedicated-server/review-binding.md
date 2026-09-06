# Node 方案审核绑定

状态：Node 设计待用户精确版本审核；工作区估算规则由用户本轮明确要求，已作为独立 Agile 文档治理变更落地。2026-09-07 增加计算上移不退化门禁与双口径估算；旧联合 hash 失效。本轮没有生产代码、可执行测试、依赖、workflow、服务器或付费配置变更，没有创建 goal。

## 精确审核对象

下表同时绑定 Node 合同/附件与本轮使用的估算规则版本。绑定规则文件为保持可复核，不表示已授权的文档规则必须等待 Node 实施审核。

| 文件                                                                                         | SHA-256                                                            |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| [spec.md](spec.md)                                                                           | `0181d7a49487a9a88de98e572e0ea2ec82b8f2cc6b43921f97dc32c214475274` |
| [overview.md](overview.md)                                                                   | `92a48e22797eec2830f7d2ec165f992f3882825d4279a35f5b18b11e0035ea8d` |
| [experiments.md](experiments.md)                                                             | `156a46bddb0ee7099298c79282509b9c1314156b4eabe7c8dbbca7c126d53235` |
| [remote-environment.md](remote-environment.md)                                               | `f537aafeff989e44366c4aaab9594c60712c2fa236c3ab32f92f945d842bf1e8` |
| [network-selection.md](network-selection.md)                                                 | `a08e5d9f34bd558c382f116800cc45eb1e084b8457abb2c66ec9b071b3c2c42e` |
| [performance-guardrails.md](performance-guardrails.md)                                       | `44983b12c3f96d8b2d0082c1d4de1f0803571903a9e6adee1e6747d1a1808c8a` |
| [estimates.md](estimates.md)                                                                 | `a19ad600b793ccda5690a237f8105e0a9b4c310182d82d85903687486b780176` |
| [../../AGENTS.md](../../AGENTS.md)                                                           | `d0520dab9342027caa0a86e5eecba8ee24c50d987fa3b79a29043b3eb3f8f84d` |
| [../../docs/development-governance.md](../../docs/development-governance.md)                 | `dc14605beff9497af15e2b6159653f31500fd59401998737b238ae8bfe6ae46a` |
| [../../docs/collaboration-routing.md](../../docs/collaboration-routing.md)                   | `ad545fad7023575a0eb47a28014da4c9d9e7edaef34108d56dcc20c99c23f361` |
| [../../docs/change-estimation.md](../../docs/change-estimation.md)                           | `43ffcfca1977cf9b97f5648ce7296d1c50426bbc0f295034d69cbceed22f51ce` |
| [../2026-09-07-change-cost-estimation/spec.md](../2026-09-07-change-cost-estimation/spec.md) | `32047aa6d4572394190c8f3619414269b896d13eb3ca31b2c831984fbff3f248` |

联合审核 SHA-256：

`da9a569e0b5fafba2cd0ab3c0e705cf5ef044c8faceb644b4454dd0d5690aa34`

联合值按上表顺序，把每行 `文件SHA-256 + 两个ASCII空格 + 链接中的相对文件路径 + LF` 拼成 UTF-8 文本后取 SHA-256。本文本身不参与自身 hash。spec 的范围、决策、行为、测试或验收以及绑定附件实质改变后，需要生成新的绑定版本。外部网页为带日期的来源，hash 绑定的是本地记录，不声称冻结网页内容。

## 基线与检查记录

- 分支：`codex/node-dedicated-server`；基点仍为上轮同步的 main `c777ba811cf4a77500f43e3e1af8c814b725443c`，本轮没有重新 fetch 或合入 Wasm。
- 文档检查：共 13 份 Markdown，Prettier、相对链接、12 份文件 SHA-256 与联合 hash 校验；实际链接数 `72`。本轮新增估算按阶段总和、模型费用和保守值 ×120% 独立验算。提交前执行 `git diff --cached --check`。
- 内容范围：Node change 的八份文档；AGENTS、开发治理、协作路由、统一估算规则，以及该规则的独立治理 spec。无生产、测试、依赖和执行配置差异，产品测试/构建本轮 N/A；未声称独立模型审查。
- A1–A13 未实施/未准出，N0–N4 未运行；A14 初版估算完成，实际消费/工时回填待实施。普通/保守费用均为规划，非账单；剩余 78% 是账户快照，本 change 占比缺分母为 unknown。
- 不退化门禁优先于旧候选的 5% 容差；公网物理 RTT 与额外计算退化分别验收。修复纳入估算，不能为预算放宽核心门槛。
- 规则和设计分别创建语义化本地 commit，SHA 由 Git 记录；未 push、未合入 main。没有修改 MC/MCSManager/ddns-go、网络、服务状态，也未兑换 reset 或购买 credits。
