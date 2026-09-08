# N2 编解码候选语料实验

## 状态

本轮已完成 C0、C1、C2 对同一候选语料的 Node 22 与实际 Chrome 编解码强等价验证，并生成可审阅的样本 manifest、schema 摘要、内容 hash、编码字节数与原始采样记录：[network-codec-evidence.json](network-codec-evidence.json)。

首轮时序采样发现另一个 WASM 基准并行运行，已停止并废弃，未停止或干预其他任务。该轮单独保留为 [network-codec-evidence-contended.json](network-codec-evidence-contended.json)：原始临时时序在隔离重跑时被覆盖，不能补造；文件明确标为 `CONTENDED_OR_UNVERIFIED`，不含可用性能结论。

随后取得 WASM root 确认的跨任务窗口（其 agent 自 `2026-09-06T17:36Z` 暂停测试/构建），root 授予约三分钟 Node codec 独占采样。实际隔离 run 约为 `2026-09-06T17:38:31Z` 至 `2026-09-06T17:40:38.056Z`；起点由 127 秒实际 runner 时长倒推，因为释放时已核验并删除 owner 记录、未将它另存，故标为 approximate。以原子 `mkdir /tmp/seedlands-benchmark-reservation` 取得锁，内容只有本 owner 的 `owner.json`（owner `01a07751-c72c-7ea3-82bb-03c9ce46b982`、label `N2-isolated`、PID、UTC）。

实际命令是自有等价 wrapper：`PATH="/tmp/seedlands-node-22/node-v22.23.2-darwin-arm64/bin:$PATH" node /tmp/seedlands-network-probe-codec/exclusive-run.mjs`。首次 `finally` 在删除 `owner.json` 前调用 `rmdir`，因此得到 `ENOTEMPTY`；这不是他方抢锁或额外文件。随后只在 owner/label 已核对相等的条件下删除该文件并移除目录，确认 reservation 不存在。当前正式 [network-codec-evidence.json](network-codec-evidence.json) 的 `timingStatus` 为 `ISOLATED`。

这些结果仍只是隔离候选 DTO 的编解码微基准：不能推导真实输入确认、显示新鲜度、TLS/WSS/QUIC 在线字节、GC 长周期成本或采用结论。N2 的畸形输入和真实 trace 对照尚未完成，N4 前不冻结 wire、GUI 或正式 codec。

## 隔离原型与候选

原型、依赖和临时浏览器页面只在 `/tmp/seedlands-network-probe-codec/`，没有导入或修改 `src/`、测试、构建配置或产品依赖。它按当前公开消息语义构造确定性候选 DTO，**不是**游戏端采集的真实旅程 trace；N4 必须采集实际实现流量与 join trace，再同这份语料交叉核对。

该临时原型曾在误判 N2 已完成后清理；但 N2 现仍未完成，不能把现有 evidence 当作唯一可复现实验实现。完成当前客户端只读梳理后，需在新的 `/tmp/seedlands-network-probe-codec/` 恢复同一候选语料、C0/C1/C2 schema 与 runner，记录源码 hash 后供审阅；本记录不授权运行新的采样。

| 候选 | 原型实现                                           | 固定版本与许可证                                                     | 已测职责                                                                                                                           |
| ---- | -------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| C0   | JSON metadata + 明确二进制块目录、little-endian 头 | 原型内实现                                                           | 基线参考；binary 块以长度与索引绑定。                                                                                              |
| C1   | MessagePack                                        | `@msgpack/msgpack@3.1.3`，ISC，npm 解包 662,045 B，无运行依赖        | 通用二进制候选。                                                                                                                   |
| C2   | Protobuf 固定 `oneof` schema                       | `protobufjs@8.8.0`，BSD-3-Clause，npm 解包 3,758,553 B；`long@5.3.2` | 显式 `Session`、输入、edge、correction、实体、delta、Chunk、welcome、world index、join burst 字段；没有 `Any` 或 JSON bytes 包装。 |

