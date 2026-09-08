# CODEC9 共同校验与 C0 公平性独立审阅

## 一、范围与结论

本轮只读审阅以下 `/tmp` 可丢弃原型，并以 Node 22 执行两个轻量功能 smoke；没有修改原型、运行计时、benchmark、浏览器或网络 listener：

- `/tmp/seedlands-network-probe-codec/reference-schema-validation.mjs`
- `/tmp/seedlands-network-probe-codec/reference-schema-smoke.mjs`
- `/tmp/seedlands-network-probe-codec/c0-raw-reference.mjs`
- `/tmp/seedlands-network-probe-codec/c0-raw-validate.mjs`

审阅只判断当前九条、六类真实语料子集的 `decode → schema → own → hash` 公平性和安全边界。完整 gameplay、全部 action/receipt 与其他消息域的缺失已经登记，本文件不把它重复扩大为新范围。

共同 happy path 已经形成：C0 在 decode 后调用与 C1/C2 相同的 `validateReferenceRecord()`，随后 `structuredClone()` 出独立所有权，再对 owned binary 重算 descriptor hash。当前九条 fixture 全部通过；baseline bit flip 会在共同 hash 阶段拒绝，调用者之后修改原始 view 不会改变已经 own 的字节。这个结果保留为 CODEC9 partial subset 的功能 GREEN，不是 N2 性能或 wire 采用结论。

进入公平计时前仍有三项 P1 和一项 P2 需要修正。它们都是隔离原型的准入问题，不是已部署产品漏洞。

## 二、P1 准入问题

### P1：当前已测 action slot 的共同数值域宽于 C1/C2 wire

`reference-schema-validation.mjs:234-243` 中 `select-hotbar.slot`、`use-inventory.slot`、`move-inventory.source/target` 使用 `natural`，上限为 `Number.MAX_SAFE_INTEGER`。这是生产 `projectActionReceiptReference()` 保留非法槽位并返回 `invalid-slot` 回执所需的权威业务域，不能为了适配探索 codec 收窄。当前 CODEC9 已包含 `select-hotbar` receipt，但其 C1 固定字段为 `u32`，C2 schema 为 `uint32`。因此两个二进制候选的可表示域窄于共同 validator 和 C0，违反“同一 schema 工作量、同一可表示域”的比较前提。

Node 22 轻量复现把真实 success receipt 的 `action.slot` 改为 `9007199254740991`：

- `validateReferenceRecord()` 接受；
- C0 `encode → decode → validateReferenceRecord` 仍接受并保留该值；
- C1 的 `u32` 与 C2 的 `uint32` 不能承诺同一 roundtrip。

最小修复必须以生产业务域为准：保留共同 validator 的 `natural`，把 C1 slot 改为受检 safe `f64`，把 C2 slot 改为 `uint64` 后转 Number 并执行 safe-integer 检查；补 `0xffffffff`、`0x100000000` 和 `Number.MAX_SAFE_INTEGER` 的三个 codec 强等价，以及 `MAX_SAFE_INTEGER + 1` 的 encode/decode 拒绝。其他 action 的 slot/source/target 在进入 schema 时同样对齐该权威域，不能由 wire 类型静默收窄。

### P1：C0 接受 JSON 重复成员，C1/C2 拒绝重复 singular

`c0-raw-reference.mjs:48` 直接使用 `JSON.parse()`。JSON 中重复 object member 会在 parse 时折叠为最后一个值，共同 schema validator 已无法判断 wire 曾包含重复字段。当前 C1/C2 的固定字段或 Protobuf preflight 对 singular/oneof 使用唯一字段策略，所以畸形输入合同不一致。

Node 22 轻量复现以真实 correction frame 为基础，在 metadata JSON 中注入前置 `"physicsTick":999`，同时保留后置原始 `"physicsTick":0`。C0 `decode → validateReferenceRecord` 接受，结果为 `physicsTick:0`。同值重复也同样无法被普通 `JSON.parse()` 识别。

最小修复：在 C0 object materialization 前加入有界、duplicate-aware 的 JSON member 检查；或明确采用 canonical JSON wire，并在 parse 前验证输入字节就是允许的 canonical 表示。至少覆盖顶层 envelope、metadata 及嵌套对象的同值/不同值重复成员。修复后 C0 应与 C1/C2 一样在 schema/业务使用前拒绝，而不是依赖 last-wins。

### P1：C0 的 4 MiB 限制实际是 payload 限制

