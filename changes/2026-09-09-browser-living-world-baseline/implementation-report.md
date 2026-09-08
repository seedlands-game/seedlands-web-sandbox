# Node 产品退役实施报告

## 变更

- 从 pnpm workspace、TypeScript references、根脚本、Vitest 配置和 CI 删除 `apps/node-server` 产品包及其构建、运行、隔离校验和 Active Node 门禁；`CI=true pnpm install` 成功并报告 `Scope: all 3 workspace projects`，锁文件不再包含 Node 产品 importer。
- 删除 Node 专属测试、Web↔Node 可玩 E2E 和 remote traversal 可执行测试，保留既有 change 的 spec、delivery、independent validation 与 evidence。PR17 的浏览器近战用例原先从退役 E2E 目录导入通用画质选择函数，现已在该单人用例内使用 `SEEDLANDS_BROWSER_E2E_QUALITY`，CI 继续以 Low 画质运行该路径。
- 删除浏览器的 Connect Node、remote URL/key、`RemoteAuthorityClient`、remote mesh mirror、network baseline consumer 和 remote playable 组合入口；默认启动页及 `Game` 只组合 `BrowserAuthorityClient` 和本地 authority worker，并重新生成 SSG 启动页。
- 删除无通用消费者的 `packages/game-core/src/server/dedicated`、`packages/game-core/src/server/compute` 及专项生命周期测试。保留平台无关的 authority、protocol、persistence、checkpoint/save 与 action reference 合同。
- 将 Headless CLI 所需的 Node 平台端口从退役 app 搬到 `scripts/headless/node-core-platform.ts`；`scripts/server-headless.mjs` 改为加载该实现，命令和行为保持不变。
- 更新 ESLint package boundary：活跃包只包含 Web 与 game-core，同时保留对 `apps/node-server` 相对导入和 `@seedlands/node-server` 包导入的拒绝。新增退役合同测试，固定 Node 包、Dedicated/compute 生命周期、专项脚本、CI 门禁和浏览器 remote 产品入口不得回流。
- `.prettierignore` 忽略本 change 的 dispatched contracts，派发合同 SHA-256 复核为 `31b0a6040f957347d068d8dee30d6110c4be3b823a83087e42b47d6cb4d59496`。

活跃引用审计对 `apps packages scripts tests package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig*.json vitest*.ts playwright.config.ts eslint.config.mjs .github .ls-lint.yml .prettierignore` 执行 `rg`。剩余 `apps/node-server` / `@seedlands/node-server` 字样只位于 ESLint 拒绝规则和治理负例断言；`apps/node-server/package.json`、core Dedicated/compute sentinel 和三份专项脚本均不存在。`find apps/node-server packages/game-core/src/server/dedicated packages/game-core/src/server/compute -type f -not -path '*/node_modules/*'` 无输出。

文档同步清单由主任务处理并已出现在工作树：`AGENTS.md`、`README.md`、`README.zh-CN.md`、`docs/product-positioning.md`、`docs/code-map.md`、`docs/repository-structure.md`、`docs/living-world-alignment.md`、`docs/living-world-sources.md`、`docs/playbook-roadmap.md`、`docs/change-archive.md`。最终 Delivery Snapshot 仍应由主任务回填本报告和远端 PR/CI 结果。

## 验证

### RED / GREEN

- 首次直接运行 `pnpm exec vitest run tests/governance/node-product-retirement.test.ts` 在 pnpm 自动重建依赖时因非 TTY 报 `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`，改用项目要求的 `CI=true` 后取得可执行 RED。
- RED：`CI=true pnpm exec vitest run tests/governance/node-product-retirement.test.ts`，1 个文件内 2/2 失败：Node app 仍在活跃 workspace；Headless scripts 平台端口尚不存在。
- GREEN：同一命令最终 1 个文件、2/2 通过；断言同时覆盖 Node app、core Dedicated/compute 生命周期、专项脚本、workspace/root/CI、Headless 平台端口和浏览器 remote 入口。

### 确定性门禁

- `CI=true pnpm verify:static` 最终通过：SSG check、Prettier、ESLint、ls-lint、coverage 和全部 typecheck 均通过；231 个测试文件中 229 通过、2 跳过，1137 项测试中 1133 通过、4 跳过。覆盖率为 statements 95.37%（907/951）、branches 90.42%（463/512）、functions 96.93%（95/98）、lines 96.89%（780/805）；Svelte 0 errors / 0 warnings。
- `CI=true pnpm build` 通过：Rust source/artifact fingerprint、SSG、Web typecheck 与 Vite production build 成功，2523 modules transformed。构建仅保留既有大 chunk warning，无失败。
- `git diff --check` 通过。

### Headless

- `CI=true pnpm exec vitest run tests/server/server-headless-cli.test.ts`：1 个文件、4/4 通过。
- `printf '/seed\n/setblock 1 -20 1 wood\n/inspect voxel 1 -20 1\n/tick 0.1\n/save\n' | env CI=true pnpm --silent server:headless -- --seed retirement-smoke --json`：退出码 0；依次返回 seed、1 voxel mutation committed、Wood (4) inspect、0.1 秒推进和 3 个 dirty chunks 保存成功。

### 浏览器单人路径

- `CI=true pnpm test:e2e:regression` 首次仅因 sandbox 禁止监听 `127.0.0.1:4173` 失败；在获批本机监听环境重跑同一命令，Chromium 20/20 通过，覆盖启动/加载、hydration、资源工坊、浏览器权威玩法和确定性 world regression。测试覆盖的历史 `changes/2026-09-07-loading-performance/evidence/world-loading.png` 已恢复为 HEAD 原件，本 change 未记录或提交新的历史截图。
- `CI=true pnpm test:pr15:integration`：Chromium 2/2 通过，确认 CI 保留的资产包浏览器单人集成路径。
- `SEEDLANDS_BROWSER_E2E_QUALITY=low CI=true pnpm test:pr17:integration`：首次暴露已退役 Web↔Node helper 的活跃导入并在本范围修复；最终 Chromium 1/1 通过，确认 CI 保留的木剑动作体验场单人路径。CI 使用相同的 `SEEDLANDS_BROWSER_E2E_QUALITY=low`。

## 风险

- 本地生产、Headless 与 Chromium 门禁均通过；Linux GitHub Actions、Pages artifact 与远端 PR 状态仍须由主任务创建 PR 后取得终态证据。
- Node Dedicated 的实现和可执行 E2E 已退出当前树，恢复能力依赖主任务已建立并验证的 archive tag 及历史 spec/evidence；本报告未独立执行远端 tag 验证。
- 通用 protocol/persistence/checkpoint 合同仍保留在 game-core，未来如再次引入 Node 产品，必须经过新的 change，并会先触发现有 package-boundary 和退役合同测试。
- 工作树中的忽略目录可能因依赖安装留下物理空目录或 `node_modules`，但没有可版本化的 `apps/node-server` 产品文件；退役合同以 package manifest、源码 sentinel、workspace/lockfile/CI 与导入边界为版本化判据。

## 实际成本

- 执行模型：GPT-5.6 Sol，high。
- Agent 墙钟约 0.7 小时，低于合同 3 小时上限；包含依赖恢复、RED/GREEN、产品与无消费者代码清理、两轮完整静态门禁、构建、Headless 和 23 项 Chromium 验收。
- 未增加第三方依赖。模型 credits、token 和 API 等价费用未由当前运行环境提供，因此不伪造数值。
- 外部写入为 0；未提交、推送或合并，未读取 `.env` 或密钥。
