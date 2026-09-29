# V2 Harness Action Owner Fixture Close 合同

阶段：`V2-HARNESS-ACTION-OWNER-FIXTURE-CLOSE-01`
基线：`01c650793c79ac34e6184da48b5a4c94a5f161c2` / tree
`e20a8b1d85520c960096b5c898c3ffdd7e241b2a`
状态：`TEST FIXTURE ONLY`；不修改生产、Harness 协议、授权规则或其他测试。

## 目标与边界

只修复 `world-harness-session.test.ts` 中
`authorizes action ids against their actual actor owner` 的过期 fixture。HEAD 的 Classic actor profiles 不再注册
`settler`，且 migration 已将其列为 retired；旧用例只断言 `WorldHarnessResult.ok:true`，没有验证嵌套
`CommandResult.success`，因而允许失败的 spawn/start 命令继续执行并最终在 null action 上失败。

本片使用 HEAD 已注册的 passive `cow`，保持原 seed、位置、idle action、checkpoint restore 和四条
`WORLD_PERMISSION_DENIED` 断言。spawn 与 start-action 都必须同时满足外层 `ok:true` 与内层 `data.success:true`；spawn
结果必须返回 `id='foreign'`、`archetype='cow'`，start 结果与 Authority readback 必须返回同一个 action id、
`actorId='foreign'`、`type='idle'`。这保证测试真正进入原有 action owner 授权拒绝路径，而不是把 transport 成功误当命令
成功。

不重新注册或 mock `settler`，不新增 Harness/helper，不改生产实现、reference slice、配置、runner、CI、其他测试或
`.skip`。若 `cow` 的正式 autonomous action 仍失败，保留证据并停止，不扩大生产范围。

## RED、GREEN 与验收

RED 复用 `V2-RESTORE-REFERENCE-BASELINE-CONTROL-01` 的 clean HEAD 对照：control 与 reference candidate 均为
`1 failed / 9 skipped`，同在 HEAD `world-harness-session.test.ts:340`，且 root 已核验对应 evidence。无需再次运行旧 RED。

GREEN 在 task-owned clean candidate 中执行：

1. `pnpm install --offline --frozen-lockfile --ignore-scripts`，内部 `@seedlands/*` links 必须全部 realpath 回 candidate。
2. 一次完整运行 focused reference test、既有 world-harness session 与 Browser Authority adapter，不能用 `-t` 或 skip
   排除旧用例；预期按 runner 实际结果为 28/28。
3. 只运行相关 root/Classic test types、单 TS ESLint、精确正常 Prettier 与 scope 检查；已验证 production types 不重复。

done_when：新 focused 11、原 session 10、原 adapter 7 全部通过；修复用例的两条前置命令均证明内层 success 与身份，
原四条 permission 断言原样存在并执行；candidate 只含已批准 reference 11 路径和本片测试修改；主 HEAD/index 与其他
dirty 字节不变。

不运行 build、artifact、Browser、Cua、dev server、CI 或 Git/index/commit/push/PR/deploy/merge。本片预算为传统
`0.1 PD`，AI 目标 `<=45min`、硬上限 `1h`、120% 建议 `0.9h`；credits、费率、API 等价费用、当前额度与预测占比
均为 `unknown`。
