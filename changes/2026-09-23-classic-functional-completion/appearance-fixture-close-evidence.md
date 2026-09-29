# Appearance 退休夹具收口证据

状态：测试夹具修正完成，production未修改。

## 归因

- 历史 RED 来自 761 对完整 `gameplay-model-assets.test.ts` 的运行，本任务没有把该 RED 伪报为本轮重跑。失败为“addBox 按模型私有绑定读取当前 runtime 材质”，期望 `custom:grazer-fur`，实际为内置 `seedlands:texture/model/fur`。
- 用例由 `f47c44fc58a04954372b71df129d9fa6bbc64e9e` 引入，当时 `grazer` 是 box actor。`6b82a5d264d148acd1eaafabc5a15663c3cb1d8b` 退休 `grazer/stalker/settler`，并在 `validateAppearanceProject()` 中显式忽略这些旧模型的材质绑定；旧测试未同步迁移。
- 当前 `GameplayModelAssets.materialAssets()` 仍把 `modelId` 传给 `getAppearanceResources()`。旧 grazer输入中，raw `hasAppearanceBinding()` 为 true，但校验后的 project按兼容规则删除退休 binding，因此回落内置 fur。不是 production context丢失。

## 修正

只修改原测试的语义夹具：

- 模型从已退休 `seedlands:model/actor/grazer` 改为现役 box model `seedlands:model/actor/player`。
- slot从 `seedlands:material/model/fur` / `fur` 改为 player正式声明的 `seedlands:material/model/cloth` / `cloth`。
- 自定义 texture/material改名为 player cloth，保留严格 `diffuseMap.name === custom texture id` 断言。
- 761 新增的 Structure木门正式 consumer测试及其断言均未修改。

木门、`record-13`、`record-cat` 当前是 extruded-pixel item，走 `addItem → toolAssets → createPixelMesh`；现役 Classic creatures走 GLB。该退休夹具失败不构成这些旅程的运行时失败证据。

## 验证

所有命令分别经默认 `benchmark-window` 全机锁执行。

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm --filter @seedlands/web test apps/web/tests/unit/app/gameplay-model-assets.test.ts --maxWorkers=1
```

结果：完整文件 `1 file / 9 tests PASS`，包含现役 player private binding与木门 consumer。

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec tsc -p tsconfig.test.json --noEmit
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec eslint apps/web/tests/unit/app/gameplay-model-assets.test.ts
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec prettier --check apps/web/tests/unit/app/gameplay-model-assets.test.ts
```

结果：全部 PASS。未运行 build、browser、CI或Git写入。

## 文件 Manifest

```text
511b7674e8300670791a0ee0546be0aaa7e88efc33de529615596b906bf072b7  apps/web/tests/unit/app/gameplay-model-assets.test.ts
```

本 evidence 自身 SHA-256 在最终格式检查后单独回报。
