# CI 集成测试超时证据

## 原始 RED

- GitHub Actions run：`34022234830`
- Job：`Static verification`
- PR merge SHA：`da89e3d885edab27cc286fa219ac01dc03ebb77d`
- PR head SHA：`e684516805d828f58db99c9ae32dbf26cbadedc9`
- 环境：Ubuntu 24.04、Node.js 22.12.0、pnpm 11.25.0
- 命令：`pnpm verify:static` 中的 coverage Vitest
- 汇总：147 个测试文件中 3 个失败，738 项测试中 8 项失败；全部失败均为默认 `5000ms` 超时，没有断言失败。整轮 Vitest 用时 105.88 秒。

精确失败位置：

- `tests/server/gameplay-command-persistence.test.ts:139`：Headless 生存命令流程。
- `tests/server/headless-session.test.ts:68`：流体计算与提交。
- `tests/server/headless-session.test.ts:80`：30Hz 与 120Hz 两组墙钟语义；60Hz 同组通过。
- `tests/server/headless-session.test.ts:94`：Logic 与 Fluid lane helper。
- `tests/server/server-headless-cli.test.ts:35`：JSON-line 命令流程。
- `tests/server/server-headless-cli.test.ts:59`：三类初始角色命令流程。
- `tests/server/server-headless-cli.test.ts:89`：旧 `/tick` 秒语义。

同一测试集合此前在本机 macOS / Node.js 26 的完整静态检查中通过；PR head 到当前工作树的上述三个测试文件没有差异。CI 实际耗时显示这些用例约需 5.0 至 6.0 秒，说明默认 5 秒预算不能覆盖较慢 runner 上的真实 Headless 初始化、计算和子进程启动。

## 最小修复边界

- 只为上述 5 个测试声明、共 8 个参数化结果设置 `15_000ms` 超时，与相邻的真实长 Headless 用例保持一致。
- 保留所有行为、状态和 lane 数量断言。
- 不改全局 Vitest 超时，不跳过或弱化用例，不串行化全套测试。
- 不改生产代码，也不改浏览器性能门槛。

## 定向 GREEN

- `pnpm exec vitest run tests/server/headless-session.test.ts tests/server/server-headless-cli.test.ts tests/server/gameplay-command-persistence.test.ts`：退出码 0；3 个文件、20 项测试全部通过，用时 12.80 秒。
- `pnpm exec prettier --check changes/2026-09-06-stable-sun-and-break-drop/ci-timeout-evidence.md tests/server/headless-session.test.ts tests/server/server-headless-cli.test.ts tests/server/gameplay-command-persistence.test.ts`：退出码 0。
- `pnpm exec eslint tests/server/headless-session.test.ts tests/server/server-headless-cli.test.ts tests/server/gameplay-command-persistence.test.ts`：退出码 0。
- 未运行浏览器、完整静态检查或生产构建；完整 CI 等远端新提交后验证。

## 最终 PR CI 的后续 RED

GitHub Actions run `34027831088` 在 head SHA `89404aae380c1288b24cc50c6f92fef281c8dbc6` 上再次得到三项超时：

- `fluid-interactive-priority.test.ts` 的 single/batch 合并场景在默认 5 秒预算内连续创建两套真实世界，约 5.1 秒。
- `headless-session.test.ts` 的 `/tick 61` 场景真实执行 3660 个物理步、1220 个玩法周期和 1830 个流体周期，约 15.9 秒，超过已有 15 秒预算。
- `simulation-command-persistence.test.ts` 的单一声明连续生成五个真实 seed 世界，约 5.1 秒。

本轮没有业务断言失败。后续改为按独立行为拆分前两类多 fixture 计时，保留五个 seed 的全部断言；跨 60 秒 Authority 分片的批量仿真保持 61 秒与完整 lane 计数，只把该单项预算设为 30 秒。完整合同、RED 与远端准出边界见 [`changes/2026-09-06-ci-integration-workload/spec.md`](../2026-09-06-ci-integration-workload/spec.md)。

本机定向实现结果：3 个文件、28 项测试全部通过，退出码 0，用时 11.98 秒；完整 TypeScript、受影响文件 Prettier/ESLint 和 diff check 通过。拆分后全仓预期为 753 个通过、4 个跳过；最终结论仍等待推送后的 Ubuntu coverage CI，不能用本机定向结果替代。
