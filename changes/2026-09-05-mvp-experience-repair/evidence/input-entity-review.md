# 输入、采集与实体路径专项复核

## 结论

专项复核发现并修复 1 项 P1：浏览器攻击路径有体素遮挡限制，但服务端权威攻击接口原先没有复核视线，因此直接命令可隔墙伤害实体。连续采集及其中断、掉落物重复拾取、掉落物穿墙吸附、第一人称手模型生命周期未发现新的 P0/P1。

## 已修复 P1：服务端攻击接口信任客户端遮挡结果

### 证据

- `BrowserGameplay.attackTarget()` 先取得相机射线上的实体命中距离；`PlayerController.continueMining()` 将首个 solid 体素距离作为实体射线的 `maxDistance`，所以正常鼠标路径不会选到墙后的实体：`src/app/player-controller.ts:471-484`、`src/app/browser-gameplay.ts:196-218`。
- `GameplayRuntime.attackEntity()` 是实际修改生命值的权威入口，但只验证玩家存活、冷却、目标类型和三米距离，随后直接扣血；没有调用同模块已经使用的 `voxelRayIsClear()`：`src/server/gameplay/gameplay-runtime.ts:310-331`。
- 同一 runtime 的 `pickupItem()` 已在服务端复核距离和体素视线，说明现有架构具备权威遮挡检查：`src/server/gameplay/gameplay-runtime.ts:228-244`。

### 影响

Harness 命令、未来网络客户端或任何直接调用 `attackEntity(playerId, targetId)` 的路径可以绕过浏览器目标选择，在三米内隔着 solid 方块伤害 NPC/生物。客户端正确显示“被遮挡”不能保护服务端状态。

### RED、修复与 GREEN

`tests/server/survival-gameplay.test.ts` 新增三米内玩家、生物和两格高石墙。修改前攻击实际返回 `{ success: true, damage: 4 }`，与期望的 `blocked` 明确 RED。修复在服务端范围检查后复用 `voxelRayIsClear()`，从玩家眼位射向目标碰撞体内部中心；墙体命中返回 `blocked` 且不启动冷却，拆墙后攻击成功，紧接的攻击仍返回 `cooldown`，移远后仍返回 `out-of-range`。

Focused GREEN：`CI=true corepack pnpm exec vitest run tests/server/survival-gameplay.test.ts --no-file-parallelism --maxWorkers=1`，`11/11` 通过。相关 Prettier、ESLint 与 `git diff --check` 通过。

## 已核查且未发现 P0/P1 的路径

### 连续采集与中断

- `interactionBlocked` 只组合游戏暂停与 UI 输入阻挡，不再把昼夜时钟暂停当作游戏暂停：`src/app/player-controller.ts:75-82`。
- 左键按下设置 `miningHeld`，每帧重新使用统一 voxel target；目标变化会取消旧 break 后开始新目标。鼠标松开、失去 pointer lock、窗口 blur、释放输入、UI 阻挡与死亡路径均会停止或取消采集：`src/app/player-controller.ts:160-175`、`src/app/player-controller.ts:228-243`、`src/app/player-controller.ts:464-507`。
- 服务端每步复核目标 voxel 未变化且仍在五米内；失败时清除 break action，提交成功后先清除 action 再生成一次掉落：`src/server/gameplay/gameplay-runtime.ts:470-488`。
- change E2E 已覆盖一次按住连续采两块、松开停止，以及 inventory、pause、pointer-lock、death 四种中断：`changes/2026-09-05-mvp-experience-repair/e2e/continuous-mining.spec.ts`。

### 掉落物、拾取与墙体

- `pickupItem()` 在写背包前验证实体仍存在、类型、距离、视线和容量；成功后同步 despawn，再追加一次 pickup event。第二次调用会因实体不存在返回 `invalid-item`：`src/server/gameplay/gameplay-runtime.ts:228-244`。
- 自动拾取按玩家排序；每次查询当前 EntityStore，首个成功拾取已同步 despawn，后续玩家无法再次取得同一实体：`src/server/gameplay/gameplay-runtime.ts:490-503`。
- 掉落物吸附每个固定步都先检查当前位置到玩家的 `voxelRayIsClear()`，已有测试覆盖墙后不吸附、满背包和死亡玩家不消费、事件只发一次：`src/server/gameplay/entity-physics.ts:66-90`、`tests/server/dropped-item-physics.test.ts`。
- 掉落物初始水平速度为零，现有运动只有受视线约束的吸附与竖直重力；重力使用扫过的底面区间寻找最高 solid 顶面，避免大步向下穿透地面：`src/server/gameplay/entity-physics.ts:93-134`。未发现可复现的 P0/P1 穿墙路径。

### 第一人称模型与资源生命周期

- `FirstPersonViewmodel.setHeldItem()` 只销毁可替换物件容器的子节点，不销毁手、袖口或共享材质；相同 item id 不重复重建：`src/app/first-person-viewmodel.ts:53-59`。
- `dispose()` 先销毁整棵 viewmodel Entity，再释放共享 assets lease：`src/app/first-person-viewmodel.ts:77-80`。
- `BrowserGameplay.dispose()` 同步销毁实体 presenter 和 viewmodel；`Game.disposeRuntime()` 调用该入口并清空引用：`src/app/browser-gameplay.ts:296-299`、`src/app/game.ts:500-518`。
- 当前 `acquireGameplayModelAssets()` 每 lease 只递减一次引用，归零时统一销毁材质和纹理并从 WeakMap 删除；重复 release 有保护：`src/app/gameplay-model-assets.ts:221-246`。现有 viewmodel 测试覆盖切换工具、空手和 dispose 后不残留相机子节点。

## 次要观察

- entity hit volume 单测名称提到“体素遮挡”，实际纯函数只验证 AABB 射线和调用方传入的最大距离；真正遮挡来自 `PlayerController` 的 voxel target 距离组合。建议后续调整测试名称或增加组合测试，避免证据描述超过断言内容。
- EntityPhysics 的固定步上限为一次 600 步，能避免无限循环；十秒以上的大时间跳跃会丢弃超额积压。当前游戏帧与存档恢复路径没有显示这会造成 P1。
