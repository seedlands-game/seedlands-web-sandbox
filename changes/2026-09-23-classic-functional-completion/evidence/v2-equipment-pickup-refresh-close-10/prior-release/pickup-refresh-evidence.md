# V2 首个 Iron Pickup Route 刷新证据

阶段：`V2-EQUIPMENT-PICKUP-REFRESH-CLOSE-09`

状态：FIXTURE_DETERMINISTIC_STATIC_GREEN。

输入：Browser19 SOURCE6 `315d511e23cc9d7572bac0db3fc3f051af69c93f7f7ec56045d3c26f9ccefe00`、
MANIFEST52 `80fbb2c5b731a3f9659b1c5c46bf3d1fe805ae34f4ba30f53ee44b720dd64268`、delivery
`35bf1a0c9a0abbf100bb3899052b4910c242f613f77ea32c363e164a11e16968`；DIAG01 SOURCE5
`a8dafd1db7b51ca3d85d58a878e28568f12230dd783ad88170000d298bff5449`、MANIFEST6
`61dcc897a03b7a5f2410752206b6242db335ac5fc860b7dd68b122ba4f49def2`、delivery
`b0bc00b245276857fcc1fb67d43acbccd822ecead2342d8292b63ffb19774a68`。

## RED

最终可信 RED 在未修改的 BUILD10 acceptance tree `/private/tmp/seedlands-v2-acceptance-f282da95` 上运行同一最终测试
字节。窗口 `v2-equipment-pickup-refresh-close-09-red-release` 为 `1 file / 7 failed / 3 passed`、`exitCode=1`，不是
missing import 或 collection failure。首项失败直接记录旧实现 `keydown=1/up=1`，而合同要求 refresh strict snapshot 后
`keydown=0/up=0`；其余失败覆盖 correction/refresh 跨 deadline、null fail-closed、未到达继续 pulse、server-late outer
wait 与 V2 options flag。省略/false 默认路径和 strict 负例在旧实现保持通过。

最初主工作树 RED 与 RED-02 都为 `8 failed / 2 passed`；其中额外失败来自测试模型先用默认宽容差绕过 correction，及
对象 identity 断言不适配 `waitForSnapshot` 的 `structuredClone`。原 stdout/window 保留，但最终 RED 以 BUILD10 旧实现
上的 red-release 为准。

## 实现

- `walkTo` options 增加 `refreshAfterCorrection?: boolean`，默认 false。
- true 分支在 correction 后先检查原 deadline；仍在预算才复用已有 `snapshot(page)`，null 立即失败；await 后再次检查
  同一 deadline。仍在预算且 client 已满足原 `reachedRouteTarget` 时返回 refreshed snapshot，否则发送原 pulse。
- 仅 `EQUIPMENT_RESOURCE_WALK_OPTIONS` 设置 true。没有 callback、fallback、target-aim 修改、第二路线、容差或预算变化。
- 为保持既有模块 `max-lines=500`，只在 `walkTo` 内合并两个默认参数解构；职责未移动。

## GREEN 与静态

- `green-release-02`：新测试 `1 file / 10 tests PASS`。
- `affected-release-02`：refresh、arrival-drift、resource route、grounded 52-leg、mining aim、scenario、route-progress 共
  `7 files / 72 tests PASS`，`maxWorkers=1`。
- `classic-types-release-02`、`root-types-release-02`、`eslint-release-02`、`format-release-02`、
  `scoped-diff-release-02` 均 `PASS/exit 0`。
- 所有最终门禁各自使用默认 benchmark machine lock；shell 使用 `pipefail`，没有吞掉失败 exit。

中途记录保留：`green` 先有 6 项失败，随后 `green-02` 仅剩测试 view 未对齐 Pointer Lock baseline，`green-03` 和后续
行为门禁通过；Classic types 首轮因测试 options 重复 `pulseMs` 报 TS2783；ESLint 前两轮暴露 `harness.ts` 超出 500 行，
局部压缩后通过；Prettier 首轮只报新测试并经单文件 write 修正。这些均未被改写成 PASS。

## 边界

Browser19 仍为 FAIL；首个 iron 的 leftdown/voxel clear/drop 已观察，inventory pickup 仍 NOT PROVEN。fixture/static
GREEN 不证明 Browser20 或完整 V2 产品 GREEN。本阶段未运行 build、Browser20、Cua、devserver、CI、Git/index/push、
deploy 或 merge。长期 docs 未更新，因为本片不改变 owner、生产协议或架构边界。
