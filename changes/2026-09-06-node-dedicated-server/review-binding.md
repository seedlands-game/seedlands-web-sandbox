# Node 方案审核绑定

状态：设计已交付，实施待用户审核。2026-09-07 按用户反馈将 WS/JSON 降为参考，增加消息、编解码与传输的前置选型；CT105 事实沿用上一轮只读核验。本轮没有现场操作，也没有生产代码、可执行测试、依赖、workflow、secrets 或服务器配置变更。旧联合 hash 已失效，以此版本为准。

## 精确审核对象

| 文件                                           | SHA-256                                                            |
| ---------------------------------------------- | ------------------------------------------------------------------ |
| [spec.md](spec.md)                             | `ada7185381da642560e7b788612e32096feac3f2f84adb25f9b62ed2393df3ef` |
| [overview.md](overview.md)                     | `a4ea3e275e19edab1b135bac7fe294f66a7a2a146a847c343623a9f4c8926792` |
| [experiments.md](experiments.md)               | `db14c0bf23f04587832f48d6d3c75024dce4f5b3afd72fcffa4efd151414ad58` |
| [remote-environment.md](remote-environment.md) | `726c202e12e4f9c400759c3952a964abfedd68331b9c2097906566a412190a8b` |
| [network-selection.md](network-selection.md)   | `a27a8029d0aa7c43d777ee6edde3231ad066a9939ac06bac0c2b30c9ac0cfacd` |

联合审核 SHA-256：

`3385299f04c59d1a83bb81612908a513fcc69ece0d16eaec6e63471656841c67`

联合值按上表顺序，把每行 `文件SHA-256 + 两个ASCII空格 + 文件名 + LF` 拼成 UTF-8 文本后取 SHA-256。本文本身不参与自身 hash。spec 的范围、决策、行为、测试或验收以及任何绑定附件实质改变后，都需要生成新的绑定版本。

## 基线与检查记录

- 分支：`codex/node-dedicated-server`；最终基点为最新远端 main `c777ba811cf4a77500f43e3e1af8c814b725443c`，已按用户要求合入；PR #8 已合并，文件树与原 `1e3619d` 一致。本次同步无产品差异，这不是本 change 的产品验收。
- 文档检查：六份 Markdown 的 Prettier、相对文件链接、五份文件 SHA-256 与联合 hash，提交前逐项核验；链接计数为 `28`。暂存差异限本 change 的六份文档，另执行 `git diff --cached --check`。
- 当前只交付设计，未运行产品测试、构建、性能采样或 LAN/WAN 业务验证；不存在实际 RED/GREEN 或 Node 性能提升结论。A1–A12 保持未实施，N0–N4 未运行。R01 仅在上轮完成目标、AAAA/端口和本机 SSH TCP 核验，CI 入口/TLS/部署身份仍未验。
- 自查重点：可靠动作与可丢位姿分离、跨流因果、一次性输入、完整编解码成本、网络归因、平台/UDP 能力、降级不绕过权限及旧连接门禁；保留此前权威/存储/Wasm 边界。未声称独立模型审查。
- 设计提交仅含本 change 的六份 Markdown。提交 SHA 由 Git 记录，避免将提交自身 hash 写入自身内容；未 push；基点仍为上轮同步的 main，未合入 Wasm 实验。没有修改 MC/MCSManager/ddns-go、网络或服务状态。
