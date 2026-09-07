# 输入与实体 pose 参考链路进度

2026-09-07。本页记录 N0/N2 的一个实施切片，不修改已审核的冻结合同。整个 change 仍 Active，codec 与 transport 均未采用；没有新增公开 listener、GUI 或远端配置。

## 已实现的行为

`src/server/protocol/` 新增完整 `InputCommand` 的纯参考投影、紧邻 `receiveInput` 的决定投影和独立实体 pose 投影。输入的 state/edge 与安全整数、有限数值保持原语义；独立副本只取白名单字段。决定同时保留输入与权威 epoch，`accepted` 必须是正确 stream、尚未推进该序号的 ack、resync 已清除。`wrong-epoch` 和 `wrong-stream` 校验当前 gate 直接保证的关系；不对可能来自 Host 健康门的 `capacity` 臆造输入缓冲前提。

pose 只取实体 id/type/archetype、位置、速度与 grounded，稳定按 id 排序，保留 epoch/tick/commit/world revision；超过 256 项明确拒绝，不静默裁剪。publicationSequence 由调用方提供，语料逐条注明发布者 `dedicated-host-subscribe` 与 `per-recorder-subscription` 范围，不能用作 Authority Worker 或未来网络的序号。

## 来源与证据边界

新增 `/tmp/seedlands-network-directional-corpus-v1` 来自独立的真实 Host、生产计算和受控时钟，保留 5 条输入、6 条即时决定、5 条后续 correction、5 条 pose，共 21 条。移动、jump edge、held 和 release 都由实际 `receiveInput` 接纳；ack 在后续物理推进才改变。重复序号的决定与 ack 经过检查，尚不据此声称重复 edge 的运动结果验证。

这五条 pose **只有玩家**。真实非玩家、不同实体密度和对应 gameplay 消费者仍未覆盖。原九条语料及其世界/epoch 不改写，新旧语料不能拼成同一业务时序。两次写出同一 capture 的字节一致只证明 writer 稳定；从磁盘另行重算逐条 content、manifest payload、整个 corpus 的 hash，并核对索引和 provenance。源码身份使用当时 Git SHA、tracked diff hash 和显式输入文件 hash，不将 dirty 语料称为已提交源码重放。

三候选探索遵循同一 `parse → schema → own → hash → consumer` 链路，强等价检查移出任何未来计时。浏览器互操作仅用 loopback HTTP 交付固定 fixture，真正编解码在 Chrome 内执行；它不证明 WSS、QUIC、网络波动、可玩 GUI 或性能收益。

## 独立审查与修正

- Sol/high 核对 input 复制和值域，指出决定与 snapshot 可组合出错误语义。两项关系测试先 RED，修复后 11 项 input 单元 GREEN。
- Terra/high 复审实际 Host 语料，指出 publisher 范围、player-only 覆盖和落盘 hash 验证的表述缺口。修正 provenance 与范围并补磁盘验证，corpus 定向用例 GREEN。
- C2 的 raw scalar 审计此前发现 uint32 超域被截断、非 0/1 bool 被转换为 true。已在 Protobuf 对象解码前校验 raw varint，保留单值/packed 两种反例。这是可丢弃候选的正确性修复，不能据此宣布 wire 准出。
- 新 directional 实际 wire 审计覆盖非有限数值、枚举、安全整数、ack 和 pose 数量。C2 初次审计发现非有限值、超安全整数、ack=-2 在对象解码后才被拒绝；补 raw scalar 策略后五类均在对象解码前拒绝，decoder 与 consumer 调用数为 0。每帧复用一个 DataView，额外验证非零 byteOffset 的 packed/unpacked 浮点读数，不声称因此已测得性能收益。
- `Object.is` 负零审计发现 C0 的 JSON.stringify 将合法 `-0` 写成 `0`，C1/C2 保留。选择保留合法 JSON 的 `-0` 数值字面量，不缩小输入值域、不增加元数据字段；修正和完整复验随本次收尾，不沿用此前21条通过声称全部f64域强等价。

## 当前检查状态

最终环境为官方 Node 22.23.2 / macOS arm64，Chrome 152.0.7977.76；没有正式性能采样。完整机器可读来源和原型 SHA 在 [证据摘要](network-input-pose-evidence.json)。

| 检查                              | 结果与范围                                                                                                             |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `pnpm verify:static`              | 177 文件通过/2 跳过，936 项通过/4 跳过；world 行覆盖 96.37%；格式、ESLint、命名、coverage、Svelte/TypeScript 全通过    |
| `pnpm build`、`pnpm build:server` | 通过；5 个 Node ESM 入口，浏览器保留已有大 bundle 提示                                                                 |
| directional 采集                  | 1/1，21 条真实记录                                                                                                     |
| directional 解码应用              | 2/2，三候选各自的新 Host 消费 decoded input，产生相同即时决定和后续 correction/pose；错误来源或篡改 input 在应用前拒绝 |
| entity 采集                       | 1/1，实际 bootstrap、管理命令与保存恢复的 6 条记录；pose 5/8/8，Gameplay 4/7/7                                         |
| 原九条碰撞/预测应用 oracle        | 1/1，最新 C0/C1/C2 解码 fixture 复验                                                                                   |
| 四组 Chrome/Node 互操作           | 每候选每方向分别 59（9 真实+50 synthetic）、21 真实、6 真实、3 负零 synthetic；四组独立运行，不拼为同世界时序          |

显式采集入口分别是 `pnpm exec vitest run --config changes/2026-09-06-node-dedicated-server/e2e/vitest.directional-corpus.config.ts` 和 `vitest.entity-corpus.config.ts`（后者同目录完整路径）。输入应用设置 `SEEDLANDS_DIRECTIONAL_DECODED_FIXTURE=/tmp/seedlands-network-probe-codec/directional-decoded-fixture.json`、`SEEDLANDS_DIRECTIONAL_SOURCE_CORPUS=/tmp/seedlands-network-directional-corpus-v1`，执行同目录 `vitest.directional-application.config.ts`。未设 fixture 时明确失败，不静默跳过。

四组最终浏览器 bundle SHA 相同，为 `542eaecdf10cee353185745130d8649965ca936dd9fb377fd12beb58fff17dbb`；422,664 B 包含全部候选和 oracle，不能用作单个 codec 的产品包体。C0 新 serializer 的递归遍历与字符串组装必须完整计入未来 encode 成本，此前所有 C0 encode 计时不沿用。

## 保留的选型门

独立审查要求实际验证共同 schema 的表示域，不能只用小样本回环。新增明确标记的 synthetic 256 体 pose，每个唯一 id 为 256 UTF-8 B：共同 schema 通过，C0 元数据 97,771 B 超过固定 65,536 B 而拒绝；C1 wire 79,692 B、C2 75,048 B，均强等价。记录为 `REPRESENTATION_LIMIT`，没有提升 C0 预算或静默过滤该负载。正式 1 MiB 消息、分片/重组/背压与完整业务成本未在此验证。

真实玩家动作请求域、业务消费者（HUD/实体展示与插值）、代表性规模/频率直方图、正式 N2/N3 的受控采样及 T2 能力矩阵仍待推进。少量实体正确性样本不等于密度曲线；本批不宣布 codec 或 transport 默认值，不声明 GUI、WAN 或部署已完成。

长周期 docs baseline 本批不增加新架构决策：平台归属、公共参考投影和未冻结 wire 的边界已存在于代码地图；本页及实施计划保留该切片的测试合同与状态，避免将临时语料和原型细节提升为长期规范。
