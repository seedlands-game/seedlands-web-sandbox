# 实体与第一人称模型设计

## 目标

用可复用的低多边形网格替换平面 SVG 手和胶囊/球拼装实体。模型保持 Seedlands 的暖色体素语言：硬边体积、少量清晰的色块纹理、可见的脸与装备；不使用任何第三方游戏资产。

## 共享定义

`src/client/gameplay-model-definition.ts` 是物品和角色视觉语义的纯数据来源。掉落物与第一人称持握物均由同一 `itemVisualKind()` 决定：方块使用六面材质定义；灯笼、浆果、木斧、石镐和木板有单独的体积组合。PlayCanvas 层只消费该定义，不保存第二份物品分类。

## 实体轮廓与动画

- 林鹿：长方体躯干、短颈与方形口鼻、耳朵、四条分节腿和浅色胸斑。
- 夜行兽：深青灰三节身躯、前倾头部、发光琥珀眼、背棘与四条爪腿；不用紫色胶囊。
- 营地居民：方形头脸、头发和鼻子、青绿色布衣、皮带、背包、手臂和靴子。
- 四足动物的腿、居民的肩和手臂均有独立 pivot；Presenter 每帧只更新既有节点的局部旋转。第一人称手臂的肩、肘、腕同样是层级 pivot，挥击绕肩/肘旋转。

## 材质、资源与生命周期

模型资源由 `GameplayModelAssets` 每个 `pc.Application` 创建一次；所有实体和 viewmodel 共享 StandardMaterial 与小型 Canvas 像素贴图。各模型实例仅新建 Entity/Render Component，绝不在 reconcile/动画循环中创建材质或贴图。`dispose()` 销毁根节点和该资源包持有的纹理/材质。

## 可测预期（RED）

`tests/client/gameplay-model-definition.test.ts` 在实现前应失败，随后验证：

1. 每一种可携带物品都解析为一个明确且可共享的视觉类型；方块含六个面定义。
2. 三种 actor 原型各自有非空轮廓、面部与至少一个关节标签，夜行兽的主色不是旧紫色。
3. 采集 pose 在动作时间内给出非零肩/肘摆角，静止时归零。

## 接线接口（供主流程使用）

```ts
const viewmodel = new FirstPersonViewmodel(app, camera);
viewmodel.setHeldItem(itemIdOrNull);
viewmodel.setAction('idle' | 'mine' | 'attack' | 'place' | 'eat');
viewmodel.update(seconds);
viewmodel.dispose();
```

`GameplayEntityPresenter` 继续由 `BrowserGameplay` 构造并管理；其构造函数兼容原参数。主流程只需在实际交互和选中快捷栏变化时调用上面的 viewmodel 方法，并移除 `player-action-presentation.svelte` 的 SVG 视觉层。

## 本子任务验证

- RED：`pnpm vitest run tests/client/gameplay-model-definition.test.ts` 因模型定义模块不存在失败。
- GREEN：同一命令通过 3 项纯数据与关节 pose 断言。
- 静态：`pnpm tsc --noEmit` 与本子任务文件的 `pnpm eslint ...` 通过；`git diff --check` 无空白错误。
- 渲染：隔离的 4262 生产模块预览已人工检查正面和侧面。林鹿有耳、口鼻、胸斑与四腿；夜行兽为深青灰分节身躯、背棘、爪腿和琥珀眼；居民有脸、头发、布衣、背包和靴子。木斧、石镐和原木均有实际厚度、木纹/石纹，手腕节点覆盖在握柄处；原木上下面使用端面纹理。
- 仍待主流程把 viewmodel 接至实际相机/快捷栏/交互事件，并在本 change 的 Playwright/Midscene 中采集真实模型截图。

## 主线集成复核

主agent在最终截图发现有工具而无手，定位到 `setHeldItem()` 把新挂到 held 的手和袖口一起销毁。已增加独立可替换物件子节点，手/袖生命周期独立。`tests/app/first-person-viewmodel.test.ts` 实际Entity树验证切换木斧→石镐→空手仍保留手/袖并清理旧物件，先RED后GREEN。袖口上沿与手掌下沿连接，避免悬浮手。先前无手截图不是准出证据；最终由主线重截。

最终实物帧补充：灯笼提把只有悬空横条，且外框坐标未随物件缩放。先记录语义 RED：落地灯笼的提把须以两侧支杆连接上沿，不可分离漂浮。修订仅为模型构件位置/比例，按 Static/Build 与最终正侧面 Midscene 确认。

缩略图语义补充：`dirt-block` 的顶面应为泥土材质；先前掉落/背包图错误复用了草叶顶面而看似草方块。修订后仅 `wood-block` 保留独立木材端面，泥土方块六面均为泥土。
