# 项目窗口独立验收

## 完成状态

项目窗口的独立定向验收通过。完整静态检查与生产构建均已实际执行，但被与本 change 无关、且相对 `origin/main` 未变化的 TypeScript 反例文件阻断，因此这两类全量证据为 **FAIL（外部阻断）**，不能写成通过。

## 改动文件

本验收只新增 `verification/` 下的日志、来源哈希和本记录；未修改被验收源码、合同或项目规则。

## 验证结果

- Node 22：`node --test changes/2026-09-07-agent-routing-contracts/project-tests/*.test.mjs`，6/6 通过。
  - 验证并发串行与旧 wrapper。
  - 验证旧格式他人锁超时不抢占、取消等待不删除他人锁。
  - 验证子进程失败和持有者信号都会清理派生子孙并释放自有锁。
  - 注入 owner 提交 `EIO`：新逻辑仅尝试移除本次创建且仍为空的目录；后来写入的 `foreign-owner` 哨兵保留，未递归删除。
- 定向 ESLint、项目文件 Prettier、`git diff --check`：通过。
- `pnpm verify:static`：Prettier、ESLint、ls-lint、Vitest 均通过；Vitest 为 182 passed / 2 skipped files、865 passed / 4 skipped tests。随后 `tsc -p tsconfig.test.json --noEmit` 在 8 个 `TS2578` 处失败，详见 `project-verify-static.log`。
- `pnpm build`：Rust artifact 指纹校验与 `svelte-check` 通过；同一 `tsc -p tsconfig.test.json --noEmit` 的 8 个 `TS2578` 阻断构建，详见 `project-build.log`。
- 阻断文件相对 `origin/main` 的 diff exit code 为 0：
  - `changes/2026-09-07-data-plane-adoption/e2e/copy-cases.ts`
  - `changes/2026-09-07-data-plane-adoption/e2e/data-plane-worker.ts`
  - `changes/2026-09-07-data-plane-adoption/e2e/workload-worker.ts`
  当前 `origin/main` 为 `4197bdac86d0a7840ea5134fd986714041d9089d`；验收工作树 HEAD 为 `17473e76d95a54aef375e2e86d18073c362ae50d`。

## 限制

- 未启动浏览器、性能基准、线上服务或 agent。
- 协作锁不是系统级隔离；未知、损坏或强杀后遗留的锁仍需要人工核对。
- 在本合同只允许写 `verification/` 的边界内，未建立临时 baseline worktree；可由 root 按已记录的最小命令，在 `origin/main` 上复现该 TypeScript 阻断。

## 下一步

修复或隔离 `changes/2026-09-07-data-plane-adoption/e2e/` 的 8 个无效 `@ts-expect-error` 后，重新运行 `pnpm verify:static` 与 `pnpm build`。项目窗口实现本身可随 global 安装检查点进入提交交付；全量质量门禁仍保持未完成。
