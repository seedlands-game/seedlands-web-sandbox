# Media 扩展夹具归因与收口证据

更新时间：2026-09-25

状态：确认的测试夹具漂移已关闭；12-file 最终为 `10 files passed / 2 files failed`、`102 passed / 2 failed`。两个失败均在精确 `HEAD 78545d877ed08ee0613a690ff53e36b0c2120b69` 的必要基线中复现，保留为生产/兼容合同 RED，不归因于 Media，也未通过修改测试意图掩盖。

## 边界

- 当前工作树同时含未提交的 Media 与 Lighting 实现。本任务只修改下列 Classic composition 测试及 `classic-gameplay-domain-options.ts`；未改 production、Pack、Authority、registered Media runtime、`media-dependent-removal.test.ts`、浏览器、CI 或 Git index。
- `gameplay-registered-block-actions.test.ts` 在本任务开始前已有并行修订，本任务只运行并保留，未修改。`classic-fluid-interactions.test.ts` 与 `geometry-capability-integration.test.ts` 无需修改。
- Media public evidence 输入文件 SHA-256 为 `7f87f11fff0a988e9ac24c79a00febe89de2692f6c59c32bff4e735dee65edc1`。没有重复其无变化的 95 项 Web Media 验证。

## 初始 RED 与分类

在当前最终树、12 个测试 fixture 尚未修订时，原 evidence 的完整 12-file 命令得到 `9 files failed / 3 passed`、`73 failed / 31 passed`；本任务原样重跑得到相同计数。初始化错误为：

- `37` 次 `Registered Media host loaded-cell port is unavailable.`：direct `GameplayRuntime` 测试把整个 Classic Pack 装入只测试 Needs/Inventory/Mode/Feeding/Combat 的局部宿主，因此无关 Media capability 要求正式 loaded-cell port。不能用 fake/noop port 修绿。
- `21` 次 `Media track resource is not present in the composition Pack lock`：`GameServer` 测试复制完整 Classic modules，却把 Pack 改成测试 ID并声明空 resources，破坏 Media 的 `packId + path` 闭包。
- `1` 次 `Pack integrity receipt is missing or adds resources: seedlands:overworld`：真实 Classic actor-profile 测试保留正式 Pack manifest，却仍给空 integrity resources。
- `1` 次 `Unknown actor profile: settler`；其余失败由 Vitest 合并展示。当前与基线 Classic profile 都已明确退休 `grazer`、`night-stalker`、`settler`，现行 Pack 只含 12 个实际 profile。

这些是夹具装配/身份漂移，不是放宽 production fail-fast 的理由。

## 修复

- `classicGameplayDomainModules(roots, replacements)` 从当前 Classic 模块的真实 `descriptor.provides/requires` 递归构建最小闭包；replacement 仍按真实 module ID参与依赖解析。单域测试不再复制完整 Pack，也不注册无关 Media/Structure capability。
- Block domain 使用正式 `defineBlockActionsModule()` replacement，因此不隐式要求 station/media host；需要这些集成的测试仍使用完整 `GameServer` composition。
- 完整 Classic actor-profile 测试保留 `seedlands:overworld` manifest 和资源列表，测试 receipt 对每个 manifest resource提供合法 digest；没有跳过或弱化 Pack resource 校验。
- secondary permissions、Feeding、Needs、Inventory 的 actor 改为现行真实 Classic `zombie`/`pig` profile；实体 ID可保留测试语义。没有把退休 profile 加回产品。
- Combat 测试从 setup 装配的 `composition.resources` 建立后续 authorizer，不再访问不存在的 `GameplayRuntime.resources`。需要 transfer、mode、inventory 的用例显式把对应真实 root module纳入闭包。
- Mining 的 stone voxel 正式定义在基线和当前树均掉落 `cobblestone`；旧 `stone-block` 断言修正为真实内容规则。

## HEAD 78545d87 对照

创建独立 detached 临时 worktree `/private/tmp/seedlands-media-fixture-baseline-794`，HEAD 精确为 `78545d877ed08ee0613a690ff53e36b0c2120b69`。依赖仅安装在该临时树；未操作主树 index 或其他 worktree。验证结束后该 worktree 已移除。

