# Browser 旧 Gameplay 来源判定

状态：只读调查完成。当前 Browser 持久化没有足够可信的来源数据，把无内嵌 composition 的 Gameplay V1–V3 唯一绑定到某个历史 Classic Pack graph。不能按数据库版本、Gameplay schema、generatorVersion、worldId、时间或 `legacyMigrated` 猜测来源。

## 安全支持边界

1. **Gameplay V4**：snapshot 可携带完整 `composition`（`packages/stdlib/src/server/gameplay/gameplay-snapshot.ts:69-85`）。只有内嵌 identity 精确等于当前 composition 或 Classic 明确声明的有界 predecessor时才恢复。
2. **Gameplay V1–V3 + 可信宿主声明**：V1–V3没有内嵌 composition（同文件 `:42-68`）。仅当宿主从不可歧义的迁移账本取得完整 `CompositionCheckpointIdentity`，且精确命中当前 Pack声明的 predecessor时，才能传入 `legacyCompositionIdentity`。
3. **现存 Browser IndexedDB 无标记 V1–V3**：来源不可证明，必须拒绝且保留原 record/chunks；不能默认它属于 Classic captured `e3c1…/924d…` lineage。
4. **旧 localStorage Chunk导入**：只迁移地形 Chunk和玩家位置，不迁移 Gameplay snapshot；可继续按 seed/generator/voxel规则校验，但不能产生 Gameplay lineage。
5. **用户导入 application checkpoint**：V4读取 world snapshot内嵌 composition。V1–V3即使文件 hash自洽，也只证明文件内部一致，不能证明由哪个受信任发布生成。

仓库内没有证据证明所有真实 Browser V1–V3 record都属于同一个 Classic graph。真实用户记录数量未知，但不影响上述 fail-closed结论。

## IndexedDB 实际合同

`PersistenceWorldRecord` 位于 `apps/web/src/worker/persistence-worker-protocol.ts:88-100`，字段只有：

```text
worldId, seedText, generatorVersion, provider, player, gameplaySnapshot?,
corpusSummary?, legacyMigrated?, updatedAt, commitSequence?, worldRevision?
```

它没有 record schema version、创建 build/source SHA、Pack manifest/entry digest、composition identity或已执行 Gameplay migration ID。

- `apps/web/src/worker/persistence-indexeddb.ts:14-24` 始终执行 `indexedDB.open(databaseName, 1)`；upgrade只创建 `worlds` 与 `chunks` stores，没有行级 schema迁移或来源盖章。
- `apps/web/src/worker/persistence-worker.ts:106-140` 只在 world不存在时写 `seedText/generatorVersion/provider/player/updatedAt`；已有 record直接读取。
- `save-metadata`、`save-gameplay` 和 `mark-legacy-migrated` 都会更新 `updatedAt`（同文件 `:226-300`），所以它不是创建时间。
- `legacyMigrated` 只表示外部旧 Chunk JSON已经写入并逐 Chunk读回（`apps/web/src/client/persistence/browser-chunk-persistence.ts:124-145`），与 Gameplay schema或Pack无关。
- `worldId` 在 `apps/web/src/worker/persistence-worldgen-initialize.ts:24-26` 由 `generatorVersion + seed`派生，不含 Pack identity。
- `provider` 只在同文件 `:31-38` 校验 worldgen；Classic provider的 `artifactIdentity` 是宽泛的 `seedlands:overworld@1.0.0`（`playbooks/classic/src/worldgen.ts:7-35`），不是 Pack manifest digest。
- world directory在 `apps/web/src/worker/persistence-world-directory.ts:11-28` 进一步只投影 `worldId/seedText/generatorVersion/updatedAt`，连 provider与Gameplay version都不提供给选择层。

## Browser Authority 链

`apps/web/src/worker/authority-worldgen-runtime.ts:35-57` 从调用 options中明确排除 `legacyCompositionIdentity`。`apps/web/src/worker/authority-worker.ts:169-213` 的实际启动顺序是：

