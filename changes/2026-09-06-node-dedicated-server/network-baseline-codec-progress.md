# N2 基线 descriptor/page 候选编解码进度

状态：本 baseline descriptor/page 子集功能验证通过，仍为 `not-adopted` 的 `/tmp` 探索原型，未采集任何时间指标。

冻结输入为派生 r2 的 3 个真实 descriptor、330 个真实 page（冻结 descriptor 的分页参数为 16 KiB）（raw 合计 5,406,720 B）；`mesh` 固定 main 1 + overlay 26，`collision-resync` 固定 1 entry，不能把 production reference 的 512 防御性背景误作本候选的合法 entries 数；C0/C1/C2 各自完成 333 条编码、解析、深等价与独立持有。三个候选的临时解码 artifact 均按冻结的乱序到达次序交给生产 reference reassembler，得到每个 entry 的 canonical/fluid SHA-256 与 r2 一致。

C0 拒绝截断、未知 kind 和重复 JSON 字段；C1 拒绝截断、未知 type、超过 1 MiB page/可靠帧上限和超过 entry 上限；C2 的 unknown oneof、重复 singular、嵌套 entry 与 page bytes 超限均在 Protobuf object decode 前拒绝，计数为零。完整输入 pin、源码 hash、descriptor/page/bundle 字节分项与运行证据见 `network-baseline-codec-evidence.json`。

16 KiB 是冻结语料 descriptor 的分页参数，不是公开 DTO 或候选 wire 的硬上限；通用 page 与可靠帧均保持 1 MiB 上限。另有一个明确标为 synthetic 的 32 KiB descriptor + 3 页探针：C0/C1/C2 强等价，并由相同 descriptor 交给 production reference reassembler 完整重组。

此轮不说明速度、浏览器、远端、UI、WAN、分片传输或正式 wire 采用。本 baseline 子集之外，既有 C0 长 ID 表示限制与 world-commit 2,048 cells 加 halo 的语料/预算缺口仍待单独处理，不能把本结果表述为整个 N2 已完成。page 公开 DTO 不带逐页 digest，逐页字节完整性由 descriptor 的完整 transfer SHA-256 在 reassembler 完整重组后验证；语料 `arrivalIndex`、`naturalIndex` 与 `locator` 只作审计，不进入 wire DTO。