- 原 12-file 命令在 baseline 得到 `9 files failed / 3 passed`、`71 failed / 33 passed`。大量失败来自当时测试 fixture 已不满足 B3 Structure host ports、Pack resource receipt及 retired actor合同，因此不能把当前初始 `73/31` 整体称为 Media 回归。
- `gameplay-mining-progression` 在 baseline 同样得到 `cobblestone` 而测试期待 `stone-block`；修正的是既有断言漂移。
- `gameplay-mining-progression` 的 restore 用例在 baseline 与当前树均于 restore 后首次完成 mining 时失败：`Block completion failed: OPERATION_FAILED: Kernel state owner is disposed.`
- captured fixture `apps/web/tests/fixtures/checkpoints/base-checkpoint.json.gz` 当前与 baseline SHA-256 均为 `f8ef2fbdad68a16fdcd2e5bea59b0fd96cdcc76ee697daf7f0dea6bff86329cc`；其 Pack identity 为 manifest `e3c199e87d101672c1635d481771972edbf39deb43c336063ab3753d0b01bb89`、entry `924d61fc72f253c85e191caa79f1c7ff51f83bc6237ad613a7c0c5595c2c169f`、空 resources。在 baseline 临时树只修其已退休 actor为现行 `zombie`、补当时 Pack 已声明的 presentation receipt，并经正式 `GameServer.restore()` 路径运行后，仍准确失败为 `Legacy gameplay composition identity is not an approved predecessor.`。未替换 captured identity。

## 保留的精确 RED

1. `gameplay-registered-needs.test.ts` 的 “migrates the legacy shared NPC needs phase...” 保留 captured identity与 V3 恢复断言。触发链为 `GameServer.restore -> GameServerGameplayHost.prepareRestore -> GameplayRuntimeCheckpoint.restore -> createCompositionCheckpointGuard.validateGameplay`，在 `checkpoint-identity.ts:200` 拒绝该 captured predecessor。当前 spec/docs 仍声明 V1–V4 与旧 Pack 迁移必须显式兼容，未找到授权删除该 lineage；需 root 决定 production migration owner。
2. `gameplay-mining-progression.test.ts` 的 “restores actual half-finished mining...” 保留真实保存/恢复/继续采掘断言。触发链为 `GameServer.restore` 替换 `activeGameplay` 并 dispose旧 runtime，随后 `advanceGameplayRules -> RegisteredBlockRuntime.drain` 的 operation 调用命中旧 `Kernel state owner is disposed`。baseline 同样失败，属于 pre-Media production owner重绑定缺陷；本任务不改 `GameServer`、world commit或 registered block runtime。

## 验证

- 当前树原始 12-file：`9 failed / 3 passed` files，`73 failed / 31 passed` tests。
- 精确 baseline 原始 12-file：`9 failed / 3 passed` files，`71 failed / 33 passed` tests。
- 夹具修复后的完整 12-file：`2 failed / 10 passed` files，`2 failed / 102 passed` tests；失败仅为上述两个 RED。
- 排除两个 RED 文件的 10-file集合：`10 files / 87 tests PASS`。
- `classic-gameplay-domain-options.ts` 的既有 14-file消费者回归：`14 files / 47 tests PASS`。
- `pnpm exec tsc -p tsconfig.test.json --noEmit`：PASS。
- `pnpm --filter @seedlands/web typecheck`：PASS，Svelte `0 errors / 0 warnings`。
- 本任务 10 个 TypeScript 修改文件 targeted ESLint：PASS。
- 所有 Vitest 与类型/Lint/格式命令均通过 `node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- ...` 串行执行，Vitest固定 `--maxWorkers=1`。未运行 build、browser、dev server、CI 或 Git 写入。

### 可重放命令

完整 12-file 从仓库根目录执行：

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm --filter @seedlands/web test \
  apps/web/tests/integration/runtime/server/composition/secondary-actor-permissions.test.ts \
  apps/web/tests/integration/runtime/server/composition/actor-profile-closure.test.ts \
  apps/web/tests/integration/runtime/server/composition/gameplay-registered-needs.test.ts \
  apps/web/tests/integration/runtime/server/composition/classic-fluid-interactions.test.ts \
  apps/web/tests/integration/runtime/server/composition/gameplay-registered-inventory-actions.test.ts \
  apps/web/tests/integration/runtime/server/composition/gameplay-prepared-mode.test.ts \
  apps/web/tests/integration/runtime/server/composition/gameplay-registered-feeding.test.ts \
  apps/web/tests/integration/runtime/server/composition/block-content-ownership.test.ts \
  apps/web/tests/integration/runtime/server/composition/gameplay-registered-combat.test.ts \
  apps/web/tests/integration/runtime/server/composition/geometry-capability-integration.test.ts \
  apps/web/tests/integration/runtime/server/composition/gameplay-registered-block-actions.test.ts \
  apps/web/tests/integration/runtime/server/composition/gameplay-mining-progression.test.ts \
  --maxWorkers=1
