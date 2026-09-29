# V2 首个 Iron Pickup Route 刷新证据

阶段：`V2-EQUIPMENT-PICKUP-REFRESH-CLOSE-10`

状态：FIXTURE_DETERMINISTIC_STATIC_GREEN。

Close-09 原件已归档到 `evidence/v2-equipment-pickup-refresh-close-10/prior-release/`。其 SOURCE6
`114047959f5b42bf7f2b0dcf6db4239bc6b4d1959de2fb8251da652e3c2ca4a5`、MANIFEST79
`709a6ebbd0c543020920b72ffea65932f4a3f41ed2749be166860baca3829d62`、delivery
`02f5a71308c04374fbcfc261ea6597fa4db8776b5c1c30c5986a7ff16326b867` 和六项 SOURCE 字节保持不变。
Close-09 的 `10/10` 与 `7 files / 72 tests` 是真实结果，但当时测试没有覆盖默认路径在 correction 后跨 deadline；
因此其 `genericDefaultBehaviorChanged:false` 声明由 Close-10 取代，而不是改写历史结果。

输入：Browser19 SOURCE6 `315d511e23cc9d7572bac0db3fc3f051af69c93f7f7ec56045d3c26f9ccefe00`、
MANIFEST52 `80fbb2c5b731a3f9659b1c5c46bf3d1fe805ae34f4ba30f53ee44b720dd64268`、delivery
`35bf1a0c9a0abbf100bb3899052b4910c242f613f77ea32c363e164a11e16968`；DIAG01 SOURCE5
`a8dafd1db7b51ca3d85d58a878e28568f12230dd783ad88170000d298bff5449`、MANIFEST6
`61dcc897a03b7a5f2410752206b6242db335ac5fc860b7dd68b122ba4f49def2`、delivery
`b0bc00b245276857fcc1fb67d43acbccd822ecead2342d8292b63ffb19774a68`。

## RED

Close-10 窗口 `v2-equipment-pickup-refresh-close-10-red` 使用 fake clock 直接调用真实 exported `walkTo`：省略和
显式 false 两例在 correction snapshot 将时钟推进到 deadline 之后，期望仍发送一轮 KeyS 并由原
`waitForSnapshot` 返回到达样本。Close-09 实现仅这两例失败，均在 `harness.ts` 无条件 post-correction deadline
检查处提前抛出 `Real input route timed out`；其余 10 例通过，故为 `1 file / 2 failed / 10 passed` 的行为 RED。

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
- 只有 true 分支在 correction 后先检查原 deadline；仍在预算才复用已有 `snapshot(page)`，null 立即失败；await 后再次检查
  同一 deadline。仍在预算且 client 已满足原 `reachedRouteTarget` 时返回 refreshed snapshot，否则发送原 pulse。
- 仅 `EQUIPMENT_RESOURCE_WALK_OPTIONS` 设置 true。没有 callback、fallback、target-aim 修改、第二路线、容差或预算变化。
- 省略/false 不增加 correction 后的 `Date.now()` 读取或提前 timeout，继续原 pulse 与 snapshot read 次数。
- 为保持既有模块 `max-lines=500`，只在 `walkTo` 内合并两个默认参数解构；职责未移动。

## GREEN 与静态

- Close-10 `green`：新测试 `1 file / 12 tests PASS`，包括省略与显式 false 的跨 deadline 兼容用例。
- Close-10 `affected`：refresh、arrival-drift、resource route、grounded 52-leg、mining aim、scenario、route-progress
  共 `7 files / 74 tests PASS`，`maxWorkers=1`。
- Close-10 `classic-types`、`root-types`、`eslint` 已 `PASS/exit 0`；最终 format/scoped diff 与 metadata identity
  见本阶段 delivery。
- 所有最终门禁各自使用默认 benchmark machine lock；shell 使用 `pipefail`，没有吞掉失败 exit。

Close-09 的 `green-release-02` 为 `1 file / 10 tests PASS`，`affected-release-02` 为 `7 files / 72 tests PASS`，
其类型、ESLint、format 与 scoped diff 也真实通过；这些旧结果只描述 Close-09 当时覆盖，不替代 Close-10 新增的默认
路径回归。

中途记录保留：`green` 先有 6 项失败，随后 `green-02` 仅剩测试 view 未对齐 Pointer Lock baseline，`green-03` 和后续
行为门禁通过；Classic types 首轮因测试 options 重复 `pulseMs` 报 TS2783；ESLint 前两轮暴露 `harness.ts` 超出 500 行，
局部压缩后通过；Prettier 首轮只报新测试并经单文件 write 修正。这些均未被改写成 PASS。

## 边界

Browser19 仍为 FAIL；首个 iron 的 leftdown/voxel clear/drop 已观察，inventory pickup 仍 NOT PROVEN。fixture/static
GREEN 不证明 Browser20 或完整 V2 产品 GREEN。本阶段未运行 build、Browser20、Cua、devserver、CI、Git/index/push、
deploy 或 merge。长期 docs 未更新，因为本片不改变 owner、生产协议或架构边界。