浏览器 bundle 为隔离页面的 324 KiB 未压缩开发产物，只用于能力验证，不能当作产品浏览器包体数据。库未写入仓库 `package.json` 或 lockfile。

## 确定性候选语料

实际 manifest 有 28 个实例，全部使用固定常量与可审阅的算法模式，没有随机 byte bag。

| 范围                | 实例数 | 结构                                                                                                                            |
| ------------------- | -----: | ------------------------------------------------------------------------------------------------------------------------------- |
| 连续/跳号持续 input |      6 | 静止、单轴、对角、上升/下潜与跳号 `inputSequence`。                                                                             |
| `jump-pressed` edge |      5 | 正常、重复、乱序、过期、跨 epoch。                                                                                              |
| player correction   |      4 | ready、待回放、resync、旧 collision baseline；都有 ack、physics tick、body 与 revision vector。                                 |
| entity pose         |      5 | 0、1、16、64、256 稳定排序的 player/creature/npc/item。                                                                         |
| sparse Chunk delta  |      4 | 单 cell、三 cell、16 cell、64 cell，含 fluid-only 值。                                                                          |
| 完整 Chunk baseline |      3 | 每条都有 32³ `u16` little-endian canonical voxel block（65,536 B）和 32³ fluid block（32,768 B），采用不同确定性地形/流体模式。 |
| 首次 join burst     |      1 | welcome、256 entity pose、上述 3 个完整 Chunk 和 world index 的顺序化集合。                                                     |

每个实例的 schema/类别、canonical 结构字节数和 SHA-256 在 evidence 的 `corpus.manifest`。这里刻意固定字段投影、浮点值、revision 和发送内容；没有将量化、压缩、频率或 transport 混入 codec 对照。

## 保真与字节结果

- Node：`v22.23.2`、Darwin arm64；浏览器：独立 HeadlessChrome `152.0.0.0` context。
- C0/C1/C2 均通过 28/28 `DTO → bytes → DTO` 深等价。C2 对 proto3 默认值使用 schema 默认值恢复，保留原有零值/false 字段语义；完整 Chunk 仍以 bytes 表示 32³ canonical 数据。
- 实际跨宿主方向也完成：Node 编码数据在 Chrome 解码，Chrome 编码数据在 Node 解码；任一深等价失败会使临时运行失败。本次未出现失败。
- 每轮完整语料的编码字节数可用于相同 payload 的体积对照：小消息组 C0/C1/C2 为 57,935 / 50,386 / 33,643 B；大消息组（3 个完整 Chunk + join burst）为 629,383 / 624,754 / 614,156 B。它们不是 TLS/WebSocket/QUIC 在线字节，也不包含压缩、重传或排队。

## 隔离微基准结果

五批的 codec 顺序轮换。下表是五批中位数的 **完整 corpus pass p50**（毫秒），不是单包 p50/p95/p99；每一批的 p50/p95/p99 和 Node RSS/heap delta 都在 evidence。两列 decode **包含整条 deep-equality 测试 oracle**，它们只记录此次验证路径，不能表示运行时 decode 速度，不能用来比较 C0/C1/C2 的 decode 快慢。

| 组别            | codec | 编码字节/完整组 | Node encode | Chrome decode + oracle | Chrome encode | Node decode + oracle |
| --------------- | ----- | --------------: | ----------: | ---------------------: | ------------: | -------------------: |
| 小消息（24 条） | C0    |          57,935 |       0.363 |                  1.200 |         0.300 |                2.511 |
| 小消息（24 条） | C1    |          50,386 |       0.214 |                  0.700 |         0.200 |                1.178 |
| 小消息（24 条） | C2    |          33,643 |       0.392 |                  1.100 |         0.300 |                1.665 |
| 大消息（4 条）  | C0    |         629,383 |       0.290 |                 18.800 |         0.200 |               24.571 |
| 大消息（4 条）  | C1    |         624,754 |       0.180 |                 18.400 |         0.200 |               23.787 |
| 大消息（4 条）  | C2    |         614,156 |       0.673 |                 19.200 |         0.700 |               24.524 |

