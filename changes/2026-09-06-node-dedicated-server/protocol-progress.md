# N0 公共消息与 C0 参考编解码进度

## 本次完成

- `network-message-semantics.ts` 定义草案版本 `1` 的公共会话引用、入站 allowlist、出站投影、可靠性/流类别表与规范化语料入口。客户端请求只包括持续输入、可靠跳跃边沿、玩家动作、兴趣、检查点、重同步、心跳和断开；没有 capabilities、管理命令、world-edit、canonical、Fluid 或 Logic 候选上传入口。
- 高风险的 `player-action` 统一走可靠 events；`input-edge` 中的 `jump-pressed` 走可靠 control；持续 `input-state` 与实体 pose 标记为 latest。Chunk 基线、增量和提交索引均可靠 world 消息。
- C0 参考格式为固定 16 字节 little-endian 头、UTF-8 JSON 元数据和明确命名的数值块。它校验 magic、版本、元数据/块/总字节预算、严格 JSON 有限值、消息 discriminator、块名称、偏移连续性、重叠、截断和未声明尾部字节。未使用 V8 serialization。
- `encodeC0Envelope()` 与 `decodeC0Envelope()` 只使用浏览器已有的 `TextEncoder`、`TextDecoder`、`Uint8Array` 与 `DataView`，可作为 Node 与浏览器间 C0 对照实现。输出块是已经受边界验证的输入视图；后续 C1/C2 可以复用 `NormalizedNetworkCorpusMessage` 的消息类别与投影语义。

## 已执行证据

- RED：两个新增 Vitest 文件在实现前都因缺少协议与 C0 模块失败。
- GREEN：`pnpm exec vitest run tests/server/network-message-semantics.test.ts tests/server/network-codecs.test.ts` 通过 6/6。覆盖 reliable/latest 的 jump 分离、入站管理/能力伪造拒绝、未投影 Authority snapshot 拒绝、C0 roundtrip、头版本/伪造长度和重叠块拒绝。
- Static：目标模块 Prettier、ESLint、`git diff --check` 通过；全量 test TypeScript 检查中本模块相关诊断为 0。

## 仍未完成

- C0 是 N2 的参考 codec，正式 wire、C1、C2、压缩、真实 WSS/WebTransport 接线和性能数据均未完成；没有采用结论。
- 接入层仍需在认证后校验 `PublicSessionRef` 与实际 session/issuer/player 绑定，并执行节流、期限、序号、交易去重与 Chunk 因果屏障。公共 DTO 只表达这些所需字段，不替代权威校验。
