# Classic v3 贴图与物品视觉证据

状态：S1 源码与静态校验完成；Browser 场景、缩略图输出和手持画面由主线程在 S3 验收，尚未执行。

## 范围与来源

- 生产源是 `terrain-assets.ts` 的 76 个 16×16 面材质与 `pixel-item-art.ts`、`utility-sprite.ts`、`food-sprite.ts` 的 32×32 可编辑像素源；未裁切概念图。
- `builtinItemBindings` 仍以 Classic item registry 为基准覆盖 194 项。放置方块继续从其实际 voxel 材质取图；树苗、花、蘑菇、甘蔗、枯灌木和红色变体改为独立透明物品像素源，不再把非整格图标当作 terrain swatch。
- 地形图案按土壤/颗粒、石材、木纹与年轮、砌体、矿脉、功能面、轨道、南瓜和 cutout 植物分族绘制。色板按确认的 Classic v3 方向保留暖木、自然草绿、冷灰石和可辨识强调色。

## 定向结果

- 8 种植物面材质（树苗、高草、花、蘑菇、甘蔗、枯灌木、红花、红蘑菇）均有零 alpha 轮廓且非透明像素少于 180/256；材质声明为 `cutout`，与 flora worker 的双交叉双面网格合同相配。
- 空桶、水桶、奶桶和熔岩桶各有独立 32px 源；皮革不再复用生猪排；曲奇、金苹果、蘑菇煲各有独立轮廓。
- 16 色羊毛各有独立 detail texture、三阶颜色 ramp 和 item binding。Classic 目前没有已确认的“彩色羊毛放置 voxel state”，因此世界中仍只有既有 `FaceMaterial.Wool`；未擅自扩张状态/mesher 合同。
- 视觉目录只保留 player 的 builtin actor model，并基于 `classicCreatureDefinitions` 注册 12 个 GLB 模型条目；GLB 文件/动画本身由 Astra worker 负责。

## 自动证据

- RED：定向 `visual-asset-catalog` 断言在修改前失败，失败值为植物非透明像素 `188 >= 180`，证明原贴图是孔洞噪点而非透明轮廓。
- GREEN：`pnpm --filter @seedlands/web test apps/web/tests/unit/client/visual-asset-catalog.test.ts --run` 通过（2 tests）。
- 静态：`pnpm --filter @seedlands/web typecheck` 在性能窗口预约下通过；受影响文件经 Prettier 和 ESLint 通过。

## 生产缩略图复核后的色板纠正

- 问题：主线程重建全量缩略图后，`flower.png` 显示为棕色花与蓝灰茎。根因是新增的植物、桶内容和食物复用了工具/铁材质的索引色板：索引 `16` 是皮革棕，`8` 是蓝灰，`18` 是青蓝。
- 纠正：`item-semantic-palette.ts` 仅为有机物、液体桶和食物派生语义色板，保持工具与护甲继续使用原有共享色板。红花/红菇使用红色 `#be3430`，茎和甘蔗使用自然绿色，水桶使用蓝阶，熔岩桶使用红橙黄阶，奶桶使用暖白阶；曲奇、金苹果、蘑菇煲和皮革也随其真实材质着色。
- 复测：新增定向断言检查红/绿植物、水/熔岩桶、金苹果及木镐原色板。`visual-asset-catalog` 通过 3 tests；受影响源已通过 ESLint。缩略图重建与目视读回由主线程统一执行。

## 库存截图定向审阅

- 输入：`playwright-report/data/378cda557364fb9dec44d336b1dafd623f136f5f.png`。确认红石粉仍呈棕色，指南针只有单色竖线；钟表盘能辨识但指针太弱，画作是空棕色矩形。
- 纠正：红石粉接入红/橙色阶；指南针增加红蓝双针和中心铆钉；钟增加红针、金色轴心；画作绘制木框、蓝天、绿地、树和太阳；可可豆改为三颗有高光的豆形，替代通用圆团。
- 不改项：截图中的纸、地图、金苹果、蘑菇煲、门和告示牌轮廓已可辨。后续由主线程统一重建缩略图并目视读回。
- 复测：扩展断言覆盖色板和红石/指南针/时钟/画作/可可豆结构；`visual-asset-catalog` 通过 4 tests，受影响源通过 Prettier 与 ESLint。

## 未验证

未启动开发服务或 Browser。尚缺库存、创造目录、地面掉落、第一人称持握及白天/夜间的实际画面；自动像素断言不替代这些验收。
