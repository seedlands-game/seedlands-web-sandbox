# 移除 MoonBit 实验代码与工具链

**状态：** Agile flow；已完成本地实现与确定性准出，正在通过 GitHub PR #9 与当前分支其余 change 一并交付

## Context & Goal

MoonBit 已完成与优化 TypeScript、Rust scalar 和 Rust SIMD 的同 corpus 对照。正式数据表明，MoonBit 在 W02–W07 的端到端任务均未超过 Rust；生产已选择 Rust W02–W06，且仅 W06 默认使用标准 SIMD128。因此将 MoonBit 从可执行代码、构建工具链、生成产物和主动测试面中移除，降低维护与供应链成本，同时保留不可执行的历史结果、原始 JSON/压缩采样和结论文档。

## Scope & Non-goals

### Scope

- 固化 MoonBit 与优化 TypeScript、Rust 的最终同机配对数据、来源文件、source SHA 和证据 hash。
- 删除 `wasm/seedlands-kernels/`、MoonBit 固定工具链、构建/校验脚本、生成产物与专属治理测试。
- 删除仅用于 MoonBit 历史实验的 Playwright 执行代码与 WasmGC 探针二进制；保留其 JSON、压缩原始采样和中文结论文档。
- 将仍有价值的 Rust/通用 Wasm 等价测试改为读取生产 Rust scalar artifact；删除仅比较 Rust 与 MoonBit 的重复 reference 测试。
- 从混合数据面采样器移除 MoonBit mode，但保留优化 TS、Rust scalar、Rust SIMD 的复现实验能力；汇总器继续可以读取已经冻结的 MoonBit 数据。
- 常规 `build` 只验证 Rust scalar/SIMD 生产产物。

### Non-goals

- 不删除 Rust core、Rust 工具链、Rust scalar/SIMD 产物或生产默认 W02–W06。
- 不删除历史 Markdown、JSON、`.json.raw.gz`、CPU profile 或最终采纳报告；这些是已获取数据，不再承诺旧 MoonBit 实验可重跑。
- 不改变客户端实验配置、TypeScript 回退、Worker 拓扑、Wasm ABI、算法或默认值。

## Decisions

- 数据保留与代码保留分离：历史证据可读，但不再保留 MoonBit compiler、源码、模块和 runner。
- 通用测试以生产 Rust scalar artifact 验证 ABI、确定性与等价性；SIMD 另由现有 scalar/SIMD 等价测试验证。
- 历史文档中的 MoonBit 名称、数值与旧路径作为事实保留，不属于主动依赖；README 明确旧实验不可重跑。
- 删除均为 Git 跟踪文件，可从删除前提交恢复；不清理用户目录中的任何全局或缓存工具链。

## Behaviour

- **Given** 新 checkout，**When**运行 `pnpm build`，**Then**只校验 Rust Wasm 产物，不解析 MoonBit 工具链或旧 manifest。
- **Given** 运行 Vitest，**When**验证通用 Wasm adapter，**Then**使用生产 Rust scalar artifact，且不读取旧 MoonBit binary。
- **Given** 需要审阅旧实验，**When**打开保留的数据快照与原始证据，**Then**可看到任务均值、比较边界、source SHA 和证据 hash，但不会得到可重跑 MoonBit 命令。
- **Given** 搜索主动源码与包脚本，**When**检查 MoonBit 路径和命令，**Then**不存在 MoonBit 工具链、`.mbt` 源码、旧 artifact 或 package script。

## Test Design

- `tests/governance/legacy-wasm-removal.test.ts`（Static/Vitest）：先建立 RED，断言旧源码、工具链、产物和 package scripts 均不存在，同时 Rust 生产命令与产物仍存在。
- 现有 Wasm adapter/等价测试（Vitest）：切换到 Rust scalar 后保持 GREEN。
- `pnpm verify:static`（Static）和 `pnpm build`（Build）：证明类型、lint、coverage 与生产构建不依赖 MoonBit。
- `pnpm wasm:rust:verify`（Build）：证明保留的 Rust 产物指纹有效。
- 浏览器与 Midscene：N/A。本次不改变用户行为或渲染语义，只删除未被生产入口加载的实验实现；现有客户端 change 的浏览器证据边界保持不变。

