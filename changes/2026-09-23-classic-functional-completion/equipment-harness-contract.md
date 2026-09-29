# V2 Equipment Harness Oracle 合同

阶段：`V2-EQUIPMENT-HARNESS-ORACLE-01`
状态：接口冻结；行为 RED 待执行。

## Owner 与接口

- Web `BrowserProductHarness` 新增唯一只读入口 `equipmentSnapshot(): HarnessEquipmentSnapshot | null`。类型定义在
  `apps/web/src/app/app-contracts.ts`，只复用公开 `AuthorityInventoryView` 与 `AuthorityGameplayView` 字段，不新增协议、
  权威 owner、动作或持久化字段。
- 固定字段为：`runtimeEpoch`、`gameplayRevision`、`actor`、`inventoryRevision`、`slots`、`armor`、`cursor`、
  `player.health/lifecycle`、`armorPoints`。Authority 未提供 armorPoints 时显式返回 `null`，不伪装为 0。
- 四个 armor slot 由通用 Authority inventory projection 提供；Harness 不识别 Classic item ID，不从 checkpoint、DOM、
  HUD 或本地 UI 状态重建装备。非 Classic world 只要提供同一 Authority 投影即可消费该 oracle。

## 同轮新鲜度与复制

- 每次调用先取得当前 `BrowserAuthorityClient`。无 client、`isReady=false` 或空 `runtimeEpoch` 时返回 `null`，避免访问
  尚未就绪时会抛错的 `gameplay` getter；不使用广域 `catch` 吞掉真实内部错误。
- 固定同一 client、runtimeEpoch 和同一个 gameplay 对象后，只从该对象复制所有字段。完成复制后重新确认
  `bindings.authority()` 仍是同一 client、client 仍 ready、runtimeEpoch 未变且 `client.gameplay` 仍是同一对象；任一变化
  立即返回 `null`，不循环重试。
- actor reference、slots、每个 stack/instance、四槽 armor、cursor stack/origin（含 station reference）、craftingGrid 与
  player 子对象全部脱离源引用并递归冻结。旧 epoch 的已返回对象可由测试持有；下一次调用必须读取当前 client/epoch/
  gameplay，不能返回缓存旧世界。

## 失败、兼容与验收

- `null` 仅表示当前没有稳定可观察的 ready Authority snapshot；oracle 不触发重试、恢复、保存或 Authority action。
- 既有 geometry、rendered mesh 与 media observability API 行为保持不变，现有 4 个测试继续通过。
- RED 必须可收集且由临时 `equipmentSnapshot: () => null` 触发行为断言失败，不以缺失 import/类型失败代替。GREEN 覆盖
  mutable source 脱别名、递归冻结、四槽 durability、station cursor origin、missing/not-ready/empty epoch、同轮 client/
  epoch/gameplay 替换 fail closed，以及新 epoch 新数据。
- 最终运行目标 unit tests、Web/Svelte types、root/Classic test types、精确 ESLint、可编辑文件 Prettier 与 scoped diff。
  不运行 build、Browser、Cua、CI、Git 或部署；oracle GREEN 不等于真实装备旅程 GREEN。

## 预算与文档

- 传统工程量 `0.5-1 PD`；AI 连续墙钟预计 `2-3h`，120% 保守预算 `3.6h`，硬上限 `4h`。
- credits、API 等价费用、费率、当前额度分母及占比均为 `unknown`。
- 长期 docs 不更新：本片没有改变 Authority/Web/Harness owner 边界，只为已冻结装备投影增加当前 change 的只读验收
  观察口。
