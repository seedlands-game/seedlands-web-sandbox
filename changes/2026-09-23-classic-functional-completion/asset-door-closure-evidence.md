# 木门物品资产闭包证据

记录时间：2026-09-25 05:01:14 CST
阶段：`V1-ASSET-DOOR-CLOSE-01`
触发基线：远端 `edafd0c9` 的干净 build 在 `ssg:check` 阶段由 `asset-catalog.ts:236` 抛出 `Missing builtin item material mapping: wooden-door`，没有生成 dist。

## 根因与修复

- Classic `wooden-door` 已正确迁移为 Structure 放置物品，因此没有 `placesVoxel`；恢复 `placesVoxel` 或 world voxel 52 会绕过新 Structure 语义，本修复没有这样做。
- `utilitySprite('wooden-door')` 已存在正确的门轮廓，但 `progressionItemAssets` 未注册它，完整 catalog 因而错误进入普通 voxel/material 推导并严格失败。
- `asset-progression-sources.ts` 现在通过现有 `pixelItemAssets` 注册 `builtin:texture:wooden-door:detail` 与 `builtin:model:wooden-door`。`asset-catalog.ts` 自动识别该显式 native model，原严格缺映射分支保持不变。
- `asset-adapters.ts` 只允许显式 `wooden-door` Structure block 在没有 `placesVoxel` 时使用像素挤出表现；未知 Structure block 仍拒绝，其他 block 规则不变。
- 世界启动前 `loadAppearanceRuntime()` 将空项目解析为完整 `builtinAssets` 并安装到 app；正式 `GameplayModelAssets.addItem('wooden-door')` 因此取得同一 resolved model/texture，生成一个非空 pixel mesh。

## RED

命令：

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/tests/unit/client/wooden-door-item-assets.test.ts --maxWorkers=1
```

结果：`1 failed file`、`0 tests collected`，模块加载在 `asset-catalog.ts:236` 精确抛出：

```text
Error: Missing builtin item material mapping: wooden-door
```

## GREEN

完整 door/catalog 集合：

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/tests/unit/client/wooden-door-item-assets.test.ts apps/web/tests/unit/client/asset-workbench.test.ts apps/web/tests/unit/client/visual-asset-catalog.test.ts apps/web/tests/unit/client/appearance-catalog.test.ts apps/web/tests/unit/client/wood-sword-assets.test.ts --maxWorkers=1
```

结果：`5 passed files`、`15 passed tests`。覆盖完整 catalog import、全部物品/引用闭包、door binding、与 `utilitySprite('wooden-door')` 同源的 32×32 非空像素、SVG icon、`resolvePixelModel`、`buildToolMesh` 以及未知 Structure block 拒绝。

正式 Gameplay item presentation consumer：

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/tests/unit/app/gameplay-model-assets.test.ts --maxWorkers=1 -t 'Structure 木门通过显式像素资产进入正式物品渲染器'
```

结果：`1 passed | 8 skipped`。`GameplayModelAssets.addItem('wooden-door')` 实际创建一个 render child、一个 mesh instance，positions 非空且 indices 大于 36。

静态与 SSG：

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec tsc -p tsconfig.test.json --noEmit
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm --filter @seedlands/web typecheck
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec eslint apps/web/src/client/presentation/asset-progression-sources.ts apps/web/src/client/presentation/asset-adapters.ts apps/web/tests/unit/client/wooden-door-item-assets.test.ts apps/web/tests/unit/client/asset-workbench.test.ts apps/web/tests/unit/app/gameplay-model-assets.test.ts
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec prettier --check apps/web/src/client/presentation/asset-progression-sources.ts apps/web/src/client/presentation/asset-adapters.ts apps/web/tests/unit/client/wooden-door-item-assets.test.ts apps/web/tests/unit/client/asset-workbench.test.ts apps/web/tests/unit/app/gameplay-model-assets.test.ts changes/2026-09-23-classic-functional-completion/asset-door-closure-contract.md
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm --filter @seedlands/web ssg:check
```

结果：全部 PASS；`svelte-check found 0 errors and 0 warnings`；`ssg:check` 不再抛 door 缺映射。

## 外域基线失败

完整运行 `gameplay-model-assets.test.ts` 时，新增门用例已通过，但同文件既有 `addBox 按模型私有绑定读取当前 runtime 材质` 失败。隔离复跑该标题仍稳定失败：期望 `custom:grazer-fur`，实际 `seedlands:texture/model/fur`，位置约 `gameplay-model-assets.test.ts:435`。`appearance-runtime.ts` 和 `gameplay-model-assets.ts` 无本阶段 diff，该失败不在 door asset 闭包路径，本阶段未越权修改。

## 文件身份

- `41f33a9084837a2be301dcd3c3f407f5ce66a42b710736afc19368247c0e7b7d` `apps/web/src/client/presentation/asset-progression-sources.ts`
- `dae8db40fb2ae4c62e14c2034084b5e14662ae4dc21c033834e518b595f6d885` `apps/web/src/client/presentation/asset-adapters.ts`
- `07a19a1e89cebd4affd01afd85bcbfecfcdfbade7742b50985169e20e221d41d` `apps/web/tests/unit/client/wooden-door-item-assets.test.ts`
- `c8d8f094cc2e0962f442cf5475e99c076817fbf438140862e20ae61d9b32024a` `apps/web/tests/unit/client/asset-workbench.test.ts`
- `7cd7325d385e84065398a69ad323e627886b1822e825fd4a98174b43d93fe2f7` `apps/web/tests/unit/app/gameplay-model-assets.test.ts`
- `8dc88d19def9c90fc0607216381fcbfc4e7c96b622a2d37138b0ce4b50a0b346` `changes/2026-09-23-classic-functional-completion/asset-door-closure-contract.md`

保护性未修改身份：

- `3ddbc52829e573b98c42be5b5dcf9e5f0d1d481d89f861016113553587ee867c` `apps/web/src/client/presentation/asset-catalog.ts`
- `11c68080ac6b966e4143c22aab8f63bfd36281c5916388a3d75a9b0a56868db1` `apps/web/src/client/presentation/utility-sprite.ts`

## 未执行

- 按授权未运行完整 build、浏览器、dev server、CI、Git commit/push 或部署。
- 只运行现有 `ssg:check` 验证原 clean build 阻塞；后续干净完整 build 由 954 在提交新 SHA 后执行。
