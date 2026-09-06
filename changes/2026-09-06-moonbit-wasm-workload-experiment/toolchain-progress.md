# MoonBit 工具链进度

## 已固定内容

- 本地工具链目录：调用方可通过 `SEEDLANDS_MOON_HOME` 显式指定；默认只查找本机 content-addressed cache，不执行下载。
- 已验证 `moon` `0.1.20260827 (d0aaa07 2026-08-27)`、`moonc` `v0.10.11+6ff76a5f9 (2026-08-28)`、core `0.10.11+6ff76a5f9` 和 `moon-wasm-opt` `wasm-opt version 125 (version_125)`；四者的版本和可执行文件 hash 均记录在 `wasm/toolchain-lock.json`。
- 下载来源与归档 SHA-256 记录在 `wasm/toolchain-lock.json`。当前归档缓存 key 为 `9f617c9a`；历史归档路径返回 403，因此不把未校验的 `latest` 下载当作安装步骤。

## 脚本用法

- `node scripts/moonbit-toolchain.mjs`：定位并验证固定工具链；缺失或版本不匹配时返回明确错误。
- `node scripts/check-wasm.mjs`：从 `wasm/seedlands-kernels/` 执行 `moon check --target wasm` 和 `moon fmt --check`；追加 `--test` 时执行 `moon test --target wasm`。
- `node scripts/build-wasm.mjs`：从单一 `wasm/seedlands-kernels/` package 执行 `moon build --release --target wasm`，将 MoonBit 产物 `kernels.wasm` 复制并重命名为 `src/generated/wasm/seedlands-kernels.wasm`，再使用锁定的 `moon-wasm-opt -O3 --enable-bulk-memory --enable-reference-types --enable-multivalue` 原位优化。`--check` 先运行检查，`--hash` 输出优化后产物 SHA-256；构建产物不纳入版本控制。

## 当前验证

- 先行治理测试已确认缺少脚本时的预期 RED。
- 固定工具链的 `moon version`、`moonc -v`、`moon check --help` 与 `moon fmt --help` 已读取并用于锁定命令形状。
- 固定工具链 post-opt 实际构建通过：`src/generated/wasm/seedlands-kernels.wasm` SHA-256 为 `e342dd87279fe651eba7e649a6b5c0db172bd7653dbbf6380c272f88a7f7b17a`；输出同时显示锁定的 `moon-wasm-opt` 路径。
- `moon check --target wasm` 通过，`moon test --target wasm` 退出码为 0（当前无 MoonBit test entry）。`moon fmt --check` 已按实际 CLI 执行，但当前源文件的 formatter diff 使其以 255 退出；这属于内核源文件格式待处理，脚本会保留失败而不伪造通过。
- `tests/governance/wasm-toolchain.test.ts`：9 项通过，覆盖 optimizer 版本、hash、路径返回、优化参数和缺失工具链负例。

## 共享配置接线建议

负责人可在后续 change 中自行接入 `package.json` 脚本、静态忽略规则和 CI；本工作项不改这些共享文件。建议命令为：

```text
node scripts/check-wasm.mjs
node scripts/build-wasm.mjs
node scripts/build-wasm.mjs --check --hash
```