在这个固定投影中，C2 相对 C0 少 41.9% 的小消息应用字节；三个完整 Chunk 与 join burst 主导的大消息组只少 2.4%。C1 分别少 13.0% 与 0.7%。这说明字段名和控制数据是小消息差异的主要来源，而完整 canonical voxel/fluid bytes 已占大消息主体。现有 decode + oracle 数字不支持任何 codec decode 速度结论；C2 的小消息字节最少也不足以选择正式 codec，因为 C2 还带来更大的 runtime/生成链路，结果没有覆盖 schema 演进、错误/预算、真实网络和应用镜像成本。

## 测量设计与下一步

已完成的隔离 run 使用五批、codec 顺序轮换、warmup；小消息每批 2,000 个完整 corpus pass，大消息每批 50 pass，方向固定为 Node encode → Chrome decode 和 Chrome encode → Node decode。Node 记录 RSS/heap delta；浏览器记录 `performance.memory` 能力可用性。p50/p95/p99 定义为**完整 corpus pass**，不是单包尾延迟；如要显示平均每条，只能作为总耗时/消息数的平均吞吐派生值，不能将 pass 级 p99 除数伪装成单包 p99。

下一轮改进测量前还需要：

1. 恢复可审计的 `/tmp` runner 后，先一次性完成保真 roundtrip 和畸形输入 oracle；将 oracle 放在计时外。取得新的跨任务 CPU 独占窗口，保留可见负载/CPU/内存环境，再重新生成时序 evidence。
2. 补每个候选的截断、未知 discriminator、长度越界、非有限数、超长数组和 nested join 预算拒绝；C0 已有局部头/目录约束，C1/C2 不能因库能解码就省略产品边界验证。
3. 新的计时仅包含生产必需的 decode、schema validation 与归一化，并分项记录；不把 deep-equality、base64/DevTools 传输或测试 fixture 复制混入。由实际网络实现采集同字段的运行 trace、Chunk/流体 snapshot 和首次 join burst，与本候选 manifest 逐字段/大小级别核对。之后再进入固定 codec 的 N3 transport 对照和 N4 采用决定。

## runner 恢复与未计时验证（2026-09-06）

N2 尚未准出，完整可审计原型现保留在 `/tmp/seedlands-network-probe-codec/`，不得在本实验结束前清理。它是依据当前公开会话消息语义重新构造的确定性候选语料，仍**不是**游戏端采集的真实旅程流量；N4 仍须采集实际实现的输入、校正、Chunk/fluid 与 join trace 交叉核对。本次恢复不改产品 `src/`、测试、构建配置或仓库依赖；临时锁定 `@msgpack/msgpack@3.1.3`（ISC）与 `protobufjs@8.8.0`（BSD-3-Clause，含 `long@5.3.2` BSD-3-Clause）仅位于该目录的 `package.json`/`pnpm-lock.yaml`。

恢复后入口为 `validate-runner.mjs`、`benchmark-runner.mjs` 和共享 `codec-core.mjs`。前者在 Node 22.23.2 与独立 headless Chrome context 中完成当时 C0/MP/C2 三种候选的 28 条保真、Node→Chrome 28/28、Chrome→Node 28/28、截断、未知 discriminator、非有限数、cell/实体/join 预算拒绝；未运行任何计时循环。实际快速验证 UTC 为 `2026-09-06T17:49:57Z` 至 `17:53:39Z`，成功结果在临时 `validation-result.json`，不覆盖正式或 contended evidence。语料 manifest 为 28 项：input-state 6、input-edge 5、player-correction 4、entity-pose 5、chunk-delta 4、chunk-baseline 3、join-burst 1；每个完整 Chunk 都是 32³ voxel 65,536 B 与 fluid 32,768 B。

