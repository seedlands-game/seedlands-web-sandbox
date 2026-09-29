# V1 Fluid Source Browser Target 证据

状态：`V1-FLUID-TARGET-WEB-01` 完成。只修改 Web ray、PlayerController、BrowserGameplay及对应测试；未修改 stdlib、Classic、协议、Pack、Authority、canonical scenario或并行 fluid integration test。未运行 build、browser、Cua、dev server、CI或Git写操作。

## 实现边界

- `traceVoxelTarget` predicate 从 `(voxel)` 扩展为 `(voxel, x, y, z)`；JavaScript/TypeScript 现有单参数 callback保持合法。坐标来自 Amanatides-Woo 正在遍历的真实 cell。
- `BrowserGameplay.canTargetFluidSource()` 每次读取当前 `authority.gameplay`：生存从当前 inventory selected slot取 item，创造从当前 creative hotbar selected slot取 item，再只接受当前 `items` 投影中 `{ type: 'fluid-container', fluid: 'empty' }`。没有硬编码 bucket ID，没有缓存 item、selection或 epoch。
- `game-player-controller` 将该 getter作为必填 binding注入 `PlayerController`。World切换会创建新 BrowserGameplay/PlayerController；同一 Authority restore更新 gameplay getter，二者都不会复用旧 selection。
- `PlayerController` 仍优先命中当前 registry 的 `semantics.targetable`。只有 empty fluid-container hint 为 true、voxel semantics已注册且 `world.getFluidCell(x,y,z)` 精确为 `{ source: true, level: 8 }` 时，才把非targetable fluid cell作为目标。
- 射线遇到未注册 semantics 后本次 traversal fail closed，不越过 unknown cell选择后方source。filled container、普通物品、flowing fluid均继续跳过Water；targetable墙体仍先命中。
- 这是 Browser目标选择 hint，不提交 policy，不替代server 对 binding、`voxelHitPolicy: 'fluid-source'`、LOS、source、selection与freshness的权威重查。

## RED / GREEN

首次RED：

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/tests/unit/client/voxel-target.test.ts apps/web/tests/unit/app/player-fluid-target.test.ts --maxWorkers=1
```

结果：`2 files / 2 failed / 5 passed`。

- ray测试返回 `null`，证明predicate没有真实cell坐标；
- PlayerController在 `canTargetFluidSource=true` 且真实full source cell存在时仍返回 `null`，证明Web仍跳Water。

最小实现和动态selection测试后目标集合：`3 files / 9 tests PASS`。最终连同既有输入回归：

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/tests/unit/client/voxel-target.test.ts apps/web/tests/unit/app/player-fluid-target.test.ts apps/web/tests/unit/app/browser-gameplay-fluid-target.test.ts apps/web/tests/unit/app/player-input-gates.test.ts apps/web/tests/unit/app/player-creative-break-input.test.ts apps/web/tests/unit/client/creative-container-input.test.ts --maxWorkers=1
```

结果：Web 定向集合 `6 files / 31 tests PASS`；该计数不包含或代表任何 server 测试。覆盖：

- predicate读取真实cell坐标并命中source；
- camera eye `y=32.600001` 的真实ray命中 y=32 cell，不混用Authority body feet；
- empty/filled、survival/creative、selection变化、当前items投影变化即时生效；
- full source可选，flowing不可选，unknown不能越过，targetable wall优先；
- 原 Pointer Lock gating、creative mining cadence与secondary interaction选择没有回归。

相邻回归首次暴露 `player-creative-break-input.test.ts` 的fake World缺正式 `authority.voxelSemantics`；加强unknown fail-closed后又暴露fixture未注册Air。测试补入真实最小Air/Stone semantics与必填 `canTargetFluidSource=false`，未删除或放宽原4个mining断言。

## 静态验证

