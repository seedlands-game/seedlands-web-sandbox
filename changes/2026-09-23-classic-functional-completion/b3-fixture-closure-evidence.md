# B3-FIXTURES-01 直接 GameplayRuntime 测试夹具收口

## 范围

- 本 checkpoint 只修改受委派的 14 个 Classic 直接 `GameplayRuntime` 测试和 `classic-gameplay-domain-options.ts`。
- 生产 fail-fast 保持不变：声明 registered Structure actions 的组合仍然必须提供真实 Structure host ports。
- 未修改 `apps/web/tests/fixtures/classic/content.ts`、`classicOptions`、Classic Pack 生产代码、B2 私有 runtime、Authority、浏览器、CI 和 Git。

## 原始 RED

954 执行了这 14 个文件的测试并向 root 提交证据，结果为 `33 failed / 14 passed`；33 个失败全部是 `Registered Structure host ports are unavailable.`。这些直接 domain 测试通过 `classicOptions()` 继承了当前完整 Classic Pack，但其中没有任何测试执行 registered Structure operation 路径。

引入 helper 后第一次正确限定文件范围的运行仍得到 `33 failed / 14 passed`，原因是 helper 从未导出该符号的 `@seedlands/stdlib/host` 导入了 `definePack`。这是测试夹具实现错误，不是断言变更。改用既有的 `@seedlands/stdlib/mod-api` export 后，相同测试集合只剩两个实际依赖失败：`classic-environment` 缺少 Classic voxel gameplay，`classic-life-skills` 缺少组合后的 hotbar selection。

## 组合配置

- `content` 从 `playbooks/classic/src/pack.ts` 选择真实的 `seedlands:overworld-content` 模块，并递归包含其真实的 `seedlands:recipe-crafting-module` capability provider。armor、crops、dungeon、final entities、hostile mechanics、navigation items、progress、projectiles、spawning、special damage、vehicles 和 legacy Structure domain 测试使用该配置。
- `block-rules` 仅用于 `classic-environment`；其 descriptor 依赖闭包加入真实的 Classic block gameplay definitions 和所需 registered modules。该测试已经提供真实 edit callbacks。
- `inventory-actions` 仅用于 `classic-life-skills`；其 descriptor 依赖闭包加入组合态 `selectHotbarSlot` 所需的正式 inventory selection owner。
- helper 拒绝任何包含 `seedlands:overworld-structures` 或 `seedlands:overworld-structure-actions` 的依赖闭包，因此未来依赖漂移不能静默绕过生产 Structure host fail-fast。
- 所有模块都是 Classic Pack 中的真实对象。helper 不伪造 content、air readers、`prepareVoxelEdits` 或 state owners。它通过 `definePack` 和 `assembleOverworldPacks` 重新装配，然后为选中的 resources 创建正常的 gameplay actor/system authorities。

## 行为边界

`classic-structure-interactions.test.ts` 有意保留为 `world.structures.place/sleep/ignite` 的 legacy/domain fixture。它只证明旧纯 domain 行为，不作为 registered B3 door 的证据。registered Classic door Authority 测试由 root 另行持有并验收。

14 个文件中的所有既有断言均保持不变；修改仅限导入窄 helper，并用对应 profile 替换 `classicOptions()`。

## 最终证据

### 命令与结果

