# V2 Restore Reference Baseline Control 01

状态：`PREEXISTING_REPRODUCED / CANDIDATE_NEW_TESTS_PASS / AFFECTED_KNOWN_FAIL`。本阶段不实施或修改生产、测试、spec、tasks、state、长期 docs 或历史
evidence，只比较同一 committed HEAD 的 clean control 与仅覆盖已批准 reference slice 11 个路径的 candidate。

基线为 `01c650793c79ac34e6184da48b5a4c94a5f161c2` / tree
`e20a8b1d85520c960096b5c898c3ffdd7e241b2a`。control/candidate 都是 task-owned 临时验证树，不是产品 worktree，
不写主 Git 或 index。依赖只允许通过各自树内 `pnpm install --offline --frozen-lockfile --ignore-scripts` 解析；内部
`@seedlands/*` link 必须 realpath 回各自临时树。

固定对照命令为现有 Web Vitest 配置、`--maxWorkers=1`，精确选择
`authorizes action ids against their actual actor owner`。control 与 candidate 各执行一次，不改用例、seed、时间、
locale 或命令。candidate 内部 link 证明通过后，再一次运行 focused 11 与既有 session/adapter 完整套件，不过滤旧
failure。

本阶段不运行 build、artifact、Browser、Cua、dev server、CI 或 Git/index/commit/push/PR/deploy/merge。对照不要求
PASS；若两侧同点失败，只能记录 `PREEXISTING_REPRODUCED`，不能称 affected 全 GREEN。

## 对照结果

- control：全部源码和测试均为 HEAD 字节；精确旧用例结果 `1 failed / 9 skipped`，失败在
  `world-harness-session.test.ts:340`，`getActorAction('foreign')` 为 `null`。
- candidate：同一 HEAD，仅覆盖 reference slice 批准的 11 个路径；同命令结果同为
  `1 failed / 9 skipped`，失败位置、断言和实际值相同。结论为 `PREEXISTING_REPRODUCED`，不是 candidate regression。
- candidate 完整组合：focused 新文件 `11/11 PASS`，原 session `9/10 PASS`，原 adapter `7/7 PASS`；runner
  汇总 `27 passed / 1 failed`。除上述已由 control 复现的旧用例外，没有第二个失败。

## 旧用例缺口

旧测试用 Classic composition 请求 `spawn-actor` 的 `settler`，但 HEAD 的 Classic actor profiles 已删除该 archetype，
`retired-actors-migration.ts` 也将 `settler` 列为 retired。`spawnAutonomousActor()` 先调用 profile registry
`require('settler')` 并失败；`ServerCommandExecutor` 把异常包装为内层
`CommandResult.success:false / COMMAND_EXECUTION_FAILED`。`AuthorityWorldHarness.command()` 本身成功完成 transport
transaction，故返回外层 `ok:true`、
`data.success:false`。旧测试两次只断言外层 `{ok:true}`，没有检查内层 command success；不存在的 `foreign` actor 没有
action，最终读取为 `null`。本阶段不修复、不 `.skip`、不改 seed/命令/时间/locale。

HEAD 精确调用链为：旧用例 `world-harness-session.test.ts:327-340`；`spawn-actor` 分派
`gameplay-command-handler.ts:296-302`；profile lookup `game-server-gameplay-host.ts:107-125` 与
`actor-profile.ts:134-137`；Classic 当前列表 `playbooks/classic/src/actors.ts:3-111`，retired 声明
`retired-actors-migration.ts:4`；命令异常转内层 failure `server-command-executor.ts:115-131`；Harness 返回
transaction result `authority-world-harness.ts:220-247`，再由 `run()` 在 `456-460` 包为外层成功。

## 依赖与身份

control 与 candidate 分别执行一次 `pnpm install --offline --frozen-lockfile --ignore-scripts`，两次均报告 lockfile
up to date / Already up to date，下载 0、lockfile 不变。`link-resolution.stdout.log` 证明 Web 的 stdlib/kernel/Classic/
cognition、stdlib 的 kernel、Classic 的 stdlib 均 realpath 到各自临时树，而非主工作区或另一棵树；两侧旧测试、
Kernel、Classic pack、未批准 `mod-api.ts` 与 lockfile 哈希相同。先前 reference evidence 的临时 clone 没有留下这类
绑定证明，因此其依赖归属保持 `UNKNOWN`，不倒填。

本阶段预算为传统 `0.1 PD`，AI 目标 `<=45min`、硬上限 `1h`、120% 建议 `0.9h`；credits、费率、API 等价
费用、当前额度和预测占比均为 `unknown`。最终清单、自检和边界见 `SOURCE-MANIFEST.sha256`、`MANIFEST.sha256` 与
`delivery-validation.json`。
