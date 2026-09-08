# 编解码共同链路：实施与验证

## 当前结论

2026-09-07，继续既有 N2 探索。三个候选共用 `parse → semantic validation → ownership copy → hash → consumer`；任何中间阶段失败都不交付给消费者。C0 保留 JSON metadata + raw binary，C1 使用固定字段与 DataView，C2 使用 direct typed Protobuf。所有实现仍位于 `/tmp/seedlands-network-probe-codec/`，`wireStatus=not-adopted`，无生产接口采用、无性能结论。

共同 validator 校验字段白名单、枚举、安全整数、finite f64、Unicode/UTF-8 字节、数组与唯一键、baseline 元素类型/LE/长度和哈希格式。真实 corpus 的 frameId/provenance 在源适配器保留，进入共同业务链路前明确投影为 `{category,metadata,binary:[{name,bytes}]}`。后者的顶层、binary block 和稠密数组闭合，防止候选额外输出字段被 oracle 忽略。

`own` 只做独立复制；`hash` 只校验已拥有的 raw bytes。接收链路在第一次异步 digest 前完成复制，测试在 digest 暂停时复用原 wire buffer，消费者仍得到原值。基线 raw bit flip 经过实际 decode 后由 hash 阶段拒绝，不能只靠与原 fixture 做相等断言。

## 独立复审的修复

[独立复审](network-shared-validation-review.md)记录的是修复前版本，不覆盖后续修改。

| 问题                                  | 修复/验证                                                                                                 | 当前边界                                                                      |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| C0 重复 JSON member 被 last-wins 吞掉 | 新增有深度/累计 value 限制的 JSON 预检，实际 frame 的同值、异值、转义后同名 key 均拒绝；再调用 JSON.parse | 与 C2 duplicate singular 拒绝策略一致；不通过重排 JSON 固定对象键顺序         |
| C0 将 4 MiB 用作 payload 上限         | 改为完整 frame 上限；parser-only 精确 4 MiB 正例及 +1 byte encode/decode 负例                             | 该边界原型不是合法 baseline 的业务验收，业务 baseline 仍必须满足固定长度/hash |
| canonical record/block 未闭合         | 源先投影、共同 validator 再拒绝额外字段及 sparse binary                                                   | 不把 corpus provenance 当 wire 字段                                           |
| action slot 域比生产窄                | 保持生产 `natural/MAX_SAFE` 域，完整 receipt 参考使用 C1 safe f64 / C2 uint64                             | 不以探索 codec 的 u32 限制收窄合法失败回执；接入复验记录在本轮收尾证据        |

## 解码前资源检查

C1 Reader 已在输入上复用 DataView、使用借用 subarray，见 [Reader 记录](network-c1-reader-progress.md)。C2 在对象树物化前扫描实际 Protobuf wire，拒绝未知字段、重复 singular、多 oneof、错误 wire type、非法 UTF-8、单字段长度、重复项、深度和总字段超限。

在既有 17 项 primitive smoke 上新增累计 string bytes、累计 bytes 和 message nodes 预算。默认最大 frame 4 MiB、单 string 4096 bytes、深度 16、总字段预算 200000、message nodes 65536；累计字符串与 bytes 各不超过 4 MiB，候选可按消息域给更小上限。累计预算是接收资源政策，不能解释成 codec 的信息容量或最终产品限额。

新增用例使用与当前 `Frame → WorldCommit → Delta → Cell`、`Frame → Baseline → Block` 相同字段编号的受控 direct schema，包含少于 4 MiB 的近十万个零长度嵌套 Cell。拒绝发生在 object decoder 前，spy 为 0；没有先创建全部对象树再拒绝。原型自身仍需扫描有界输入，不能声称零开销。primitive 预算 GREEN 不等于浏览器吞吐或生产网络抗压测试。

## 本轮证据与限制

- Node 22.23.2：共同 schema 的原九条真实记录、12 项 schema 负例、raw hash bitflip/ownership；另有 sparse binary 负例，均 GREEN。
- Node 22.23.2：pipeline 4 组（真实九条、schema 失败、hash 失败、异步 hash 前复制）GREEN。
- JSON 预检 6 组 GREEN；C0 实际 frame 的重复字段、unknown envelope 与完整 frame 上限 GREEN。
- Protobuf 原 17 项 primitive + 4 项累计资源拒绝/3 项精确上限 GREEN；每项资源拒绝均 object decoder 0 调用。
- Chrome 152.0.7977.76 headless 与 Node 22.23.2 已完成 C0/C1/C2 的 CODEC9 双向共同链路互操作。HTTP loopback 只运送 fixture；这不是游戏 WSS/QUIC 传输、GUI 或 WAN 证据。receipt 后续修订需复跑并绑定新 bundle。
- 所有性能字段为 `NOT_COLLECTED`。输入/edge、独立 pose、真实 gameplay/HUD 消费、N1 平台矩阵与 N3/N4 仍未完成，不宣布完整 N2 准出。