下一轮 `benchmark-runner.mjs` 在任何计时之前先重复保真和畸形 oracle，之后每一 codec warmup 一次、五个 pass 轮换顺序。每个 pass 只计整套 28 条语料的 encode、decode、schema validation、normalization 四项；深等价、base64、DevTools/Playwright 传输和 fixture copy 在计时外。任何 p50/p95/p99 必须标为完整 corpus 的 **per-pass** 分位数，不能外推为 per-packet p99。该 runner 尚未在新的独占窗口运行；旧 `ISOLATED` evidence 仍只能称为 `decode + oracle`，不提供 decode 速度结论。

供审阅的源码 SHA-256：`codec-core.mjs` `1626e5368b520e8d35893d7fbac3bfebe828681a9a4fa7178a363f71c79fc231`；`browser-entry.mjs` `ea3b8cf80cf265d49aee65ff943009cc221944b58876f49c7ce18664dfc067b7`；`validate-runner.mjs` `45f224bad97fd3e70a3cb6d9cc65c027aed2e5d10ccff3ba61258cd5ab124de0`；`benchmark-runner.mjs` `946117d4ff7d150a2d6c065508ba7add0c3a5d3d4d76dbd753dbdc1eeb23ac0b`。浏览器 bundle 仅用于临时浏览器验证，未压缩 331.7 KiB，不能当作产品包体数字。重新打包或修改上述源码后必须重新记录 hash。

## 修正隔离计时烟测与下一轮门槛（2026-09-06T18:30Z）

WASM root 交出约三分钟独占窗口后，以原子 `mkdir /tmp/seedlands-benchmark-reservation` 预约 `owner=01a07751-c72c-7ea3-82bb-03c9ce46b982`、`label=N2-isolated-corrected`。实际运行从 `2026-09-06T18:30:38Z` 至 `18:30:40Z`，exit 0；只运行 N2，随后核对 owner 文件相等后删除文件并 `rmdir` 释放锁。第一次 wrapper 在实际 runner 前因 zsh 保留变量 `status` 写入失败，立即确认是本 owner/label 的空闲预约并清理；不是锁竞争，也没有进入采样。

修正 runner 在计时前通过 Node 与 Chrome 的 28/28 保真及每 codec 7 项畸形输入 oracle；环境为 Node `v22.23.2`、Darwin arm64、Chrome `152.0.7977.76`。计时中的 deep equality、base64 和跨进程传输均已移出。原始 stage 数据、当前候选语料的每样本 normalized SHA-256、窗口元数据与限制已写入 [network-codec-evidence.json](network-codec-evidence.json) 的 `correctedIsolatedSmoke`，没有覆盖 contended 原始记录。

这次只取得每 codec 5 个完整 28 条语料的 pass、每 codec 1 次 warmup；浏览器还出现 `schemaValidation=0 ms` 的量化读数。因此它只能是**计时边界烟测**：可以确认 encode、decode、schema validation 被分开调用，不能提供稳定 codec 排名、p95/p99 或任何采用结论。旧表中的 `decode + oracle` 仍不可用于 decode 结论；新烟测的 encode/decode 也不应被提升为性能优劣证据。

此前名为 `normalization` 的操作实际是审计 oracle 的稳定键排序与 bytes base64 投影，不属于生产 DTO 规范化。它从此改名为 `oracleNormalizationDiagnostic`，仅作为测试/审计开销诊断，**不进入生产运行时成本、codec 对照或 N3/N4 采用依据**。

下一次独占窗口的 runner 已调整为：每 codec 固定 5 次 warmup；每 codec 至少 30 个独立 batch；每个 stage 重复完整 28 条 corpus 直到该 stage 累计不少于 100 ms；codec 顺序在 batch 间轮换。统计单位仅为 batch，若另列平均每条只能明确写成总量派生平均，不能把 batch 的 p95/p99 说成单包尾延迟。该更新后的候选源码 SHA-256 为 `codec-core.mjs` `b70218c4f79b25fb212f4f0fee8202b6f8d931dcca110810fcdf0112161d09cd`、`browser-entry.mjs` `d05f3719eabc501a6560856edf0d2decda1e49c04804e154de38a83ca6a8f784`、`validate-runner.mjs` `45f224bad97fd3e70a3cb6d9cc65c027aed2e5d10ccff3ba61258cd5ab124de0`、`benchmark-runner.mjs` `2b749a2dd27bbe94b1062923ed8299d6a2f425102ec7e0a15a5cda867dc5df7c`。这套更新后的 runner 尚未运行；现有临时 browser bundle 对应上一版源码，下一窗口必须在预约前重新生成 bundle、记录其 hash，再取得新的独占窗口。