```

排除两个已归因 RED 的 10-file GREEN 子集：

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm --filter @seedlands/web test \
  apps/web/tests/integration/runtime/server/composition/secondary-actor-permissions.test.ts \
  apps/web/tests/integration/runtime/server/composition/actor-profile-closure.test.ts \
  apps/web/tests/integration/runtime/server/composition/classic-fluid-interactions.test.ts \
  apps/web/tests/integration/runtime/server/composition/gameplay-registered-inventory-actions.test.ts \
  apps/web/tests/integration/runtime/server/composition/gameplay-prepared-mode.test.ts \
  apps/web/tests/integration/runtime/server/composition/gameplay-registered-feeding.test.ts \
  apps/web/tests/integration/runtime/server/composition/block-content-ownership.test.ts \
  apps/web/tests/integration/runtime/server/composition/gameplay-registered-combat.test.ts \
  apps/web/tests/integration/runtime/server/composition/geometry-capability-integration.test.ts \
  apps/web/tests/integration/runtime/server/composition/gameplay-registered-block-actions.test.ts \
  --maxWorkers=1
```

共享 helper 的既有消费者回归与类型检查：

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm --filter @seedlands/web test \
  apps/web/tests/integration/runtime/server/composition/classic-armor.test.ts \
  apps/web/tests/integration/runtime/server/composition/classic-crop-runtime.test.ts \
  apps/web/tests/integration/runtime/server/composition/classic-dungeon-runtime.test.ts \
  apps/web/tests/integration/runtime/server/composition/classic-environment.test.ts \
  apps/web/tests/integration/runtime/server/composition/classic-final-entities.test.ts \
  apps/web/tests/integration/runtime/server/composition/classic-hostile-mechanics.test.ts \
  apps/web/tests/integration/runtime/server/composition/classic-life-skills.test.ts \
  apps/web/tests/integration/runtime/server/composition/classic-navigation-items.test.ts \
  apps/web/tests/integration/runtime/server/composition/classic-progress.test.ts \
  apps/web/tests/integration/runtime/server/composition/classic-projectiles.test.ts \
  apps/web/tests/integration/runtime/server/composition/classic-spawning.test.ts \
  apps/web/tests/integration/runtime/server/composition/classic-special-damage.test.ts \
  apps/web/tests/integration/runtime/server/composition/classic-structure-interactions.test.ts \
  apps/web/tests/integration/runtime/server/composition/classic-vehicles.test.ts \
  --maxWorkers=1
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec tsc -p tsconfig.test.json --noEmit
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm --filter @seedlands/web typecheck
```

定向 ESLint/Prettier 使用下方 manifest 中实际修改的 10 个 TypeScript 文件，并通过同一 `node scripts/benchmark-window.mjs --wait-timeout-ms 600000 --` 前缀串行执行；`git diff --check` 只检查本任务 owner 路径和本 evidence。

## 当前文件 SHA-256

```text
a2949c2dbe78006cbdb8c89d54940b4798a246cbc922ca06d4b93e4560c41d8e  secondary-actor-permissions.test.ts
884c892cbf7020a9b1491db2a3c247caf731f71d4d19e7e11666f4554351425b  actor-profile-closure.test.ts
24f95de9ce4dc3b942166c79b3ccb55f9d7294417b3e0f5ef5d9d5693a6b48b4  gameplay-registered-needs.test.ts
71963015bb4edf587f7f737f5613f3aa31e70bd55b34d4ac0c855ac3e7e38a2e  classic-fluid-interactions.test.ts
79286a1ff5fc3ea3dcbd37b92601d62f2d717e0d29fcab94d5c392ff2f62e407  gameplay-registered-inventory-actions.test.ts
6055016a527992ac1f522e7a24d742f8f5080d84475b34c9a25b60629f330513  gameplay-prepared-mode.test.ts
5f0e27089f9f4315cdef17d5ce6aadfc738d2a31a4ee8a1ca374a4d29233f83f  gameplay-registered-feeding.test.ts
57f8b7bd2fc64f8981faf726d55f1cd7758b2fe40af083a423f4d9f0ab585173  block-content-ownership.test.ts
9ea1b7b0719cc19a3d6ccc2f906052c2e4939e7b03d6103232d04fef76d4f234  gameplay-registered-combat.test.ts
68f058941c0e0e6ecfee89552c543f55dab27a086d99c7cf4416eaea67797ccb  geometry-capability-integration.test.ts
9297dd3027281d99b690a6014f565b1b3ffc741463d5eaecb7fa00b58ee38110  gameplay-registered-block-actions.test.ts
31f7b43664fbd7e673b3ad31a45beab9867836e6d99f7c7c6333e44b64877057  gameplay-mining-progression.test.ts
27f833b8b2f92f224dfd502a37ac4d7ae75872dd383bd5b77e52c2dda084eec5  classic-gameplay-domain-options.ts
```

上述 TypeScript hash 是最终格式检查前读取值；后续未再修改这些 TypeScript 文件。Evidence 自身的最终 hash 单独随 checkpoint 回报。
