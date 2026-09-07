# 最新主干同步验证

## 范围

在 `codex/data-plane-adoption-main-sync` 将已完成的WASM数据平面提交 `1580dcd` 与 `origin/main@c777ba8` 整合。主干负责app/client目录重组与上下文文档；本change保留控制/数据平面约束、General Worker默认W02–W06、W06标准SIMD及完整TS回退。

## 合并处理

- `AGENTS.md`：采用主干精简入口、源码归属和交付上下文，同时保留已验证的数据平面、缓冲所有权、Rust core、SIMD及WebGL2边界。
- `src/client/compute/browser-compute-runtime.ts`：采用主干新路径，保留WASM worker name选择。
- `src/client/compute/wasm-experiment-selection.ts`：随计算职责迁入新目录；对应测试同步更新。
- 数据平面测试中两处client import和WebGL2静态检查路径按主干目录调整。
- 历史A对照runner的当前实现import迁入新目录；冻结A的绝对import增加局部说明与TypeScript预期错误边界，使日常静态检查不依赖已清理的临时checkout。显式执行历史性能runner前仍须按原记录准备冻结A。

## 失败与收敛

1. 首次 `pnpm verify:static` 在新增spec表格的Prettier检查失败；格式化后继续。
2. 第二次在coverage阶段发现两处旧路径；修正后相关6项测试通过。随后test TypeScript发现历史runner依赖已清理的 `/tmp/seedlands-adoption-baseline`，补充局部边界并以独立 `tsc -p tsconfig.test.json --noEmit` 验证。
3. 第三次完整静态门禁通过。上述失败均为合并后的路径或临时基线依赖，不是内核等价性或产品行为失败。

## 最终证据

- `pnpm wasm:verify`：通过；9788 bytes，SHA-256 `e342dd87279fe651eba7e649a6b5c0db172bd7653dbbf6380c272f88a7f7b17a`。
- `pnpm wasm:rust:verify`：通过；Rust源码/产物指纹一致。
- `pnpm rust:check`：通过；core闭包仅为 `world-kernels`。
- 关键集成Vitest：4文件、8项通过；路径修复定向Vitest：2文件、6项通过。
- `pnpm verify:static`：通过；178文件/854项通过，3文件/5项既有跳过；world行覆盖96.89%；Svelte 0错误0警告；TypeScript通过。
- `pnpm build`：通过；2442模块完成生产构建。
- `SEEDLANDS_E2E_PORT=4281 pnpm test:e2e:regression`：8/8通过。

本次没有重跑性能A/A′/B；旧采样仍是原冻结源码的历史证据，不替代同步后实体设备或新的性能测量。