1. 加载当前产品 Pack并组装当前 composition。
2. 以当前 worldgen identity打开 `seedlands-chunks-v1`。
3. 从 record读取 opaque `gameplaySnapshot`。
4. 用当前 composition创建 Authority runtime。

链路中没有把 record来源转换为 external gameplay identity的接缝。因此即使 Classic predecessor allowlist修好，真实 Browser V1–V3仍会因没有可信 `legacyCompositionIdentity` 而拒绝。

## 来源判定矩阵

| 候选信号                           | 能证明                                       | 不能证明                              | 结论                              |
| ---------------------------------- | -------------------------------------------- | ------------------------------------- | --------------------------------- |
| V4 `gameplay.composition`          | snapshot声明的完整 Pack lock与definition map | 文件最初来自哪个设备/用户             | 可按 current/精确 predecessor恢复 |
| 受信任版本账本的完整 identity      | 一个冻结历史 graph                           | 任意 Browser record都属于它           | 仅可信宿主可传入                  |
| Gameplay `version: 1/2/3`          | 数据布局；V3加入坐标/物理 schema             | Playbook、规则、资源、operation graph | 不可作 lineage                    |
| IndexedDB version `1`              | 两个 object stores存在                       | record创建发布或Pack graph            | 不可使用                          |
| `generatorVersion`                 | 地形算法代际                                 | Gameplay/Pack graph                   | 只用于 worldgen                   |
| `provider`                         | worldgen实现/config兼容                      | Gameplay modules和资源                | 只用于 worldgen                   |
| `worldId`                          | generatorVersion与seed                       | Pack或创建 build                      | 不可作 lineage                    |
| `updatedAt`                        | 最近一次相关写入时间                         | 创建时间或发布身份                    | 不可使用                          |
| `legacyMigrated`                   | 旧 Chunk导入已读回                           | Gameplay来源                          | 不可使用                          |
| `commitSequence/worldRevision`     | 世界提交 frontier                            | Pack graph                            | 不可使用                          |
| application checkpoint `createdAt` | 文件自报时间                                 | 受信任发布来源                        | 不可使用                          |
| `worldHash/pairHash`               | 文件内部完整性                               | 签名、发布者、Pack lineage            | V1–V3仍拒绝                       |

## 历史反证

有限 Git history证明同一 DB/schema/generator范围跨多个 Pack graph：

- `f7960ddf` 与 `ddffbcbb`（2026-09-08）已出现 Browser `gameplaySnapshot`、`legacyMigrated`及数据库 v1；此后数据库版本没有提升。
- `697c7ae2`（2026-09-11）加入/固定 worldgen provider与 captured checkpoint来源；provider仍不表达完整玩法 graph。
- `5a5f0a5e`（2026-09-16）保留 DB v1并引入组合架构；Gameplay V1–V4 schema已存在。
- generator `4` 下，`5a5f0a5e` 到 `d1e692ca` 已把 Classic inventory从默认布局改为显式 `36/9`，但 generatorVersion/worldId不变。
- generator `11` 下，`932eb13a`、`b08f500c`、`be0bde7e` 分别对应无Structure、Structure definition/geometry、Structure actions完整安装的不同 Pack graph，worldId仍只含 `g11 + seed`。
- `playbooks/classic/src/pack.ts` 在 `5a5f0a5e`、`d1e692ca`、`6b82a5d2`、`cb5d3efb`、`b08f500c`、`be0bde7e` 连续改变模块、能力、资源或definition identity，未同步产生可用于旧 record归因的DB世代。

因此，即使按 generator或时间范围筛选，也不能唯一映射到 captured composition。

## 导入与失败原子性

### 本地 IndexedDB 启动