## 最终隔离 MP 对照（2026-09-06T19:47Z）与 C1 合同差异

在 WASM 全部结束、root 明确交还窗口后，本次仅运行 N2。先原子取得 `/tmp/seedlands-benchmark-reservation`（owner `01a07751-c72c-7ea3-82bb-03c9ce46b982`、label `N2-final-isolated`），锁内重新 bundle 浏览器入口并记录 bundle SHA-256 `efdf15b28f80b1e500e79eda16b0862c0c6364e1baa59af2a805b46abe151b39`，再运行一次更新后的 runner。权威 run meta 记录实际 UTC `2026-09-06T19:47:41Z` 至 `19:48:57Z`、exit 0；结束时仅在 owner 文件完全匹配后删除并 `rmdir`，锁已释放。Node 为 `v22.23.2` Darwin arm64，Chrome 为 `152.0.7977.76`。本次源码、bundle、临时依赖和 lockfile 的全部 SHA-256 与每 batch 原始数据均在 evidence 的 `finalIsolatedMpProbe`，原型继续保留于 `/tmp`。

计时前 Node 28/28、浏览器本地 28/28 和每 codec 7 项畸形输入检查均通过。5 次固定 warmup 后，每一候选在 Node 与 Chrome 各执行 30 个独立 batch；每个 encode、decode、schema validation、`oracleNormalizationDiagnostic` stage 都累计至少 100 ms，并按 batch 轮换候选顺序。`oracleNormalizationDiagnostic` 是排序键与 bytes base64 的审计投影，仍只作诊断，完全排除在生产成本结论之外。统计单位是“每 stage 累积多个完整 28 条 corpus pass 的 batch”；30 个 batch 仅允许在将来描述有意义的派生吞吐 p50/p95，**不报告 p99**。由于 100 ms 是控制下限，stage wall time 本身不可当作优劣排名。

复核 [network-selection.md](network-selection.md) 后发现合同差异：其中正式 **C1** 是无 f32/量化损失的固定字段/数值块 schema binary；`MessagePack`/`CBOR` 只允许作为附加探针。当前 runner 标为 `C1` 的实现实际为 `@msgpack/msgpack@3.1.3`，从本节起统一称 **MP**。因此这轮合格地保留为 C0 / MP / C2 的可复现附加对照，但**不是正式 C0/C1/C2 的完成证据，N2 不能据此选择 codec 或冻结 wire**。

下一步是实现真正、无损的 schema-binary C1，沿用本候选语料与同一受控计划，重新对 C0 / C1 / C2 / MP 全部采样；随后还要与 N4 真实游戏 trace 和 join trace 交叉核对。现有 MP 数据不能代替该轮。

## 正式 C1 schema binary 功能 smoke（未计时）

为消除 MP 与正式 C1 的合同差异，隔离原型新增 C1 fixed-field schema binary：`SLC1` 12 B little-endian frame（magic、u8 version、u8 kind、flags=0、u32 payload length），每种 DTO 以固定字段顺序编码；整数为 LE，公开浮点全部为 IEEE-754 `f64` LE，没有 JSON/Map 逃生。C1 与 C0/C2/MP 共享 4 MiB frame、1 KiB UTF-8 字符串、4,096 revision、512 entity、4,096 delta cell、256 join、join depth 3 与完整 Chunk 65,536 B voxel / 32,768 B fluid 限制；C0、C2、MP 也在编码/解码边界执行 4 MiB frame 限制。

