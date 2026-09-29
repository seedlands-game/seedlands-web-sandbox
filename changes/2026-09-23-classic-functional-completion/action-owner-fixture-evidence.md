# V2 Harness Action Owner Fixture Close 证据

阶段：`V2-HARNESS-ACTION-OWNER-FIXTURE-CLOSE-01`
基线：`01c650793c79ac34e6184da48b5a4c94a5f161c2` / tree
`e20a8b1d85520c960096b5c898c3ffdd7e241b2a`
状态：测试 fixture GREEN；生产代码未修改；Browser/build/Git 未运行。

## 修复内容

`world-harness-session.test.ts` 的 action owner 用例改用 HEAD Classic 正式注册的 passive `cow`，不再请求已 retired
且未注册的 `settler`。spawn 和 start-action 现在分别断言：

- Harness transport 外层 `ok:true`；
- 内层 `CommandResult.success:true`；
- spawn 返回 `id='foreign'` 与 `archetype='cow'`；
- start 和 Authority readback 返回同一 `actorId='foreign' / type='idle' / status='pending'` action。

原 checkpoint restore、foreign action id、missing action id 的两组 `actions()` 与两组 `query-action`
`WORLD_PERMISSION_DENIED` 断言均保持，并在完整 suite 中实际通过。没有新增 actor、mock、helper、skip 或生产 fallback。

## 证据分层

RED 复用 root 已独立核验的 `V2-RESTORE-REFERENCE-BASELINE-CONTROL-01`。其 clean HEAD control 与只含
reference11 的 candidate 在同命令、同环境、单 worker 下均为 `1 failed / 9 skipped`，同在 HEAD
`world-harness-session.test.ts:340`，实际值为 `getActorAction('foreign') === null`。这证明旧失败先于本片且不是
reference regression。

最终 candidate 从同一 HEAD 创建，只覆盖 reference11 与本片测试文件。离线 frozen install、tree identity 与 realpath
证明其没有从主 dirty 或其他临时树导入内部包。唯一完整 closure 为：

```text
equipment-restore-reference.test.ts     11/11 PASS
world-harness-session.test.ts           10/10 PASS
browser-authority-world-harness.test.ts  7/7 PASS
TOTAL                                   28/28 PASS
```

此外 root test types、Classic test types、目标测试文件 ESLint、精确 Prettier 均 PASS。没有运行 production types、
build、artifact、Browser、Cua、dev server 或 CI；本片不声明产品 GREEN。

## 边界与预算

本片只修改一个既有测试用例，并新增本合同、证据摘要和 evidence 目录。reference 11 路径与历史
baseline-control evidence 均保持原字节；其他 worker dirty 由 preflight/final SHA 清单逐项保护。主 Git index 未写。

传统工程量 `0.1 PD`；AI 目标 `<=45min`、硬上限 `1h`、120% 建议 `0.9h`。credits、费率、API 等价费用、
当前额度和预测占比均为 `unknown`。
