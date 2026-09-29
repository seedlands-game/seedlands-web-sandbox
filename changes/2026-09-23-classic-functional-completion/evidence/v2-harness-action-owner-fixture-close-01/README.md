# V2 Harness Action Owner Fixture Close 01 Evidence

状态：`FIXTURE_GREEN / 28_OF_28_PASS / NO_PRODUCT_CHANGE`。本目录仅保存旧 action-owner fixture 修复的 control
继承、最终 candidate、类型与静态回执。

基线为 `01c650793c79ac34e6184da48b5a4c94a5f161c2` / tree
`e20a8b1d85520c960096b5c898c3ffdd7e241b2a`。RED 复用已由 root 核验的
`v2-restore-reference-baseline-control-01`：clean HEAD 与 reference candidate 均在旧用例同点失败。

本片最终 candidate 是 task-owned 临时树，只包含 HEAD、已批准 reference 11 路径和本片单个测试 fixture 修改。首次
offline install 本身报告 Already up to date，但因为正式 evidence 目录尚未创建，`tee` 失败并使 wrapper exit 1；该次不作为
依赖成功证据，原 window 保留。后续使用同一命令重跑。

本阶段不运行 build、artifact、Browser、Cua、dev server、CI 或 Git/index/commit/push/PR/deploy/merge。

## 修改与验证

唯一测试修改位于 `authorizes action ids against their actual actor owner`：把 retired `settler` 替换为 HEAD 已注册的
passive `cow`，并对 spawn/start 两条命令同时断言 Harness 外层 `ok:true`、内层 `data.success:true` 及返回 entity/action
身份；Authority readback 还断言 action 为 `foreign/idle/pending`。原 seed、position、timeout、checkpoint restore 和四条
`WORLD_PERMISSION_DENIED` 断言均保留。

最终 candidate 全量 identity 为 reference slice `8 tracked + 3 untracked`，再加本片目标测试 `1 tracked`；合计
`9 tracked + 3 untracked`，无其他源码差异。6 个内部 workspace links 均 realpath 回 candidate 根，lockfile、Kernel、
Classic actors、未批准 `mod-api.ts` 与 adapter 保持 HEAD 哈希。

唯一完整三文件 closure `candidate-full` 为 `3 files / 28 tests PASS`：focused reference `11/11`、原 session
`10/10`、原 Browser adapter `7/7`。`root-test-types`、`classic-test-types`、单文件 `eslint` 和精确 `format` 均
`PASS/exit 0`。生产 types 已在前片验证，本片未机械重跑。

首次 candidate install 的 `pnpm install --offline --frozen-lockfile --ignore-scripts` 本体报告 Already up to date，
但正式 evidence 目录尚未创建导致 `tee` 失败，wrapper 为 `FAIL/exit 1`；该次不作为成功证据。目录建立后同命令
`candidate-install-02` 为 `PASS/exit 0`，下载 0、未执行 scripts、lockfile 不变。

RED 不重跑，直接引用 root 已核验的 baseline-control：SOURCE29
`27b1ec6c4bfc176fa878e351ebb0035b7d1411d9855c7f7c5c87671621074cf1`、MANIFEST17
`6d8f64b1d3da2aefd2891bd2535537981547c448b3f2acf31422ccdeb446c1a3`、delivery
`6af1d46fccbb7e9884bcb481a933dc93d5c7fca0e1431cd0a9d6b357c430ac3e`。其 clean HEAD control 与 reference
candidate 均为旧用例 `1 failed / 9 skipped`、同点 `getActorAction('foreign') === null`。
