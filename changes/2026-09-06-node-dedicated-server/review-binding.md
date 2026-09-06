# Node 方案审核绑定

状态：设计已交付，实施待用户审核。用户本轮要求先完成方案；无生产代码、可执行测试、依赖或产品配置变更。

## 精确审核对象

| 文件                             | SHA-256                                                            |
| -------------------------------- | ------------------------------------------------------------------ |
| [spec.md](spec.md)               | `dc29b22c6e459486dd542862926676dce9c3b01404d2c4ca809e86b3b1e843f0` |
| [overview.md](overview.md)       | `4bedfb629cbbf487605a77e04379026d5cedadcebf2bb4519c9b786179a75e1e` |
| [experiments.md](experiments.md) | `2ad62691ffc59846e2257d63817f67f2117be1c9a7799680f318e2cda82a2de4` |

联合审核 SHA-256：

`507ff7094d6e8ac83f27c28548aabc469c84e6ffeed9a0712b60de167f01f4bc`

联合值按上表顺序，把每行 `文件SHA-256 + 两个ASCII空格 + 文件名 + LF` 拼成 UTF-8 文本后取 SHA-256。本文本身不参与自身 hash。spec 的范围、决策、行为、测试或验收以及两份附件实质改变后，都需要生成新的绑定版本。

## 基线与检查记录

- 分支：`codex/node-dedicated-server`；冻结基点 `1e3619d9eeac03bd779e1393de6a2547a0b7c71f`，依赖尚未合并的 PR #8。该 PR 最新必要 CI 已全部通过；这不是本 change 的产品验收。
- 文档检查通过：四份 Markdown 的 Prettier check、11 个相对文件链接、三份文件 SHA-256 与联合 hash 全部通过；暂存差异仅包含本 change 的四份文档，`git diff --cached --check` 在提交前验证。
- 当前只交付设计，未运行产品测试、构建、性能采样或 LAN/设备验证；不存在实际 RED/GREEN 或 Node 性能提升结论。A1–A9 保持未实施。
- 自查重点：浏览器协调缺口、远端权限 allowlist、断连输入、旧 epoch/回执、完整 manifest 继承、工作量和资源拓扑归因、Wasm 合并边界。未声称独立模型审查。
- 设计提交仅含本 change 的四份 Markdown。提交 SHA 由 Git 记录，避免将提交自身 hash 写入自身内容；未 push；仅快进至已核对的治理基点，未合入 Wasm 实验。