- 原始 RED 由 954 执行并向 root 提交证据：14 文件结果为 `33 failed / 14 passed`；每个失败都是 `Registered Structure host ports are unavailable.`。
- 第一次本地运行使用了根 Vitest 配置并返回 `No test files found`；该结果是无效证据，已由正确命令替代且未计入验收。
- 引入 helper 后第一次正确限定文件范围的 Web 运行结果为 `33 failed / 14 passed`，全部由从错误公共入口导入 `definePack` 导致（`definePack is not a function`）。未修改任何行为断言。
- 使用 content profile 的第二次正确限定 Web 运行得到 `12 passed files`；仅 `classic-environment` 和 `classic-life-skills` 保持 RED，证明它们分别依赖 block-rules 和 registered-selection。
- `node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm --filter @seedlands/web test apps/web/tests/integration/runtime/server/composition/classic-armor.test.ts apps/web/tests/integration/runtime/server/composition/classic-crop-runtime.test.ts apps/web/tests/integration/runtime/server/composition/classic-dungeon-runtime.test.ts apps/web/tests/integration/runtime/server/composition/classic-environment.test.ts apps/web/tests/integration/runtime/server/composition/classic-final-entities.test.ts apps/web/tests/integration/runtime/server/composition/classic-hostile-mechanics.test.ts apps/web/tests/integration/runtime/server/composition/classic-life-skills.test.ts apps/web/tests/integration/runtime/server/composition/classic-navigation-items.test.ts apps/web/tests/integration/runtime/server/composition/classic-progress.test.ts apps/web/tests/integration/runtime/server/composition/classic-projectiles.test.ts apps/web/tests/integration/runtime/server/composition/classic-spawning.test.ts apps/web/tests/integration/runtime/server/composition/classic-special-damage.test.ts apps/web/tests/integration/runtime/server/composition/classic-structure-interactions.test.ts apps/web/tests/integration/runtime/server/composition/classic-vehicles.test.ts --maxWorkers=1` -> PASS, `14 files / 47 tests`.
- `node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec eslint <helper plus the fourteen files>` -> PASS.
- `node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec prettier --check <helper, evidence, and the fourteen files>` -> PASS.
- `node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec tsc -p tsconfig.classic-tests.json --noEmit` -> PASS.
- 已运行 `node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec tsc -p tsconfig.test.json --noEmit`，但它仍只被 root/a288 并行修改中的 `authority-interaction-preparation.test.ts`、`gameplay-structure-runtime.test.ts`、`registered-structure-hit-validation.test.ts` 和 `structure-target-dispatch.test.ts` 阻塞。诊断中没有 B3 所有权路径。
- `git diff --check` -> PASS.

### 路径与 SHA256

- `classic-gameplay-domain-options.ts` `afdcfe50052665cde02b7a5bf76db429a56af396b87599cb8c673c5a6ed09883`
- `classic-armor.test.ts` `c3333db5bf400469bb0052f775cc6ab4c7ed2bcd9f944bfbe0f022050971fa48`
- `classic-crop-runtime.test.ts` `d73d48cd711dff81b070e27ca78db8e5ee12f633b1e0f1b3ce6066a3d361344b`
- `classic-dungeon-runtime.test.ts` `dae600b39646b97a95e0e13299d85c5e83b615a61c46c6bf796a3a44d582b7b7`
- `classic-environment.test.ts` `139e1525d5a84172d23dc92537b388acfc51f9b4e337773e2a84af72a35e009b`
- `classic-final-entities.test.ts` `c959999c6c89b6727795f6d7be2f25543e4c9d93c1a1d8a76b6f5cf8af298009`
- `classic-hostile-mechanics.test.ts` `33cf4b7a16389380a266451c0e5f8eeec341401475488aeedf51a5c44d5206f9`
- `classic-life-skills.test.ts` `cbf233682001822c048313f575a137dc23ade493677824ae2ea28c74b8af8043`
- `classic-navigation-items.test.ts` `909cb4b8657d73796c929df057bef5c7c939e877b9b38f817202583cee0e9a25`
- `classic-progress.test.ts` `ef587711f22e4353af622054b4f06d98270f1aabb2829c2e4c22ebe27bbbe252`
- `classic-projectiles.test.ts` `89c82bb067462286b6c7da9b20537ee091f34960635d9d03719e0902adb47efa`
- `classic-spawning.test.ts` `d13b95a4a59d7e6fb35660227db64dba4a5182a70c8bb1e3429f5d61e880b61e`
- `classic-special-damage.test.ts` `44f9b706fc8ed3903b200813f1f22ba13371fb2200cd73f724ce241651c75048`
- `classic-structure-interactions.test.ts` `0fa6780d79f3fd33e97a580f18e826abd40b9611c34a5ebed1d365930bd868d6`
- `classic-vehicles.test.ts` `36954b7fbc4b31b8bc00f75283f73611e2f0420b31326de737a2a3bac39ae0a6`

上述哈希在最终仅 evidence 的修改前采集，并已在 checkpoint 审计中复核。

## 未执行项

- 未运行 browser、build、完整 Web 测试集或 CI；未执行 commit、push 或生产部署。
- 这些夹具不构成 registered Classic door 已通过的声明。
