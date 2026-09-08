# Gameplay v2 编解码验证切片

## 目标与范围

在既有 N0/N2 合同内，让三候选完整保留新 [Gameplay 消费者参考](network-gameplay-consumer-plan.md) 的 actor behavior 字段。只扩展可丢弃原型和当前 change 的接收后字段等价证据，不采用 wire、不改服务器或浏览器运行链路。旧 `/tmp/seedlands-network-probe-codec` 保持当前检查点身份，新原型放 `/tmp/seedlands-network-probe-codec-consumer-v2`，依赖复用既有安装，不增加生产依赖。

## 决定与行为

1. 新类别为 `gameplay-consumer`，metadata kind `gameplay-consumer-reference`、projectionVersion 2；其他参考类别和代次维持原语义。C0 采用同一严格 metadata/原始块封套；C1 明确固定字段；C2 明确 schema 与行为 enum，不用 opaque JSON/bytes 冒充固定 schema。
2. 共用 validator 验证 v1 Gameplay 基础字段及 v2 actorBehaviors：最多 512 条、稠密数组、唯一 entityId、已知八行为，关联同一可靠 entities 中的 creature/npc。只校验公开字段，不虚构已省略的 ActorState 内部值。原子验证后才 ownership/hash/consumer。
3. 三候选使用同一新 9 条真实语料；不改变 f64/整数精度或删字段。C1/C2 尽量复用当前 Gameplay 字段逻辑，不能以序列化嵌套旧 wire 的额外封套成本冒充 schema 本身成本。
4. 单独验证无 actor 的合法视图、全部八行为、非法 enum/孤立/重复/超过预算，以及实际 wire 的畸形枚举/重复字段/长度或超量计数；C2 在对象解码前拒绝违规 enum 和 repeated 数量。旧参考的回归仅证明各自版本，不能替代新 v2。
5. 新真实语料经过 parse → schema → own → hash → consumer 后与源强等价；最终由显式当前 change oracle 检查公开角色行为与实体定义对应，不创建只用于测试的预测/重生 reducer。真实浏览器显示/生命周期适配另行验证。

## 测试设计与验收

先运行新类别通过共同 validator/原型编码，得到不支持类别 RED，再按字段补齐 GREEN。真实语料另核对内容/index/manifest 与当前固定源码 hash，缺少或过期 fixture 不得跳过通过。Node 与 Chrome 双向互操作独立报告，临时原型不得导入 src/tests 或作为交付源码。

| 准出                                  | 证据类型                  | 初始状态                               |
| ------------------------------------- | ------------------------- | -------------------------------------- |
| 三候选强等价与非法字段/真实 wire 拒绝 | Vitest、Manual supplement | RED 后 GREEN                           |
| 9 条真实来源与接收后公共字段关联      | Vitest                    | 4/4，当前源码读盘绑定                  |
| Chrome/Node 双向同值                  | Manual supplement         | Chrome/Node 各候选双向 9/9；不证明 GUI |
| codec/传输性能与网络采用              | N/A                       | 无采样，本切片不声称完成               |

仍属原 N2 工作包，沿用阶段滚动估算和 20% buffer，不重复计费或创建 goal。分工：Sol 负责固定 schema C1/C2 扩展与 raw wire 反例；root 负责共同 validator、C0、源绑定和整体集成；生产投影及采集已经独立评审。整个 change 继续 Active。