所有重命令使用默认 `benchmark-window` 全机锁；Vitest固定 `--maxWorkers=1`。

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm --filter @seedlands/web typecheck
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec tsc -p tsconfig.test.json --noEmit --pretty false
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec eslint apps/web/src/client/presentation/voxel-target.ts apps/web/src/app/player/player-controller-types.ts apps/web/src/app/player/player-controller.ts apps/web/src/app/player/fluid-source-target.ts apps/web/src/app/player/game-player-controller.ts apps/web/src/app/gameplay/browser-gameplay.ts apps/web/src/app/gameplay/fluid-source-target-selection.ts apps/web/tests/unit/client/voxel-target.test.ts apps/web/tests/unit/app/player-fluid-target.test.ts apps/web/tests/unit/app/browser-gameplay-fluid-target.test.ts apps/web/tests/unit/app/player-creative-break-input.test.ts
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec prettier --check apps/web/src/client/presentation/voxel-target.ts apps/web/src/app/player/player-controller-types.ts apps/web/src/app/player/player-controller.ts apps/web/src/app/player/fluid-source-target.ts apps/web/src/app/player/game-player-controller.ts apps/web/src/app/gameplay/browser-gameplay.ts apps/web/src/app/gameplay/fluid-source-target-selection.ts apps/web/tests/unit/client/voxel-target.test.ts apps/web/tests/unit/app/player-fluid-target.test.ts apps/web/tests/unit/app/browser-gameplay-fluid-target.test.ts apps/web/tests/unit/app/player-creative-break-input.test.ts changes/2026-09-23-classic-functional-completion/fluid-target-web-contract.md
```

- Web typecheck：最终 PASS；Svelte `0 errors / 0 warnings`。
- Root test typecheck：本域无诊断。该命令执行当时仅报告并行 server 文件 `packages/stdlib/tests/server/item-interaction-security.test.ts:126-130` 五处 `TS7024`；这是当时的失败来源记录，不表示其当前状态或当前 owner。当前 server owner 已由 root 指定为 954，本阶段未越权修改或重测该域。
- 定向 ESLint：PASS。中间两个既有大文件因新增逻辑超过500行；将本次纯逻辑提取到同域 helper后通过，没有关闭规则。
- 定向 Prettier：PASS。scoped `git diff --check` 当时使用上述全部 Web 源码/测试、合同及本 evidence 的固定路径列表并通过；该长 argv 未保存在原命令回显中，本次文档收口不凭空重构或重跑 Git 命令。

## SHA-256

```text
b893b33f3165733aebdc33b68fa6c58fe81a17addaeafcf3038b41f7a0976050  apps/web/src/client/presentation/voxel-target.ts
6ee652340efb125c2e0db3248fc3757450d9083d776a08d860743a8cf6ba049f  apps/web/src/app/player/player-controller-types.ts
0f42be733e5d3e99a59b11b27819a219e15f3d55d2b9e7db4546df710dcd9de7  apps/web/src/app/player/player-controller.ts
7e205013f150a6c856675eb10bece65c3f87bda90ace3e8772500fe054afea48  apps/web/src/app/player/fluid-source-target.ts
7413a34d56e67cfcdfea29e5484ba4f7773c6cddede938535bf3cc320e786402  apps/web/src/app/player/game-player-controller.ts
67cd3ff0fd7fa8af5770bc75e62d163feb9e12acc4267393007c7185d99ec77d  apps/web/src/app/gameplay/browser-gameplay.ts
823caa3c3e085c07c88178fd8d79f6c965fd6be03ff215732cbe10f72e3c4adb  apps/web/src/app/gameplay/fluid-source-target-selection.ts
bcda14b2500a8e7b32898d5bab66589795b2bf6459aabd36c63e69f7a3644a60  apps/web/tests/unit/client/voxel-target.test.ts
82f718c12371017ae2d55c0a07f9bdc67122e14df17617c377c5d73bffe406c6  apps/web/tests/unit/app/player-fluid-target.test.ts
257b601d49fd69b0fd57ff708b2d300ed2dfd036bd91d7c141aaea1c6e2c0e74  apps/web/tests/unit/app/browser-gameplay-fluid-target.test.ts
378c79ebc6a49dd24fa69c18dfa02f9619a8cd8ec05cf82da5711553e3356aff  apps/web/tests/unit/app/player-creative-break-input.test.ts
89a3e7eb6834c3bf833b56636f0b339fb4fae702d7f2ec0efc914d9e21b2184d  changes/2026-09-23-classic-functional-completion/fluid-target-web-contract.md
```

上述哈希取自最终行为、类型、Lint、格式和 scoped diff check之后；evidence自身哈希在checkpoint单独回报。

## 未验证

- 未启动production browser；尚未证明真实鼠标、Pointer Lock与Authority的完整水桶取水旅程。
- 未运行 server fluid integration；当前 server owner 为 954，face LOS和trusted target policy由该 owner 独立准出。
- 单元测试不替代唯一canonical artifact/Cua验收。