本节只做 Node/Chrome 正确性 smoke，未运行计时：C0、C1、C2、MP 各自 Node→Chrome 28/28 与 Chrome→Node 28/28 强等价通过。每组还记录 8 项共享 DTO 语义边界检查；其中仅截断会进入该 codec 的 `decode()`，其余多数直接调用 `assertValid()`，不构成各 codec 的 wire 畸形证据。C1 另通过 28/28 Node roundtrip 与 header 截断、payload 截断、version、kind、flags、payload-length 六项实际 framing parser 畸形拒绝。首次 C1 smoke 暴露 `Reader.bytes` 实例字段遮蔽同名方法，完整 Chunk 解码失败；已改为 `Reader.source` 后同一 smoke 通过。该结果只证明候选实现可解码，不是性能或采用结论。

待正式 N2 独占窗口的源码与 bundle SHA-256：`codec-core.mjs` `94598d37933f68930be43f5e9633931fe7466398596a418725ff9c49a5861b87`；`schema-binary-c1.mjs` `1db946be818db3100ee4c82534b44a00fab27465851d0ba026a994a2e8cbfb16`；`schema-binary-c1-smoke.mjs` `e5998a85167ad76a86828e040f913a6b78a760cd6ccd5bf0c05cb49e32cfa548`；`wire-limits.mjs` `bba17b147ae923c99ca89df0d92cf9d229c7d03e0654c528fa40ab04f6f0ea1d`；`browser-validation.bundle.mjs` `d261c2cdffc270133f66c5e943ff39888a922a2a450d11ef9b5fddbf02c1b47d`。功能证据位于临时 `c1-node-smoke-result.json` 与 `four-codec-validation-result.json`；正式计时必须另获 root 明确授权、跨任务暂停与共享 reservation。

## 畸形证据与语料来源更正（阻止 N2 冻结）

此前“各 codec 通过 8 项畸形类”的表述不准确，现撤回。`runMalformed()` 的截断项会实际调用各 codec 的 `decode()`，而非有限数、字符串、Chunk 长度、entity、cell、join 预算以及 unknown discriminator 中的大部分是在编码前或解码后直接调用共享 `assertValid()` 得到拒绝。这证明候选共享 DTO 语义边界，**不能证明 C0/C1/C2/MP 分别对每一种畸形 wire frame 都正确拒绝**。C1 的 header/payload 截断、version、kind、flags、payload-length 六项是单独的实际 C1 frame parser 证据，仍可保留。正式 N2 前应为每个 codec 分别构造长度、未知字段/判别符、嵌套计数、非有限表示（若格式可表示）、oversize frame 与 trailing bytes 的 wire-level 变异语料，并断言拒绝不污染缓存或队列。

现有 28 条语料也全部更正标为**合成探索候选**，不是产品 Host 采集的流量，不能据此冻结 N2。它把 epoch 设为数值、ack 设为无符号序列、实体假名设为 sheep/slime/villager、输入含 sprint/underwater 等字段；真实 `SessionEpoch` 为 string，`acknowledgedInputSequence` 初始值为 `-1`，实体 type/archetype 为 player/world-item/creature/npc 与 grazer/night-stalker/settler，实际 input 是 moveX/moveZ/verticalIntent/jumpHeld/jumpPressed、stream、sequence、targetPhysicsTick 与 issuedAtMs。真实采集和投影缺口见 [network-real-corpus-plan.md](network-real-corpus-plan.md)。

C1 原型同样不进入比较：当前 `Writer` 为每个标量新建 `Uint8Array`/`DataView`，`Reader` 为每个标量新建 `DataView`，其分配模式会污染任何 C1/其他候选的 CPU/分配结论。正式比较前必须改为有界单一可增长 buffer、单个复用 `DataView` 与明确最大容量，保留完全相同的 f64/长度/版本/错误边界；完成后重新生成 source/bundle hash、功能证据与四组对照。此前所有时序仅保留为合成探索和计时管线审计，不能用于 codec 排名、N2 完成或 wire 冻结。
