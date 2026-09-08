# 真实实体规模语料：补充采集合同

## 目标与范围

补齐已批准 N2 中不同实体数的实际 pose/Gameplay 来源。只增加 change 专用采集用例，不修改生产世界、spawn 规则、wire 或 GUI。当前 player-only 的 21 条 directional 语料保持独立；新语料不能覆盖或伪造它。

## 已核实的生产路径

省略 `initialPlayerBodyPosition` 时，`DedicatedServerHost.create` 通过生产 `find-safe-spawn`、canonical starter chunks 与 `initializeStarterEcologyFromLoadedWorld` 初始化实际生态。现有生态含 grazer、night-stalker、settler 与 berry 掉落；玩家由同一 bootstrap 路径创建。额外实体通过 `AuthorityRuntime.executeCommand` 与既有受控开发者 capability 的实际命令执行器创建，不直接改 EntityStore 或拼装 snapshot。

命令来源必须标记为受控 fixture 管理操作，不冒充玩家网络动作。保存后使用相同 MemoryGamePersistence、新 executor、新 Host 恢复，验证实体未重复初始化。命令权限只用于本地测试，不增加网络权限。

## 行为与测试设计

1. Given 固定 seed 和真实 compute，When 不指定手写出生位置而创建 Host，Then 在实际 publication 中观测玩家与三种生态 actor、world-item；从实际 snapshot/view 投影 pose/Gameplay，并记录真实实体数量。
2. Given 初始生态，When 通过现有命令边界增加少量实体，Then 第二次 publication 的实体数量提高，原实体身份仍在。实体来源、命令、数量、tick 与 world epoch 必须可追溯。
3. Given 保存后的世界，When 第二个 Host 用同一持久化恢复，Then 原实体集合保持，starter ecology 不重复生成；恢复后采集一组新的 publication，明确新 epoch。
4. 从磁盘复算每条 content hash、manifest payload/corpus hash，核对来源与索引；原始语料保留本次 source SHA/diff/输入文件 hash。不同阶段各自的状态是真实 Host 来源，不拼成 codec 伪造结果。

用例位置 `e2e/network-entity-corpus.test.ts` 与 `e2e/vitest.entity-corpus.config.ts`。预期 RED：首版先要求真实实体类型/数量、保存恢复与来源验证，若仅用手写玩家位置的旧方法则缺失生态；随后改为上述生产 bootstrap 并取得 GREEN。数据写入独立 `/tmp/seedlands-network-entity-corpus-v1`，不提交原型代码或 generated raw corpus。

## 验收与证据

| 准出                                     | 证据                      | 状态                                                                 |
| ---------------------------------------- | ------------------------- | -------------------------------------------------------------------- |
| 初始生态/新增实体/恢复的实际 publication | Vitest                    | 通过：pose 数量 5/8/8，恢复后相同实体 ID                             |
| 三组 pose 与 Gameplay 及磁盘来源绑定     | Vitest                    | 通过：6 条真实记录；磁盘 hash/index/provenance 复核                  |
| 格式/类型与构建兼容                      | Static、Build             | 完整静态与浏览器/Node 构建通过                                       |
| 编解码强等价与浏览器互操作               | Vitest、Manual supplement | 三候选 6/6；Chrome/Node 双向各 6/6，属于探索互操作，不等于 UI 或性能 |
| 玩家动作权限、WAN、可见 UI、实体显示     | N/A                       | 本采集不实现或证明这些范围，仍归原 change 后续准出                   |

本补充包含于原 N0/N2 的估算与当前剩余范围，不引入额外产品能力，不重复创建 goal。实际测试与限制在交付记录回填；不同规模的少量样本仍不等于压力曲线或完整 N2。

## 交付快照

`network-entity-corpus.test.ts` 首次沿用手写玩家位置得到 1 体，未满足预置的 5 体断言而 RED；改走实际 bootstrap 后定向 1/1 GREEN。初始 pose 含 5 体、扩容及恢复各 8 体；对应 Gameplay 排除玩家，分别是 4/7/7，不能混淆两投影的计数。扩容仅通过现有本地开发者命令，未新增权限或生产 API。三阶段共 6 条，最新来源与浏览器结果见 [证据](network-input-pose-evidence.json)。原始数据与探索 codec 保留于独立临时目录，仓库只提交采集合同、用例和证据摘要。
