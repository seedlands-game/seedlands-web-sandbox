# Node 方案审核绑定

状态：设计已交付，实施待用户审核。本轮按用户补充纳入 CT105 真实远端环境与 CI 推送部署；仅执行只读现场核验，没有生产代码、可执行测试、依赖、workflow、secrets 或服务器配置变更。旧联合 hash 已失效，以此版本为准。

## 精确审核对象

| 文件                                           | SHA-256                                                            |
| ---------------------------------------------- | ------------------------------------------------------------------ |
| [spec.md](spec.md)                             | `e73299d227a7cf81f4c505a7f2917dad083e4a43208df7fb0ffc8e073cfe49f1` |
| [overview.md](overview.md)                     | `4cb15de91ebf4d715ce50b2b5109c232d8d9aefde38e2c55f7d5ef0f99563f1c` |
| [experiments.md](experiments.md)               | `2630545aa392d61a920341edfec6fdc9b83a0b3c3d7c59f77b412e66d6625aa0` |
| [remote-environment.md](remote-environment.md) | `f780f8d3695d2b96abf07335a326ba47141adeccef631c1c7e8898d38770feac` |

联合审核 SHA-256：

`422cb7214f4c96cb8964730c5a44033b5d17c766e74114c2fde696de0bf2ec70`

联合值按上表顺序，把每行 `文件SHA-256 + 两个ASCII空格 + 文件名 + LF` 拼成 UTF-8 文本后取 SHA-256。本文本身不参与自身 hash。spec 的范围、决策、行为、测试或验收以及任何绑定附件实质改变后，都需要生成新的绑定版本。

## 基线与检查记录

- 分支：`codex/node-dedicated-server`；最终基点为最新远端 main `c777ba811cf4a77500f43e3e1af8c814b725443c`，已按用户要求合入；PR #8 已合并，文件树与原 `1e3619d` 一致。本次同步无产品差异，这不是本 change 的产品验收。
- 文档检查：五份 Markdown 的 Prettier、相对文件链接、四份文件 SHA-256 与联合 hash，提交前逐项核验；实际链接数为 18。暂存差异限本 change 的五份文档，另执行 `git diff --cached --check`。
- 当前只交付设计，未运行产品测试、构建、性能采样或 LAN/WAN 业务验证；不存在实际 RED/GREEN 或 Node 性能提升结论。A1–A11 保持未实施。R01 仅完成目标、当前 AAAA/端口和本机 SSH TCP 核验，CI 入口/TLS/部署身份仍未验。
- 自查重点：浏览器协调缺口、远端权限 allowlist、断连输入、旧 epoch/回执、完整 manifest 继承、工作量和资源拓扑归因、Wasm 合并边界。未声称独立模型审查。
- 设计提交仅含本 change 的五份 Markdown。提交 SHA 由 Git 记录，避免将提交自身 hash 写入自身内容；未 push；基点仍为上轮同步的 main，未合入 Wasm 实验。没有修改 MC/MCSManager/ddns-go、网络或服务状态。