本批只改探索原型与证据文档，未修改生产 source。既有 `8dc8233` 的静态/构建记录保留其原 SHA，不能冒充本批浏览器互操作或未来网络实现的证据。

## 本批浏览器互操作复验

UTC `2026-09-07T02:56:21.074Z`，Node 22.23.2 与 Chrome 152.0.7977.76 headless，三候选每个方向均 **59/59**。其中 9 条来自固定真实 Host corpus，49 条为完整 receipt structured synthetic，另 1 条为非空 gameplay structured synthetic。此为完整 receipt 接入后的结果，取代本文件早期 CODEC9 浏览器版本用于本批事实说明。

- 原真实 corpus SHA-256：`c3dc8a05e19dfe6b2dc90893752acd87ed2e97b1c977e131b19ba295f5b8830a`。
- 原 manifest payload SHA-256：`5077d888a0465f381543732c8dd6af0b0bbb13a63bf529d2ab9b5228c2180e98`。
- 本次 fixture SHA-256：`a77f14613d34636d66e73efe447ec93e2f50f9732d8cb202204b8874950df70c`。
- 本次临时三候选共同 browser bundle SHA-256：`c98bdd0aa3fae47ce09cfffb62ef0700080d02bb5475f9d64f5129b0bc7dd07c`，392828 bytes。它包括三个候选、辅助和 oracle；不能用作单候选产品 bundle 成本。

运行入口：`browser-reference-fixture.mjs`、`browser-reference-runner.mjs`，结果 `browser-reference-validation.json` 均在上述 `/tmp` 原型目录；生产与测试入口未导入它们。browser runner 只绑定 `127.0.0.1` 临时端口，完成后关闭 server/Chrome。

## 检查点绑定与客户端应用复验

原型源文件只用于本次可丢弃探索，未纳入生产交付；以下 SHA-256 绑定此检查点，后续修订必须重新验证，不能沿用旧 hash 声称通过。

| 原型文件                            | SHA-256                                                            |
| ----------------------------------- | ------------------------------------------------------------------ |
| `reference-schema-validation.mjs`   | `84bf9ab7e5c0e991ed3c38a7d7b355e0fc9c9dd9dc44e8d0850810a4c5296969` |
| `codec-application-pipeline.mjs`    | `48e588f37a2f1534af18051eb3298190dae3d6703247054e336117952b8d041e` |
| `c0-raw-reference.mjs`              | `c81b971b1b760fc3811e50529661ca26a1fb871362a92f685a04a99f84ab680e` |
| `json-wire-preflight.mjs`           | `1dfca396cd1310e88c149508fc9e7629dfa881ec80cf44774d9bfc11c4ffa338` |
| `reference-fixed-codecs.mjs`        | `ba36423780be164c08f518ca2ed3361cd45f3dd61e0d87b779c2f58bd95d57cf` |
| `fixed-schema-reader.mjs`           | `12dc626a8f106b19b55978b5ae64b13db820cdcc804523af7c0ae42271b051b9` |
| `protobuf-wire-preflight.mjs`       | `3a695407ebe3375c251c15bd4b7b18cebf930cc2992a450f76283dc234fe2346` |
| `fixed-schema-receipt.mjs`          | `60b28bb8018118480c1d510625160420bfd0d61c9a32f727600dd704ae792e97` |
| `receipt-synthetic-corpus.mjs`      | `4382470a2c6ae6cb2bcf42221c185d7985ac8861c334332c30a05cf292ad7c79` |
| `gameplay-synthetic-corpus.mjs`     | `25e05bd540dfb7716c09a20948f8a867ec8740abb2f8a6b847f4573f4beec636` |
| `reference-pipeline-validation.mjs` | `3a6a4544436bbff24575183fa9c86d042b968d83ce71387c5fac0f19a11cf39d` |
| `browser-reference-validation.mjs`  | `06e53e5b201c91667d35ace0399e787553edbf7d74d32a5b89ee741e9205d068` |
| `browser-reference-runner.mjs`      | `750d18d0301ada9996a7d6b442ab58b91871551116ee7b710a652b60e31246c7` |

Node 22.23.2 显式运行 `SEEDLANDS_REFERENCE_DECODED_FIXTURE=/tmp/seedlands-network-probe-codec/real-fixed-schema-decoded-fixture.json SEEDLANDS_REFERENCE_C0_FIXTURE=/tmp/seedlands-network-probe-codec/c0-raw-decoded-fixture.json SEEDLANDS_REFERENCE_SOURCE_CORPUS=/tmp/seedlands-network-real-corpus-v1 pnpm exec vitest run --config changes/2026-09-06-node-dedicated-server/e2e/vitest.codec-application.config.ts`：1 file / 1 test PASS。它复核三候选原九条记录的 source/manifest/content hash 与实际 collision mirror/prediction oracle；不把50条synthetic DTO消费当成实际HUD/实体表现准出。
