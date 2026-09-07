# MoonBit 最终数据快照

本文件是删除 MoonBit 可执行实验代码和工具链前固化的数据摘要。原始 JSON、压缩采样和历史分析仍保留在 `changes/2026-09-06-moonbit-wasm-workload-experiment/evidence/` 与 `changes/2026-09-07-data-plane-adoption/evidence/`；旧 runner 不再承诺可执行。

## 可比口径

- 正式汇总生成时间：`2026-09-06T18:40:52.847Z`。
- 测量源码：`79e05c53e8c8d199c24b438165c7f62aa69efc70`。
- 环境与协议：headless Chromium、单 Worker、10 个平衡配对 block、每种变体 30 个 corpus 任务；任务耗时包含输入 clone、Worker 往返、适配准备和输出，尾分位数是每个 block 内分位数的均值。
- 汇总源：`changes/2026-09-07-data-plane-adoption/evidence/workload-summary.json`，删除前 SHA-256 `479cb0eea68f8796f7057ad92849df4e7afc2cad210956f8acc3941a05cb53e8`。
- 展示表：`changes/2026-09-07-data-plane-adoption/evidence/workload-table.md`，删除前 SHA-256 `6ba46598acbfd58ac74f7761999be8fd48084ccee51fbea3ff09cf6c632b0af6`。
- 最终决策：`changes/2026-09-07-data-plane-adoption/adoption-plan.md`，删除前 SHA-256 `2d7f274b0a49a601baa26364c8bba80051ef16632fd289324790213067bd979e`。

## W02–W07 端到端任务均值

单位为 ms/任务；“收益”表示相对左侧基线的耗时下降。小于 0 表示变慢。

| 负载               | 优化 TS | MoonBit | MoonBit 相对 TS | Rust scalar | Rust 相对 MoonBit | Rust SIMD |
| ------------------ | ------: | ------: | --------------: | ----------: | ----------------: | --------: |
| W02 Chunk 填充     |  2.5653 |  2.3481 |           8.47% |      2.0083 |            14.47% |       N/A |
| W03 halo           |  2.5553 |  2.3627 |           7.54% |      2.3083 |             2.30% |       N/A |
| W04 普通 Mesh      |  7.8833 |  3.1876 |          59.57% |      2.9488 |             7.49% |       N/A |
| W05 复杂/水面 Mesh |  3.9533 |  1.4682 |          62.86% |      1.2972 |            11.65% |       N/A |
| W06 Mesh 打包      |  0.7885 |  0.6382 |          19.05% |      0.6251 |             2.06% |    0.5835 |
| W07 流体候选       |  4.6982 |  3.2118 |          31.64% |      2.9555 |             7.98% |       N/A |

MoonBit 相对优化 TS 在全部六项上均有收益，但在相同 corpus 和任务边界下六项均慢于 Rust。W04/W05 的高收益证明“Mesh 适合 Wasm”，不证明 MoonBit 是最佳生产实现；Rust 同一描述符实现更快且能复用纯 core。W06 最终采用标准 Rust SIMD，任务均值比 Rust scalar 再低 6.65%，比 MoonBit 低约 8.58%。

## 其他候选和边界

- W10 large：MoonBit 计算 `0.0278 ms`，Rust scalar `0.0152 ms`，Rust SIMD `0.0065 ms`；但真实 Authority 路径缺少连续大批输入，绝对任务收益不足以承担新增消费者，未进入生产。
- W14 存档编解码：MoonBit 相对优化 TS 的任务均值仅改善约 `0.74%`，p95 反而慢约 `15.65%`；Rust 任务均值也只改善约 `2.97%` 且置信区间跨零，因此继续采用优化 TS。
- W15 CRC：MoonBit 计算相对优化 TS 慢约 `18.56%`，任务均值慢约 `5.98%` 且不确定；继续采用索引化 TS 循环。
- 删除前旧 MoonBit 生产外 artifact 为 `9,788 bytes`；当前 Rust scalar/SIMD artifact 分别为 `22,527 / 24,089 bytes`。体积优势不足以抵消第二套语言、工具链、等价测试和确定性维护成本。
- 宏观组合收益不能归因于 MoonBit。最终生产组合相对空白对照的进入可玩、30 秒 non-idle CPU、编辑 p95/p99 改善来自 TS 数据平面修复与部分 Rust Wasm 的共同作用；其中 Rust 相对优化 TS 的额外整体 CPU 与编辑尾延迟区间跨零。

## 最终采纳结论

- 保留并默认启用：优化 TypeScript 全量基线；General Worker 的 Rust W02–W06；能力可用时 W06 使用标准 SIMD128。
- 不默认启用：W07/W10/W14/W15 Rust/Wasm 路径；Fluid、Authority、Logic、Persistence 继续使用优化 TypeScript。
- 删除：MoonBit 源码、固定工具链、生成 artifact、构建/校验命令、专属主动测试和旧实验 runner。
- 保留：上述数据、原始样本、历史结论文档和 Rust 生产/实验能力。