## Acceptance & Evidence

- [x] **Data：** `moonbit-results.md` 固化最终数据、证据文件、source SHA 和 hash；格式化后的快照 SHA-256 为 `d13fdb546f614bf677ad90b8e2525ebd1f69808f741342fc3daa2b657cc11d53`。
- [x] **Vitest：** 删除门禁先按预期 RED 失败于 `wasm/seedlands-kernels` 仍存在；实现后定向 12 个文件/31 个用例全部通过，完整 coverage 运行 182 个文件通过、2 个跳过，863 个用例通过、4 个跳过。
- [x] **Static：** `pnpm verify:static` 通过；statements 95.37%、branches 90.42%、functions 96.93%、lines 96.89%，Svelte 0 error / 0 warning。
- [x] **Build：** `pnpm wasm:rust:build`、`pnpm wasm:rust:verify` 和 `pnpm build` 通过；构建链没有 MoonBit 工具链调用，Vite 产物仅包含 Rust scalar/SIMD Wasm。
- [x] **Repository：** 主动源码、测试、脚本、生成目录和 package scripts 不再保留 MoonBit 执行依赖；历史数据/文档和只读数据汇总器除外。
- [x] **Delivery Snapshot：** 已记录删除清单、验证命令、限制和恢复方式。

## Tasks & Current State

1. [已完成] 读取冻结性能汇总、原始证据索引和当前生产采纳方案。
2. [已完成] 写入数据快照和预期 RED 删除门禁。
3. [已完成] 删除 MoonBit 源码、工具链、产物、专属 runner 与测试，迁移通用测试到 Rust artifact。
4. [已完成] 运行确定性检查与构建并更新交付快照。

## Delivery Snapshot

### 删除范围

- 删除 11 个 `.mbt`/MoonBit package 文件、`wasm/toolchain-lock.json`、4 个构建/检查/manifest 脚本和旧 `9,788 bytes` artifact/manifest。
- 删除 12 个旧 MoonBit change Playwright runner 文件、WasmGC 探针二进制、2 个专属治理测试和 1 个 Rust-vs-MoonBit 重复 reference 测试，共 34 个 Git 跟踪文件。
- 删除是 Git 可恢复操作；没有删除用户目录、全局安装或缓存。历史 Markdown、JSON、`.json.raw.gz` 和 CPU profile 原样保留。

### 保留与迁移

- 通用 Wasm 生命周期、W02–W07、W10、W14/W15 等价测试改读生产 Rust scalar artifact。MoonBit 特有的 trap/错误码假设改为 Rust ABI 的 `-1` 拒绝，并用合成 trap 保留实例失败熔断测试。
- 混合数据面 runner 移除 MoonBit mode，保留原 TS、优化 TS、Rust scalar 与 Rust SIMD；SIMD runner 和统计测试改用后续 data-plane change 中的通用 corpus/statistics。
- 重建后的 Rust scalar 为 `22,527 bytes` / SHA-256 `5bb21e950fd600939413043c9d28eb20044884cfe357cd2d700187b80a78f461`；SIMD 为 `24,089 bytes` / SHA-256 `320402dd0e3b8df902a106ef1a584f56236bad6ad3075628e42bce8b341b14d4`。

### 验证命令与限制

- `pnpm exec vitest run <12 个受影响文件>`：31/31 PASS。
- `pnpm verify:static`：PASS。
- `pnpm wasm:rust:build`：PASS；两种生产 artifact 已重建并校验。
- `pnpm build`：PASS；只输出 Rust scalar/SIMD Wasm。
- 本 change 不新增浏览器产品行为，因此没有重复运行 Playwright/Midscene；当前分支客户端实验配置 change 先前的独立浏览器/Harness 阻塞状态不因本清理变更而改变。
- 当前工作树还包含同一轮尚未提交的客户端实验配置 change；按其准出状态，本 change 未单独 commit 或 push。