`c0-raw-reference.mjs:21-23` 要求 `payloadBytes <= MAX`，然后额外分配 12 字节 header；`decode()` 在第 42 行相应接受 `bytes.length <= MAX + 12`。C1 Writer 与 C2 preflight 把 4 MiB 用作完整 frame 上限。因此 C0 的公开限制比另两项多 12 字节，现有 oversize 回归也只拒绝 `4 MiB + 13`。

当前九条语料远小于该边界，因此这不撤销 9/9；但在畸形输入与大小曲线中会形成不同准入合同。

最小修复：冻结 `MAX_FRAME_BYTES = 4 MiB` 为完整 frame 上限，encode 在加入 header 后检查总长，decode 直接检查 `bytes.length <= MAX_FRAME_BYTES`。补完整 frame 恰为 4 MiB 接受、4 MiB + 1 在任何 parse/分配前拒绝的边界，不需要制造大型业务对象。

## 三、P2 完整性问题

### P2：共同 schema 没有闭合 record 和 binary block 对象

metadata 的 `object()` validator 会拒绝未知字段，但 `validateReferenceRecord()` 只读取顶层 `category/metadata/binary`，不拒绝其他顶层属性；binary block 也只检查 `name/bytes`，不拒绝额外属性。Node 22 轻量复现给真实 correction record 添加 `unexpected:true`，validator 仍通过。

当前四个 decoder 都只生成预期字段，所以此问题没有改变九条结果；但共同 oracle 本身不能证明 codec 没有多产或夹带字段。fixture source record 还带 `frameId`、provenance 等语料包装字段，不能直接对原始 source 外壳启用闭合校验。最小修复是先把 source 和 decoded output 都投影成共同 canonical record `{ category, metadata, binary }`，再严格闭合 canonical record 和 block `{ name, bytes }`；`frameId`/provenance 留在计时外单独校验。补 canonical record 与 block 的未知字段拒绝回归。

`REFERENCE_LIMITS.binaryBytes` 当前未被直接使用；由于本 subset 的 baseline 已由 schema 固定为 65,536 + 32,768 字节，实际 binary 仍然有界。可以删除该未使用名字，或在共同入口明确把它定义为累计 binary 上限，避免后续证据误以为已经执行了 4 MiB binary gate。

## 四、已经满足的公平性与边界

以下结论经代码检查和本轮轻量 smoke 支持，可以继续引用：

1. C0 wire 是 UTF-8 JSON metadata 加 raw binary，不是 base64 wire；base64 只出现在 JSON evidence artifact。
2. C0 在 decode 后执行共同 schema validator；未知 metadata 字段、安全整数越界、非有限数、超长或非法 surrogate string、重复 collision revision key 和数组上限由共同层拒绝。
3. `ownReferenceRecord()` 使用 `structuredClone()`；三个候选在 hash 前都能取得独立 metadata 与 `Uint8Array` 所有权。hash 使用 owned bytes，不依赖随后可能被复用或修改的接收 buffer。
4. `verifyOwnedReferenceBlocks()` 对 decoded block 重算 SHA-256，并与 decoded metadata descriptor 比较；canonical/fluid 的固定长度也先由共同 schema 验证。fixture 装载时的 source sidecar hash 属于语料来源校验，不代替 decode 后 hash。
5. 九条真实记录均按六种 category 的严格 metadata shape 校验；当前空 gameplay 与 `select-hotbar` receipt 的已知覆盖边界保持不变。

需要在后续 N2 runner 中继续保持相同顺序：**codec decode → 共同 schema validation → 独立 ownership copy → decoded block hash → application use**。source fixture 校验、测试断言和 artifact base64 序列化应放在计时外；四个应用阶段分别计量或统一计入完整应用成本，不能只对某个候选省略 own/hash。

## 五、验证证据

执行环境：Node `v22.23.2`。

```text
/tmp/seedlands-node-22/node-v22.23.2-darwin-arm64/bin/node \
  /tmp/seedlands-network-probe-codec/reference-schema-smoke.mjs
```

结果：`PASS`；真实记录 9 条，schema 拒绝 10 项，hash bit flip 拒绝，ownership isolation 通过，`timing: NOT_COLLECTED`。

```text
/tmp/seedlands-node-22/node-v22.23.2-darwin-arm64/bin/node \
  /tmp/seedlands-network-probe-codec/c0-raw-validate.mjs
```

结果：`PASS`；真实记录 9 条，raw binary roundtrip 与共同 schema/hash 通过，`timing: NOT_COLLECTED`。

本轮额外执行三个很小的只读复现，分别确认：超 u32 的 `select-hotbar.slot` 被共同 validator/C0 接受；C0 重复 `physicsTick` JSON member 被 last-wins 接受；record 顶层未知字段被共同 validator 接受。没有运行性能采样、coverage、构建或浏览器测试。
