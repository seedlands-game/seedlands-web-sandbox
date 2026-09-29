# GIT-42 Restore Reference Delivery

状态：`PENDING_NATURAL_HOOK`。A/B 两笔自然 hooks 已通过，C 组尚待提交。本目录记录从
`01c650793c79ac34e6184da48b5a4c94a5f161c2` 构造的 clean detached delivery tree 验证与三笔语义提交前快照。

## 提交分组

- A：4 个 stdlib World Harness 文件、existing equipment restore consumer/canonical receipt、focused test、change spec、
  restore reference contract、`docs/harness-contracts.md`，共 10 路径。
- B：既有 `world-harness-session.test.ts` 的单用例 fixture 修复与独立合同，共 2 路径。
- C：两份 evidence 摘要、四个完整 evidence 目录、`tasks.md`、`execution-state.md` 和本目录。

验证 tree 只以 HEAD 加 A/B/C allowlist 构成。依赖必须在 tree 内执行
`pnpm install --offline --frozen-lockfile --ignore-scripts`，内部 `@seedlands/*` links 全部 realpath 到该 tree。A+B
先精确 staged，再在默认机器锁、单 worker 下串行执行：3 文件 28 tests；stdlib/Web production types；root/Classic
test types；8 TS ESLint；12 路径正常 Prettier；staged scope/diff。

本阶段不运行 build、artifact、Browser、Cua、dev server 或 CI。Browser25 只属于旧 source；新 reference 的
old stale/new current/UI continuation 必须等待 GIT42 后的新 artifact 和唯一 Browser 租约。death/drop/respawn、16 armor、
194 catalog、V3/V4、Cua 听觉与 performance 均未完成。

预算：AI 目标 `<=2h`、硬上限 `3h`；传统工程量沿本批小型集成按 `0.25 PD`，120% 建议 `0.3 PD`；AI 120%
建议 `2.4h`。credits、费率、API 等价费用、当前额度与预测占比均为 `unknown`。

提交前固定 SHA：A `a1bc8d6f32588ae22d8d573442403a53cf59aee8`；B
`cc8cfb06d0040d4b35594f25673780b394d276cb`。两笔均由自然 pre-commit/commit-msg hooks 完成。C 的最终 SHA、
普通 push 与 PR #41 读回只在最终 checkpoint 报告。owned 文件共 256 个，最大 blob 为 `83,401` bytes。
