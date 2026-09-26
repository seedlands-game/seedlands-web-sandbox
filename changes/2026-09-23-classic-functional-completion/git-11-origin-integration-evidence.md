# GIT-11 可信交互原点集成证据

阶段：GIT-11 staged-tree 验证

## 隔离身份

- 基线 HEAD：`7d6bcfcc8de5e4694052ce8692f982e47bbe3ef2`。
- 生产/测试验证前的精确 index 写为 tree `c0d1a8ce0320782fe2ac264394cc18d5e81bf9da`，并创建无引用临时 commit
  `9e3334a3481f0a17c0cae991c096db29a1736410`。
- detached 验证树：`/private/tmp/seedlands-git11-origin`。
- 根、Web 与 Classic 的 `@seedlands/stdlib` 均解析到
  `/private/tmp/seedlands-git11-origin/packages/stdlib`；pnpm task state 为真实目录。

该树只包含本批已暂存的可信 interaction origin、Browser-03 原始证据、合同和状态，不读取共享工作树
中未提交的 Lighting、transport 或社区文件作为测试源码。

## 最终测试

stdlib security：

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec vitest run --config packages/stdlib/vitest.config.ts packages/stdlib/tests/server/item-interaction-security.test.ts --maxWorkers=1
```

结果：exit 0，`1 file / 8 tests passed`。

Web 正式 spine、Classic action 与 fluid：

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/tests/integration/runtime/server/composition/item-interaction-spine.test.ts apps/web/tests/integration/runtime/server/composition/classic-item-interaction-red.test.ts apps/web/tests/integration/runtime/server/composition/classic-fluid-interactions.test.ts --maxWorkers=1
```

结果：exit 0，`3 files / 22 tests passed`。该数字包含新增 direct-host 边界用例，不沿用此前
`3 files / 20 tests` 的中间结果。

上述测试与三类 typecheck 后只继续调整本阶段证据文件的无损归档扩展名、GIT-11 evidence 和
execution-state；四个生产/测试文件及冻结 origin contract/evidence 未再改变。

## 类型与静态检查

以下命令均在同一 detached staged tree、默认 benchmark lock 中独立执行并 exit 0：

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm --filter @seedlands/stdlib typecheck
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec tsc -p tsconfig.test.json --noEmit
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec tsc -p tsconfig.classic-tests.json --noEmit
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec eslint packages/stdlib/src/server/gameplay/modules/item-interaction-module.ts packages/stdlib/src/server/gameplay/modules/block-host-commit.ts packages/stdlib/tests/server/item-interaction-security.test.ts apps/web/tests/integration/runtime/server/composition/classic-fluid-interactions.test.ts
```

最终 Prettier 检查覆盖四个生产/测试路径、origin contract/evidence、GIT-11 evidence、Browser-03
报告、execution-state 与可格式化的 Browser-03 JSON；机器原始 `*.json.log`、gzip 和 trace 分片按
字节保留，不进入格式化。root 已核 SHA 的原 `item-interaction-origin-evidence.md` 保持逐字节不变，完整
staged `git diff --check` 因其第 1 段两处 Markdown 硬换行报告已知 trailing whitespace；排除这一份
冻结历史证据后，对全部生产、测试、新合同、新 GIT-11 证据、Browser 报告/state 与原始 evidence
目录执行目标 `git diff --check`，无输出。

## Browser-03 原始证据

- 原始 canonical trace 共 `193342205` bytes、SHA-256
  `fb0dbcd0cb210018a8b6f473d89bbfdc598c51a464863136e73f835d5a009042`。因单文件超过 GitHub
  100 MB 限制，机械切为 85000000、85000000、23342205 bytes 三片；按文件名字节序执行
  `cat canonical-trace.zip.part-* > canonical-trace.zip` 后摘要与原文件一致。
- 原始 error context 经 deterministic gzip 保存；解压内容 SHA-256 仍为
  `5537a948f745541a108a24064b6c402683da83915d2729b02a7f53a420143385`。
- `classic.json.log` 与 `performance-window.json.log` 仅改扩展名，字节和原摘要不变。

## 边界

本阶段证明可信眼位 origin 在 dispatcher 和 registered fluid host 的 prepare/final validate 中一致，且
保留五格半径、hit/adjacent 双 LOS、stale/unknown/墙后拒绝。未运行 Browser-04、build、Cua、CI
或部署；Browser-03 的 door、media、C4/C5 仍为 NOT REACHED。
