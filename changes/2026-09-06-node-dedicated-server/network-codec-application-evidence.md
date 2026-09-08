# C0/C1/C2 application oracle 证据

## 状态

`GREEN`。计数域 decoder adapter 刷新后，Node 22 下已重跑同一三 fixture 命令并通过 `1 passed / 1`。测试固定九条真实语料的顺序、manifest 身份哈希、JSON 元数据及 baseline 原始二进制比较，并通过实际 `NetworkReferenceReceiver` 比较 source 与 C0/C1/C2 解码应用结果。

刷新后的 adapter 中 C0、C1、C2 各解出九条，已由本 oracle 独立复验。C0 使用独立的 JSON metadata 加 raw binary reference；只有在显式传入其 fixture 环境变量时，测试才把 C0 一并纳入九条强等价和 receiver 应用检查。

早期定向 RED 曾逐项列出未支持记录。C1/C2 补齐九条支持后，上一版带 C0 fixture 的定向执行为 `1 passed / 1`；C0、C1、C2 都完成九条强等价和实际 receiver 应用比较。fixture 的 `sourceCorpusSha256`、`sourceManifestPayloadSha256` 与 source manifest 一致，因此未把错误语料来源误报为 codec 能力缺口。

## 执行方式

```sh
PATH=/tmp/seedlands-node-22/node-v22.23.2-darwin-arm64/bin:$PATH \
SEEDLANDS_REFERENCE_DECODED_FIXTURE=/tmp/seedlands-network-probe-codec/real-fixed-schema-decoded-fixture.json \
SEEDLANDS_REFERENCE_C0_FIXTURE=/tmp/seedlands-network-probe-codec/c0-raw-decoded-fixture.json \
SEEDLANDS_REFERENCE_SOURCE_CORPUS=/tmp/seedlands-network-real-corpus-v1 \
pnpm exec vitest run --config changes/2026-09-06-node-dedicated-server/e2e/vitest.codec-application.config.ts
```

## 覆盖边界

测试在 baseline 安装后生成一帧真实本地预测，再应用确认 correction；它检查缓存 chunk 的 hash/revision、补齐请求、预测 body、pending 输入与 reset。当前真实 correction 因位置误差触发 `large-error` reset，同时请求 revision 补齐；correction 先于 commit 到达时不把最终可读 chunk 作为该次序的断言。gameplay view 与 action receipt 只比较真实 DTO 数据，不证明 GUI、完整 receipt 处理或重连状态机。

不测性能，也不采用任何网络 listener 或客户端能力。

Node 22.23.2 下，生产源码 TypeScript 检查 `pnpm exec tsc --noEmit --pretty false` 通过；测试 TypeScript 检查 `pnpm exec tsc -p tsconfig.test.json --noEmit --pretty false` 也通过，后者单独证明本 oracle 测试可编译，不能由前者代替。三个新增文件的 Prettier 检查和 `git diff --check` 通过。

## 计数域独立审阅

刷新 adapter 的 C1/C2 对 correction、gameplay、welcome、baseline 与 receipt 分别以 `2^31`、`2^32`、`Number.MAX_SAFE_INTEGER` 进行实际 encode/decode 强等价；C1 以有限 `f64` 加安全整数检查，C2 以 `uint64`/`sint64` 后再作安全整数检查。直接伪造入站 parser 拒绝已覆盖 correction 的 physics、commit、world 和负 ack，baseline revision、welcome checkpoint，以及 receipt sequence、executed commit、gameplay revision 和 committed-world-revision。world commit 的 publication upper bound、world revision、structural revision 与 delta predecessor/revision 仍没有独立的 `MAX_SAFE_INTEGER + 1` 畸形入站 mutation；有效边界 roundtrip 已覆盖，剩余恶意 parser 边界保持为后续实验缺口。
