# Gameplay v2 编解码进度

本切片按 [计划](network-gameplay-codec-plan.md) 在独立临时原型扩展新类别。生产投影已在 07caff1 保存；旧 v1 类别、语料和原型保持历史身份，不承诺已采用的产品 wire 兼容。

共同 validator 和 C1 初次遇到新类别分别取得 unsupported/unknown category RED；随后 C0/C1/C2 对新 9 条真实 Host 语料全部强等价，通过 parse → schema → own → hash → consumer。C1 复用 Gameplay 固定字段并追加有界 actor behavior；C2 使用直接 GameplayConsumer schema、明确枚举和重复字段预算，没有把旧 wire 或 JSON 塞成 opaque payload。

C1 实际 wire 的非法 enum/count/重复关联拒绝；C2 undeclared enum 与 513 actor 条目在对象解码前拒绝，省略的默认零枚举及重复关联在对象解码后拒绝。共同 schema 另测八行为、空 actor 和九组非法输入；C0 对可表示的畸形 raw wire 经过整条 pipeline 后，consumer 调用仍为 0。独立 synthetic 浮点负零回归覆盖时间、玩家数值、实体 health/position 与 breakAction，三候选均保真。真实 9 条中的 actor behavior 全为 idle，不能称真实场景覆盖八行为。

Chrome 152.0.7977.76 与 Node 22.23.2 双向每候选 9/9。当前 change 的 decoded oracle 初次缺输入 RED；当前源码固定路径通过实际文件 SHA 校验，过期/缺项/多项负例先 RED 后 GREEN，最终 4/4 通过。它逐条核对源/index/manifest/provenance，再验证 stage 的 actor/reliable entity、epoch/context/player 关联，不创建测试专用预测 reducer，不冒充真实客户端应用。

本轮只新增 change-local oracle 与证据；目标 Prettier、ESLint 和完整类型检查通过，生产源码沿用 07caff1 已通过的完整静态及浏览器/Node 构建，不重复无变化的 coverage/build。完整 hash、浏览器结果及分层拒绝范围见 [机器证据](network-gameplay-codec-evidence.json)。

长期 docs baseline 没有新增入口/职责变化，当前记录保留在 change。整个 Node change 仍 Active；字段/操作契约、代表负载、N2/N3 性能、实际客户端/GUI/WAN/CI 继续保留门禁。本批没有 timing，也没有采用 codec/transport 或创建 goal。
