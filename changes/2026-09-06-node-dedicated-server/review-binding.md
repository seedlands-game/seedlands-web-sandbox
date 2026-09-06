# Node 方案审核绑定

状态：设计已交付，实施待用户审核。用户本轮要求先完成方案；无生产代码、可执行测试、依赖或产品配置变更。

## 精确审核对象

| 文件                             | SHA-256                                                            |
| -------------------------------- | ------------------------------------------------------------------ |
| [spec.md](spec.md)               | `3c192bbd437c66d8644cef22347ee7eac61fe5e98ead4903d342e0a1d77463c6` |
| [overview.md](overview.md)       | `adb989f72178650d620dfcc3901aa5914266ecd90897e69d86651bb999df4c92` |
| [experiments.md](experiments.md) | `6e055ca38234541185034c045c85908317fbcbb2882daa420736986f693b1e3c` |

联合审核 SHA-256：

`6ecd28023785a05c2238ad936a3ca0d4d80497817571509a258570016c6f7cba`

联合值按上表顺序，把每行 `文件SHA-256 + 两个ASCII空格 + 文件名 + LF` 拼成 UTF-8 文本后取 SHA-256。本文本身不参与自身 hash。spec 的范围、决策、行为、测试或验收以及两份附件实质改变后，都需要生成新的绑定版本。

## 基线与检查记录

- 分支：`codex/node-dedicated-server`；最终基点为最新远端 main `c777ba811cf4a77500f43e3e1af8c814b725443c`，已按用户要求合入；PR #8 已合并，文件树与原 `1e3619d` 一致。本次同步无产品差异，这不是本 change 的产品验收。
- 文档检查通过：四份 Markdown 的 Prettier check、11 个相对文件链接、三份文件 SHA-256 与联合 hash 全部通过；暂存差异仅包含本 change 的四份文档，`git diff --cached --check` 在提交前验证。
- 当前只交付设计，未运行产品测试、构建、性能采样或 LAN/设备验证；不存在实际 RED/GREEN 或 Node 性能提升结论。A1–A9 保持未实施。
- 自查重点：浏览器协调缺口、远端权限 allowlist、断连输入、旧 epoch/回执、完整 manifest 继承、工作量和资源拓扑归因、Wasm 合并边界。未声称独立模型审查。
- 设计提交仅含本 change 的四份 Markdown。提交 SHA 由 Git 记录，避免将提交自身 hash 写入自身内容；未 push；已同步最新 main，未合入 Wasm 实验。
