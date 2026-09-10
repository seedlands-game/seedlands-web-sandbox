# S3d 角色模式组件与安全切换证据

## 结果

- 玩家与 NPC 通过同一个 ECS actor component owner 持有模式状态，没有新建平行 PlayerState/自治状态 owner。
- 新增三个独立的 version 1 facet：`mode`、`creativeCatalog`、`flight`。新 checkpoint 始终写出三者；旧 V1/V2/V3 玩家状态和旧 V4 actor checkpoint 三者全部缺失时显式迁移为 survival、空创造快捷引用、关闭飞行、revision 0。只缺其中一部分视为损坏数据并原子拒绝。
- 创造快捷栏只保存每世界物品目录 ID 引用和独立 selected slot，不含数量，也不读写 survival Inventory 或 survival selected slot。
- survival→creative 在提交前验证全部目录引用；creative→survival 在任何取消或状态写入前取得宿主验证的安全落点。无落点会返回 `no-safe-landing`，组件、位置、身份、取消计数和 changed 回调均不变。
- 成功切换同步更新 mode、flight、位置和各自 revision；EntityStore 更新保留原 entity epoch/lifetime reference。

## 集成 API

```ts
new ModeRuntime({
  entities: EntityStore,
  findSafeLanding(actorId, currentPosition): [number, number, number] | null,
  cancelIncompatibleActions(actorId, 'mode-changed'): void,
  changed(actorId): void,
});

modeRuntime.switchMode(
  actorId,
  | { mode: 'creative'; creativeHotbar; selectedCreativeSlot?; flightEnabled? }
  | { mode: 'survival' },
);
modeRuntime.setCreativeCatalog(actorId, hotbar, selectedSlot?);
modeRuntime.setFlight(actorId, enabled);
modeRuntime.stateFor(actorId);
```

`ActorComponentAccess` 新增只读 `mode`、`modeRevision`、`creativeCatalog`、`flight`，以及供 core mode owner 使用的 `replaceModeComponents`。`PlayerState.snapshot()` 始终投影这三个 facet，但类型保持可选，使旧存档和 fixture 可读取。

根任务应在 `GameplayRuntime` 内构造一个 `ModeRuntime`，把安全落点接到物理验证器，把取消接到 Action/Combat/破坏动作 owner，把 changed 接到 gameplay revision。对玩家可调用的入口必须继续由 registered operation/authority 做授权，不能直接暴露 `ModeRuntime`。

## RED 与 GREEN

- RED：先新增 `tests/server/actor-mode-runtime.test.ts`；首次运行因 `gameplay/modules/mode-runtime` 不存在而失败，0 项测试加载。
- 新测试：1 个文件、6 项通过，覆盖玩家/NPC 共用组件、survival inventory/slot 完整保留、安全落脚拒绝原子性、成功落脚与身份稳定、旧 facet 默认迁移、部分 facet 原子拒绝、V4 roundtrip、独立世界 registry、创造快捷引用和飞行限制。
- 扩展回归：actor mode、actor components、ECS component snapshot、V1-V4 gameplay migration、entity/player、per-world content、inventory interaction 共 7 个文件、44 项通过。
- owned ESLint 通过；`pnpm --filter @seedlands/game-core typecheck` 与 `pnpm exec tsc -p tsconfig.test.json --noEmit` 通过；`git diff --check` 通过。

## 未完成边界

- 本切片没有 GameplayRuntime、composition、GameServer、命令、observation 或浏览器接线，不声明 S3d 完成。
- 没有实现创造模式的伤害/饥饿关闭、无限目录放置、即时编辑、飞行物理或 UI；这些需要根任务和对应 owner 通过模式读取进行规则接线。
- 未运行完整 static/build 或浏览器验收。
