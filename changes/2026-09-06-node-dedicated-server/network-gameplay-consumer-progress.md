# Gameplay 消费者 v2 参考进度

## 当前状态

已完成独立 `gameplay-consumer-reference` v2 投影、真实 Host 三阶段语料与定向验证。该结果只证明当前权威输出可以被最小 allowlist 投影和可复现记录；wire、codec、网络传输与浏览器客户端适配均未采用。

## RED → GREEN

- RED：`network-gameplay-consumer-corpus.test.ts` 先导入不存在的 change-local recorder，Node 22 收集阶段报缺少 `./support/network-gameplay-consumer-corpus-recorder`，没有误把手写 JSON 当作采集完成。
- RED：投影单元先暴露 sparse actor、重复 entity id、双方缺 archetype 三项未拒绝；补充五类边界后，Node 22 定向 `18/18` GREEN。
- GREEN：真实 Host 以 starter ecology、现有 local-developer fixture-admin 的 world item/creature/actor 扩容、同一 `MemoryGamePersistence` 保存恢复三阶段各发布 correction、pose、consumer，共 9 条，写入 `/tmp/seedlands-network-gameplay-consumer-corpus-v2`。
- 验证同时重算每条 content hash、frames index、manifest payload hash、corpus hash 与 provenance binding；磁盘解析内容与写入前内存对象 `deepStrictEqual`。存在的旧 `/tmp` 语料文件在前后按 SHA-256 比较不变；缺失的历史临时文件不构成失败。

## 字段与边界

`actorBehaviors` 只含 `(entityId, behavior)` 八种公开行为，按代码单元排序，并逐项要求关联同一 Gameplay 中同 archetype 的 creature/npc。不会要求每个 creature/npc 都有 actor：现有 `spawn-creature` 可创建未注册 actor 的 creature。完整 `ActorState` 的 hunger、目标、POI、冷却、active 和 wander index 不进入 DTO。

v2 基础 Gameplay 字段复用 v1 的可信 Host 投影；v1 的 `entities.filter/map` 对畸形 sparse `entities` 的行为没有扩展为通用解码器。当前 Host 输出为稠密数组，本切片不把参考投影误作不可信网络 parser。产品 actor 保留上限仍为 512；现有 pose 预算仍为 256，三组实际 5/8/8 实体只是来源和恢复正确性证据，不是密度或性能曲线。codec/transport 的消息和聚合字节预算也未在本切片验证。

epoch、可靠 Gameplay revision、pose 迟到、删除后不复活、重生/传送 correction 合并属于后续真实客户端状态适配的 Given/When/Then，当前为 `NOT_COLLECTED`。不得以本语料或 reference DTO 深比较宣称客户端可玩、GUI 已显示或网络乱序已处理。

## 文件与后续

- `src/server/protocol/network-gameplay-consumer-reference.ts`
- `tests/server/network-gameplay-consumer-reference.test.ts`
- `e2e/support/network-gameplay-consumer-corpus-recorder.ts`
- `e2e/network-gameplay-consumer-corpus.test.ts`
- `e2e/vitest.gameplay-consumer-corpus.config.ts`

后续若采用 C0/C1/C2，需为 v2 的独立 kind 新增 schema/解析 RED-GREEN 和同一应用路径验证；真正客户端适配再实现 epoch、删除、重生/传送与 bounded pose cache，不能修改或重写本 generation 的历史证据。

## 统一准出与交付快照

完整静态检查通过：180 文件通过/2 跳过、960 项通过/4 跳过，world 行覆盖 96.37%；浏览器构建通过，既有大 chunk 提示保留。完整类型检查后，Node 五入口构建脚本也通过。首次静态检查仅因本计划格式退出，修正后完整重跑通过。机器结果、当前源码与语料 hash 见 [证据快照](network-gameplay-consumer-evidence.json)。

独立审阅由 Sol 完成，未发现生产阻断；源码仍只属于平台无关参考投影，没有新增运行入口，长期 docs baseline 不重复追加。当前 N0 切片保存阶段语义提交并推送功能分支；整个 Node change 仍 Active，codec v2、真实客户端与网络/performance 的后续门禁未被此快照替代。
