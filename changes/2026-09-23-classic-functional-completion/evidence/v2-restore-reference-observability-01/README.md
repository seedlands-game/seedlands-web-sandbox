# V2 Restore Reference Observability 01 Evidence

状态：`FOCUSED_DETERMINISTIC_STATIC_GREEN / BROWSER_NOT_RUN`。本目录保存本片可信 RED、GREEN、静态门禁与最终
SOURCE/MANIFEST/delivery 自检原始回执。完整解释见同级
`../../restore-reference-observability-evidence.md`。

## 身份与结果

- 基线：`01c650793c79ac34e6184da48b5a4c94a5f161c2` / tree
  `e20a8b1d85520c960096b5c898c3ffdd7e241b2a`。
- 可信 RED：`red-02`，`10 failed / 1 passed / 17 skipped`；失败直接来自旧实现缺少 reference variant 和
  consumer inspect/fail-closed。
- 最终 focused GREEN：`focused-green-final-05`，`1 file / 11 tests PASS`。
- 受影响旧路径：`affected-tests-sealed`，`2 files / 16 passed / 1 skipped`。
- 静态：stdlib/Web/root-test/Classic-test types、目标 ESLint 与正常 Prettier 均 PASS。
- 既有非本片缺口：`existing-action-owner-diag-01` 独立复现
  `getActorAction('foreign') === null`；未修改对应测试或生产行为。

验证使用从该 commit 提取、仅覆盖本片 allowlist 文件的临时 APFS clone，避免消费主工作区既有 lighting、transport、
climb 和 `mod-api.ts` dirty。依赖只链接现有安装，不下载、不改 lockfile。

## 边界

本阶段没有运行 Browser26、`--list`、build、artifact、Cua、dev server、CI 或 Git/index/commit/push/PR。真实 Browser
与产品状态仍为 `NOT_RUN/NOT_CLAIMED_GREEN`；Browser25 的 `2 passed / 1 skipped` 不能外推到本片。death/worldItems、
16 armor、194 catalog、V3/V4 均未实施。

`SOURCE-MANIFEST.sha256` 冻结本片最终 working source 与基线/命令身份；`MANIFEST.sha256` 冻结选定原始回执和总结，
排除自身、delivery 与最终 selfcheck 以避免自引用。所有早期失败原件都保留，但只有 diagnosis/delivery 明确列出的窗口
用于最终结论。
