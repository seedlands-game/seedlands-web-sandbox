# Gameplay 存档 V3 迁移记录

## 代码事实

- V1/V2 玩家实体位置由旧 `BrowserGameplay` 写入相机位置；旧碰撞以 `position.y - 1.6` 取得脚底，因此玩家实体位置和 `PlayerSnapshot.spawnPosition` 都是眼睛坐标。
- V1/V2 掉落物的旧重力使用 `ITEM_HALF_HEIGHT = 0.2` 作为 `bottomOffset`，落地位置为碰撞体中心；新 `world-item` 身体注册表以脚底为原点，高度为 0.4。
- 旧 actor 重力的 `bottomOffset = 0`，其位置已经是脚底坐标，不应迁移。

## RED 设计

- 新创建的快照必须为 V3，并声明脚底中心坐标 schema 与物理/身体注册表版本。
- V1/V2 玩家实体和出生点各减 1.6，世界物品减 0.2，actor 不变；迁移不得修改输入对象。
- 合法 V3 往返不二次迁移，速度、simulation、库存与需求状态保持。
- 不支持的 schema 和非有限位置必须在应用前原子拒绝，现有运行态保持不变。

## 当前状态

阶段：GameplayRuntime 范围实现与定向验证完成，等待主线接入 Facade。

首次 RED（2026-09-06）：5 个用例全部失败；新快照仍为 V2、V1/V2 坐标未迁移、V3 schema 不存在。代表性结果：

```text
Expected version: 3, received version: 2
Expected player [1, 38.4, -2], received [1, 40, -2]
```

## GREEN 证据

- `tests/server/gameplay-snapshot-migration.test.ts` 覆盖新写 V3、V1/V2 一次迁移、迁移后 V3 再载入不二次迁移、V3 完整往返、旧独立玩家位置适配，以及无效 schema/非有限坐标的原子拒绝。
- 相关 Vitest：4 个文件、23 个用例全部通过，包括命令持久化、simulation 持久化和掉落物物理回归。
- 所属文件 Prettier、ESLint、`tsc --noEmit` 与 `git diff --check` 全部通过。
- 生产构建已执行，但被其他并行任务尚未收口的测试类型错误阻塞：`browser-authority-client.test.ts`、`compute-task-queue.test.ts`、`compute-worker-task.test.ts`。构建输出没有指向本迁移拥有的文件。

## 主线接入事项

- `GameplayRuntime.createSnapshot()` 现只返回 `GameplaySnapshotV3`；`restoreSnapshot()` 返回版本联合扩展为 `1 | 2 | 3`。
- `legacyPlayerPositionToFeet()` 是最早期独立玩家位置记录的统一迁移入口；Facade 载入旧 `position` 时应调用它。
- `src/server/game-server-gameplay.ts` 的 `restoredVersion` 消费类型需由主线扩展为包含 V3；该文件不在本任务所有权内。
- 没有读取、修改或覆写任何真实用户存档；测试仅使用内存构造的合成 V1/V2/V3 数据。
