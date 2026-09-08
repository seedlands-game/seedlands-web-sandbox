# bitECS 0.4.0 有界准入记录

## 状态与证据边界

- 固定子任务合同：`contracts/ecs.json`；本轮核验 SHA-256 为 `c62e0fb5cfcf35334034fa724efa2984d020a4a73cd77439645bb3bcbcd30de5`。
- 已读取 `spec.md` 的 R1 与 `docs/playbook-roadmap.md` 第 6 节。采用理由限于实体生命周期、组件成员和组合查询；不把 ECS 当作存档或网络合同，也不作吞吐、GC、复制或帧时间收益宣称。
- 父任务对 npm 发布 tarball 做了完整性和静态来源核验：`bitecs@0.4.0`、MPL-2.0，dist integrity 为 `sha512-ho6Zop/L79DRTnBAfakPpGPuX7y0+lAjX06CpaAW+5tnAc7BH3L3RlSrWAXAqwnQGDZ10GsoxaxyTTsddlun3g==`；包无运行依赖，也没有 `preinstall`、`install`、`postinstall` 或 `prepare` 脚本；发布的 38,695 字符 core bundle 未命中 `node:`、`fetch`、`eval`、`new Function`、`window`、`document` 或 `process` 调用。
- 已发布 0.4.0 文档给出的待验证 API 是 `createWorld()`、`addEntity(world)`、`addComponent(world, eid, component)`、`query(world, terms)`、`removeEntity(world, eid)`、`commitRemovals(world)` 与 `entityExists(world, eid)`。0.4.0 的组件可以是调用方持有的 AoS 数组或 tag 对象；查询改为直接 `query`，`addComponent` 的参数顺序不同于 0.3.x。
- 以上发布源静态证据只支持候选包进入依赖解析门；最终依赖门未通过；在异步门禁返回前做过一次 createWorld/addEntity/addComponent/query 的 Node 包级烟测，但这不构成准入。未取得项目 TypeScript 编译或 EntityStore 行为证据，临时安装产物已清理。

## 依赖门禁结论

`pnpm --filter @seedlands/game-core add --save-exact bitecs@0.4.0` 在全图解析既有锁定依赖时失败：当前 registry 缺少 `devalue@5.9.2` manifest。保留基线并使用 frozen lockfile 的接入尝试又由 `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` 阻断。未修改 registry、minimum-release-age 策略或既有依赖版本，也未把已下载 tarball/临时包路径导入产品代码。

结论：发布包静态检查没有发现当前 core 纯逻辑边界的直接冲突，但项目依赖门未通过，bitECS 尚未准入。生产 `entity-store.ts`、`entity-components.ts` 和对应测试均保持未改；不得把本记录称为运行准入或 GREEN。

## 依赖恢复后的最小接入合同

1. `entity-components.ts` 只定义本次有消费者的具体组件：稳定身份、active 生命周期、位置、速度、物品堆叠、生命、actor 元数据以及四类实体 tag。每个 `EntityStore` 创建独立 world 和独立组件引用，AoS 内容按 eid 存入该实例的数组，避免两个 world 的相同 eid 共享数据。
2. `EntityStore` 保留稳定字符串 ID 到内部 eid 的双向映射；eid 不进入 `GameplayEntity`、snapshot 或空间桶。现有字符串自动编号与 `nextSequence` 语义不变。
3. `spawn` 经现有完整校验后一次建立实体和组件成员；`despawn` 先移出空间桶，再移除 ECS 实体、提交移除并清理所有 AoS 槽位和 ID 映射。重新创建同一稳定 ID 时，即使底层 eid 回收，也不得读到旧组件。
4. `get`、`query`、`queryNearby` 和 `exportSnapshot` 从组件 owner 投影新的防御性副本。`query({type})` 使用 `active + entity-type tag` 的组合查询；不得另外维护整实体 Map。查询结果按实例内 spawn ordinal 排序，不能把库的可回收 eid 顺序变成玩法优先级。
5. 空间桶继续只保存稳定字符串 ID；位置提交继续同步迁移桶。`update` 的字段顺序与既有部分提交语义保持不变：位置成功后速度校验失败时，位置和空间桶仍已更新。
6. `restore` 清空 world、组件槽位、双向映射、空间桶和查询指标后恢复快照；公开 snapshot 继续使用现有 `GameplayEntity[]` 和 `entitySequence`，不使用 bitECS serializer，也不持久化 eid。
7. 不迁 PlayerState、ActorState、combat、体素、每粒物品或无消费者的通用组件/schema 框架；不改变现有公开接口。

## RED / GREEN 实验设计

依赖门恢复后，先加入并单独运行以下 RED；确认失败原因是现有 Map owner 缺少 ECS 组件机制或新适配尚未实现，再写生产代码。

- `tests/server/entity-components.test.ts`
  - 两个 `EntityStore` 各自创建相同稳定 ID，但位置、生命与类型查询彼此独立。
  - player、world-item、creature、npc 形成不同组件组合；按四类现有 filter 查询只返回对应 tag 组合，投影中只出现该组合合法的数据。
  - despawn 后查询不再返回内部实体；随后用同一稳定 ID 重建不同类型，不能泄漏旧 stack、health、velocity、archetype 或 persistent 数据。
- `tests/server/entity-store.test.ts`
  - 自动 ID 在内部 eid 回收前后仍按现有字符串 sequence 递增；显式 ID 不改变 sequence。
  - `get`、`query`、`queryNearby` 与 spawn/update/move 返回值继续防御性复制；空间桶随位置同步更新。
  - 混合创建、移动、删除和 eid 回收后，全量与邻近查询顺序仍按 spawn ordinal 确定。
  - 非空 restore 后稳定 ID、组件组合、空间结果、快照内容与 `nextSequence` 等价；空 restore 后实体、桶、旧组件和查询计数全部为空。
  - 重复 ID、非法类型/位置/stack/health 的错误与不写入语义保持；复合 update 的既有部分提交顺序保持。
- 既有回归：`tests/server/data-plane-entity-store.test.ts`、`tests/server/entity-player-runtime.test.ts`、`tests/server/poi-perception.test.ts`、gameplay snapshot/migration 与 gameplay foundation 定向用例。

建议准出命令按顺序执行：

```sh
pnpm exec vitest run tests/server/entity-components.test.ts tests/server/entity-store.test.ts tests/server/data-plane-entity-store.test.ts tests/server/entity-player-runtime.test.ts tests/server/poi-perception.test.ts tests/server/gameplay-snapshot-migration.test.ts tests/server/gameplay-foundation.test.ts
pnpm --filter @seedlands/game-core typecheck
pnpm verify:static
pnpm build
pnpm build:server
```

GREEN 必须同时包含已发布包真实声明可编译、上述定向行为通过和既有 EntityStore/快照合同通过。依赖解析恢复本身不等于准入完成。
