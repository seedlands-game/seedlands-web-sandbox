# 公开基线参考实现进度

## 当前结果

已完成纯 `AuthorityBaselineCaptureResult` 投影、字节预算账本、就绪顺序发布队列、惰性 page 物化和有界重组器。公开对象仍为 `wireStatus: 'not-adopted'`，只证明参考层的形状、所有权、hash 与生命周期；session 授权、真实网络、codec 采用以及浏览器 mesh/collision 消费仍不在本切片完成范围内。

实现拆为七个单一职责模块，均少于 500 个物理行：

- `network-reference-baseline.ts`：capture/context 验证、LE 复制、page 数量前门禁、异步 hash 与取消结算。
- `network-reference-baseline-owned.ts`：尚未发布的 owned draft 生命周期。
- `network-reference-baseline-publication.ts`：就绪顺序分配 bundle/transfer id、descriptor FIFO、惰性 page 和队列注销。
- `network-reference-baseline-reassembly.ts`：descriptor/page 严格验证、乱序收集、hash、取消/关闭和有界完成窗口。
- `network-reference-baseline-budget.ts`、`network-reference-baseline-validation.ts`、`network-reference-baseline-types.ts`：独立预算、验证和公开类型。

## RED 与 GREEN

首次 RED 使用 Node 22 定向运行 `tests/server/network-reference-baseline.test.ts`，结果为缺少 `network-reference-baseline` 模块，测试文件未收集。实现过程中独立并发用例另得到两个真实 RED：同一 mesh bundle 的 54 个 transfer 同时完成 hash 时返回了 54 个产物；带额外 Symbol 的已关联 page 在另一个 digest 运行时提前拒绝且未等待清理。

修复后使用 Node `v22.23.2` 定向运行五个测试文件，结果为 5 files、42 tests 全部通过：

- 投影测试覆盖完整 27 块 mesh 与单块 collision-resync、canonical `uint16` 明确 little-endian、fluid 保值、输入副本、五种 unavailable 原因、身份/checkpoint/扩展字段拒绝、512 page 前门禁、取消等待全部 digest，以及跨 queue 重复发布安全拒绝。表驱动反例另验证 expected purpose/key/generatorVersion/minimumRevision、重复 buffer、错误长度/role/order 均在大块 hash 启动前拒绝；低 transfer/in-flight 限额返回 `transfer-limit` 且 digest 调用为零。
- 发布与预算的独立测试覆盖 4 MiB 队列、descriptor FIFO、descriptor 先行、惰性 page、独立 settle、ready 顺序、checkpoint 首个 `await` 前复制、关闭注销和 sizer 失败清账，共 9 项。
- 正常重组测试覆盖乱序 page、强等价 LE/raw block、副本隔离、orphan/duplicate/hash/schema 失败和接收预算归零。
- 独立并发重组测试覆盖 exactly-once 终态、digest 中取消/关闭/关联 schema 错误的物理等待，以及 wrong-ref/unknown bundle 隔离，共 5 项；两个真实 RED 均转为 GREEN。
- sizer 边界验证 descriptor metadata 超过 64 KiB 与完整 page 超过 1 MiB 时 source/send 账本归零；sender 故障注入验证一个 digest 已拒绝时仍等待另一个 barrier 物理结算后才释放 owned reservation。

同一版本还通过 `tsc -p tsconfig.test.json --noEmit`、目标 ESLint、目标 Prettier、`git diff --check`。子任务没有运行全仓 coverage、生产 build、benchmark 或浏览器测试。根任务随后统一完成静态 195 文件/1074 项、world 行覆盖 96.37% 和两端 build；详见 [统一验证](validation-summary.md)。这些证据不能由本切片的聚焦 Vitest 代替。

本批按既有路由由 Sol/high 实现七个生产模块，Terra/high 子任务分别承担发送预算/发布测试、并发重组测试与源码独立审查，根任务负责合同核查和整合验收。这里记录的是任务分工，不是计费模型 usage 或成本实测。由未参与这七个生产模块实现的 Terra/high 完成只读审查，复核成功准入 high-water 修复后结论为无新增阻断。审查绑定的文件 SHA-256 为：

- `network-reference-baseline.ts`：`168c1edc72a288b2ec53a2a73abfff0e10f08dc07054824a11abe7644153f7ce`
- `network-reference-baseline-types.ts`：`46ca686323539fd8eb3573c00565cf072438431ad8e0abb11031b70865bac7a2`
- `network-reference-baseline-validation.ts`：`9872ecd8899ac1489183c1f2c09ceaabde21ef25e1d84dcc6a8c47ffd202b51b`
- `network-reference-baseline-budget.ts`：`033e9ccb5ad901fc951415d3c143e5666902f4516dc2e6fd12e402bba9dc1acb`
- `network-reference-baseline-owned.ts`：`2bbdde806a7145ac1a2036863018d9d25286bcb543d2beb002f7f6866319ec4a`
- `network-reference-baseline-publication.ts`：`835e0881684de079b7b1053f0bf4f55bbd1d530422c0d5ebc3b9f96ac87a605e`
- `network-reference-baseline-reassembly.ts`：`6852c282d5d168623f1a249f4fbfd9295afaacaa6982644071b7818e0e85aa6d`

## 资源与边界

投影器在首个 `await` 前复制 checkpoint 与完整 block；所有已启动 hash 都在取消或失败释放预算前 `allSettled`。page 总数在大块复制和 hash 前受可信配置与 512 硬上限约束。发布队列只有在 `takeDescriptor()` 成功后才允许物化 page；page 在 send queue 预留成功后才复制，page token 与 published source handle 独立结算。关闭未出队的 published handle 会同步从 FIFO 注销，避免 metadata 引用积累。

重组器只对同时具有可信 ref 和当前活动 bundleId 的 malformed page 清理对应 bundle；wrong-ref 与未知 bundle 不影响其它活动 bundle。清理会等待已启动 digest，多个最后页只允许一个终态产物，预算不会重复扣减。接收端 descriptor 会深复制并冻结；最终 block buffer 归调用方所有。descriptor 的 high-water 只在预算预留与 active 状态建立成功后推进，容量拒绝不会烧掉尚未准入的 id。

16 MiB 只统计 sender owned block 或 receiver active block，4 MiB 只统计已物化的待发送 descriptor/page。Authority 原始 capture、调用栈内输入 view、hash scratch、transport copy 与最终消费 cache 不在这些数字内，不能据此宣称进程总内存受限。

## 来源与待办

实现依据的批准计划 SHA-256 是 `f4b9c62e7bdc7df771b9ecad599ffe5a2b67eb6800b6f12af61cace0f40b4ad9`。按实施审查补入 r2 原始来源、receiver 权限边界、临时内存口径与成功准入 high-water 语义后，当前计划 SHA-256 是 `daf12d9809a092f78c51b23c4a8602699c0e4c03653147191b68a0852a5173f1`。

原始真实 corpus 保持冻结在 `/tmp/seedlands-network-baseline-corpus-v1-r2`；本实现未重采或覆盖它。派生 projected/reassembled corpus 已由独立任务复用该来源生成并冻结 r2，共 330 页；见 [派生记录](network-baseline-reference-corpus-progress.md)，未重写原始语料。后续 Remote adapter 仍须完成 owner/generation 门禁、descriptor 接纳 barrier、可靠 page 调度与 ACK，并用实际 collision mirror 和完整 27 块 `createProceduralMeshInput()` 消费路径证明没有客户端 canonical 生成或缺项 fallback。
