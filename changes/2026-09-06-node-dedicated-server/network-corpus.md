# N0 网络语料合同

本文件固定 N2/N3 之前必须采集的**投影后**消息语料。它不包含真实用户内容、`.env`、证书、连接地址或远端数据。本轮只定义样本，未记录任何产品性能数据。

## 采集单位与共同元数据

每条记录以解码前后的同一 `messageId` 关联，至少记录：`schemaVersion`、`category`、`direction`、`reliability`、`stream`、`payloadBytes`、`envelopeBytes`、`compressedBytes`（若适用）、编码/解码/校验/应用耗时、分配/GC 观测、是否有效、拒绝原因和关联 run/source/config hash。网络实际字节、重传与拥塞数据只能由对应 transport 收集，不能用 JSON 字符数代替。

同一样本在 C0/C1/C2 中必须字段等价；首轮不量化坐标、不缩短 revision、不改变发送频率、不把服务端 diagnostics 混进样本。每个 corpus 条目保留固定 seed、投影器版本、内容 hash 与产生该条目的当前产品 SHA；未知/不可采集字段标记 `NOT_COLLECTED`。

## 必选样本组

| ID | DTO 投影 | 参数组 | 接收端必须验证 |
| --- | --- | --- |
| I1 | `InputStateDatagram` | 静止、单轴、对角、游泳上升/下潜；`inputSequence` 连续与跳号 | 数值范围、target tick 窗口、最新覆盖规则、过期丢弃。 |
| I2 | `InputEdge` | `jump-pressed` 正常、重复、乱序、已过期、跨 epoch | `edgeId` 幂等、可靠确认、不得因最新 input 覆盖而丢失。 |
| P1 | `PlayerCorrection` | 无待确认输入、少量待回放输入、`inputResyncRequired`、接触地面/水/阶梯 | ack、physics tick、body 有限值及完整 collision revision vector。 |
| P2 | `EntityPose` | 0、1、16、64、256 个可见实体；物品、creature、npc 混合 | 每实体 id/type/archetype 唯一，旧 pose 不能回滚插值缓存。 |
| G1 | 玩法 HUD/背包投影 | 满/空背包、可制作/不可制作、破坏进行中、死亡/重生 | `gameplayRevision` 单调、库存槽位上限、不可把 metrics 当 UI 数据。 |
| G2 | gameplay 可靠事件 | 拾取、攻击结果、制作结果、放置/破坏成功和失败 | request/transaction 幂等，关联 event revision，重复不重复扣库存。 |
| W1 | `ChunkBaseline` | 正常 canonical+fluid；最小/典型/最大兴趣区单 Chunk | key、revision、generatorVersion、精确 ArrayBuffer 长度与可选内容 hash。 |
| W2 | `ChunkDelta` | 单 cell、多 cell、fluid-only、连续多 revision | `previousRevision` 连续，cell index 范围；不连续时请求 W1。 |
| W3 | world commit 索引 | 无结构变化、单 Chunk、跨 Chunk、多个 commit 重排 | `worldCommitSequence` 和每 Chunk revision 的因果链，不以其它 stream 到达顺序推断。 |
| C1 | 控制与恢复 | welcome、能力协商、拒绝、关闭、fallback 新 epoch、全量 resync | session/world/player/version 一致；降级不放松认证或版本检查。 |
| M1 | 畸形与资源上限 | 未知 discriminator、截断、超长数组、非有限数、oversize datagram、解压炸弹标记 | 解码前预算，拒绝原因稳定，拒绝不污染缓存或队列。 |

## 语料生成与覆盖规则

1. W1/W2 只能调用当前产品的 `World.edit()`、现有 Chunk snapshot/Collision mirror 路径得到投影，不能手造另一套体素格式。
2. P1 的 collision revision vector 至少包含：完全可用、缺失一个基线、基线落后一版、已追平四种状态；它们用于验证“先基线后回放”的因果屏障。
3. P2 的实体集合必须有稳定排序规则，但显示端仍按 `poseSequence` 拒绝旧包；不可通过固定 sleep 宣称新鲜度。
4. 压缩只进入 W1/W2 的第二子组，并只使用 gzip 参考；I1/I2/P1/P2 不压缩。任何大于协商 datagram 上限的 payload 一律进入可靠 world stream，不分片伪装成可靠 datagram。
5. 每组另有合法、重复、乱序、丢失前序、跨 session 与预算超限至少一种异常输入。C0/C1/C2 需在同一异常 corpus 上给出等价的拒绝结果。
6. 语料文件的具体二进制快照、trace 与浏览器 run 产物留在 change 的运行证据位置，不提交 `dist/`、`node_modules/`、`midscene_run/` 或临时探针目录。

## 首轮规模与停止条件

首轮只取上表的代表性规模，不展开实体数 × Chunk 数 × RTT × 丢包率的笛卡尔积。N2 在固定 T0 下先完成 C0/C1/C2 的强等价和畸形输入；若任一候选无法完整应用 DTO、违反资源上限或不能说明额外复杂度，即停止该候选。N3 才固定 codec 后测试 T0/T1/T2，且每组都使用这里的相同 content hash。

本文件不含实测大小、延迟或性能结论。写入实际数字前必须同时记录 source SHA、投影器版本、codec/压缩设置、transport、浏览器/Node 版本与运行条件，避免把不同字段投影或不同负载的结果当作 transport 差异。