- `BrowserChunkPersistence.open()` 在 `browser-chunk-persistence.ts:99-123` 读取 existing record；初始化失败会dispose persistence client并抛出。`persistence-worker.ts:118-127` 对existing record不执行 `put`。
- Gameplay restore在 `packages/stdlib/src/server/game-server-gameplay-host.ts:438-456` 用候选 runtime完整校验，失败只dispose候选，不替换active gameplay。启动失败前也没有Gameplay save。
- `ShellController.start()` 在 `apps/web/src/client/shell/shell-controller.ts:42-52` 回到菜单并保存具体异常；`start-screen.svelte:199-203` 以 alert显示。

所以未知 V1–V3 当前会 fail-closed，且这次失败不会覆盖原 IndexedDB record/chunks。但 UI只显示内部英文错误，例如 `Legacy gameplay composition identity is unavailable.`，没有明确告诉玩家“原存档未修改”或给出安全下一步，产品提示不充分。

### Application checkpoint 导入

- `apps/web/src/client/persistence/application-checkpoint.ts:47-142` 校验格式、worldHash、pairHash、worldId与可选 cognition配对；没有发布签名或 Gameplay provenance。`createdAt` 是导出时生成并参与hash的字符串，不是可信发行身份。
- `apps/web/src/worker/authority-worker.ts:108-149` 先把输入放入 `MemoryGamePersistence`并创建候选 runtime；只有候选全部通过后才调用 `currentPersistence.replaceFrozenSnapshot(snapshot)`。因此失败不会覆盖当前 IndexedDB世界。
- `apps/web/src/app/gameplay/companion/companion-session.ts:427-470` 对普通 `result.ok === false` 明确报“原世界保持不变”，但 thrown identity error会进入通用 catch；英文异常被 `:206-220` 压成“操作暂未完成，请稍后再试。”，来源不兼容和原世界保留都不清楚。

## 推荐的最小产品修复

不放宽来源，实施以下最小闭环：

1. **为未来记录持久化来源。** 给 `PersistenceWorldRecord` 增加有界、冻结的 `gameplayProvenance`，至少包含 provenance schema version与完整 `CompositionCheckpointIdentity`；保存 Gameplay/frozen snapshot时在同一个 `worlds` transaction同步写入。
2. **只传入验证后的来源。** `BrowserChunkPersistence.open()` 返回经严格shape/size校验的 provenance；`authority-worker.ts` 仅在 Gameplay V1–V3且 identity精确命中当前 Pack声明的 predecessor时传给 `createBrowserAuthorityRuntime`。V4只信内嵌 composition。
3. **现存无标记记录不回填。** V1–V3缺 provenance时返回 typed `LEGACY_GAMEPLAY_PROVENANCE_UNKNOWN`；保留 record/chunks并继续在世界列表展示，提供“保留旧档并创建同 Seed当前版本”的路径，不自动删除或覆盖。
4. **导入文件不自证。** application checkpoint V2 的 hash/createdAt不能给 V1–V3赋予来源。未来若要支持旧文件，必须新增带可信发布身份的格式或由版本专用、可审计的导入器选择冻结 predecessor；普通 V1–V3继续拒绝。
5. **给出明确中文错误。** 启动页与导入面板显示：“无法确认旧存档的玩法版本，未打开且未修改原存档。可保留旧档并创建当前版本世界。”不要暴露内部 guard文本。

该修复只保证今后写入 provenance 的记录可恢复，不能追溯证明当前已经无标记的旧 Browser记录。恢复这些存量记录需要另一个可信的一手来源；当前仓库没有，不能把这项缺口转嫁给用户提供文件或权限。

## 未验证项

- 未访问任何真实用户 IndexedDB或个人存档，线上 V1–V3 record数量与实际字段分布未知。
- 未运行 test、build、browser或GUI；失败提示可见性来自静态调用链，不是视觉验收。
- 未审计外部部署日志、旧 production artifact或服务端备份；仓库内没有它们与Browser record的可靠关联。
- 本文不决定是否退休旧 lineage，也不修改现有兼容承诺；只给出当前证据允许的安全产品边界。
