# N2 基线 descriptor/page 候选编解码计划

## 输入锁定与隔离范围

本轮只读取冻结派生语料 `/tmp/seedlands-network-baseline-reference-projected-v1-r2`：其 `manifest.json` SHA-256 为 `9d590ded6a1b050f9b7c42cdf3638ca957509f888a2e89de909ee264b6f85dfb`，`frames.jsonl` SHA-256 为 `4320c31fd0c46b58c4bf158f4d94cd59991f9f810abd8a09dc3ada3fbb0b766d`。它绑定原始 r2 的 manifest `0d2959e728f73a30efec8c9bac0f58269b9d0b51f3c73c23b0640fbbb1b7b0ad`、frames `2d3a0a9fd1670c087367fbb1c9330eda9e2484d9e7facd665892c6128e5f3b91`，包含 3 个真实 descriptor（两组 mesh 各 27 entries、一组 collision-resync 1 entry）与按既有乱序抵达顺序记录的 330 个实际 page；16 KiB 是本冻结 descriptor 的分页参数。

实现只能新建 `/tmp/seedlands-network-probe-codec-baseline-reference-v2`；若该精确路径已存在，立即失败且不覆盖。该目录将从冻结的 `/tmp/seedlands-network-probe-codec-presentation-v2` 复制后扩展；不修改后者、原始/派生 corpus、生产 `src/`、包配置或既有候选原型。本计划不冻结正式 wire，所有结果均为 `not-adopted` 探索证据。

## 候选投影与不变量

C0、C1、C2 均新增两类明确 DTO：`baseline-bundle-descriptor-reference` 与携带一个原始 page `Uint8Array` 的 `baseline-page-reference`。descriptor 保留 ref、request/interest/bundle 身份、purpose、最低 revision、authority checkpoint、entry/role、块描述符、元素类型、长度、页数和 SHA-256；page 只保留现有公开 reference 所需的 bundle/ref、entry/block、`pageIndex` 与原始字节。语料中的 `arrivalIndex`、`naturalIndex` 和 `locator` 仅用于审计与驱动确定乱序抵达，绝不新增为 wire DTO 的包壳字段。C0 继续是 JSON 元数据加原始数值块；C1 是固定字段二进制加长度框定 raw page；C2 是直接 typed Protobuf message/bytes 字段，禁止 JSON、值树封套或把旧 `chunk-baseline` 冒充 page。

所有既有限额和语义保持不变：元数据最多 64 KiB、可靠消息及单基线传输最多 1 MiB、在途 16 MiB。此轮公开 descriptor 的语义形状另固定为 `mesh` 恰好 27 entries（main 1、overlay 26）或 `collision-resync` 恰好 1 entry；27 是候选合法上限，512 只保留为 production reference 的总体页/防御性解析背景，绝不当作本 DTO 的合法 entries 数。冻结语料的 block page payload 为 16 KiB（canonical 4 页、fluid 2 页），这是本语料的分片配置，不是公开 reference DTO 或候选 wire 的硬上限；通用 page payload 与可靠帧仍各受 1 MiB 约束；安全整数、`f64`、`-1`、枚举和原始 byte 的既有合同不得收窄或抬高。C1 沿用单个有界增长 buffer 与复用 `DataView`，不得按标量分配；C2 的新 direct schema 必须扩展既有 raw Protobuf preflight，使嵌套 entry、page bytes 和标量预算在对象物化前受限。若冻结的合法 descriptor/page 无法编码或解析，记录为该候选失败，不筛掉样本。

## 验证与证据

Node 22 先完成每个候选的 3 descriptor 与 330 page 编码/解析，逐字段深等价（含数组顺序、null、字符串、安全整数和逐字节 `Uint8Array`），且解码对象独立持有，不改变输入。随后以临时解码 artifact 构造实际 reference reassembler 输入，按语料指定抵达顺序重组；每个 entry 的 canonical/fluid 字节和 SHA-256 必须与 r2 frame 的 descriptor/reassembled 记录一致。此处正式 change-local 测试可调用生产 reassembler；`/tmp` codec 本身不得导入生产源码。

每种候选另有最小真实 wire 负例：截断 frame、未知 kind 或 oneof、超预算嵌套 entry 或 page bytes，以及该格式可表示的重复/冲突字段均须经过实际 decoder 拒绝，不能只证明 encode 前共享校验。C2 断言 preflight 拒绝时未调用 Protobuf object decoder；C0/C1 则在其解析边界拒绝。

真实入口锁定为复制后 `reference-fixed-codecs.mjs` 的 `c1`/`c2` 与 `c0-raw-reference.mjs` 的 C0，经 `codec-application-pipeline.mjs` 的验证/独立持有/哈希链路；presentation 扩展由 `presentation-codecs.mjs` 接入。历史 `codec-core.mjs`、`benchmark-runner.mjs` 是 28 条合成 MP 实验，明确不作为本轮入口。

每个候选输出可审阅证据：输入 pin、codec source hash、descriptor/page/bundle 的编码字节总数与分项、JSON UTF-8 metadata 单列、成功/失败类别及 reassembler oracle 结果。该阶段不采样耗时、不启动 Chrome、不做 benchmark，也不覆盖 client、远端、UI、WAN、分片传输或采用结论；后续 N2 性能窗口与 N3/N4 才分别处理这些边界。
