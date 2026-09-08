# N2 编解码准入前独立审阅

## 一、范围与结论

本次只读审阅以下可丢弃原型，没有修改或执行它们，也没有运行计时、benchmark、浏览器、listener 或生产代码：

- `/tmp/seedlands-network-probe-codec/c0-raw-reference.mjs`
- `/tmp/seedlands-network-probe-codec/c0-raw-validate.mjs`
- `/tmp/seedlands-network-probe-codec/real-fixed-schema-validate.mjs`

审阅对象是进入 N2 微基准前的候选实现，不是已部署产品。下列 P0/P1 表示**进入 N2 的准入阻断**，不能表述为生产漏洞。

现有 CODEC9 证据仍然成立：C0、C1、C2 对当前九条受控 fixture 的已支持投影通过强等价和 application oracle；C1/C2 的安全整数边界与现有畸形样本也已通过。该结果只证明已测的 partial subset，不证明完整消息域、恶意 parser 资源边界或三个候选具有可比较的完整应用成本。当前 gameplay 恰为空 inventory item、空 recipe、空 entity、无 break action；action receipt 只覆盖 `select-hotbar` 的 success 与 `invalid-slot`。这两个范围缺口不撤销 9/9 的正确性通过，也不能把它提升为完整域通过。

**结论：当前原型不应开始 N2 计时。** 先统一 parser、schema validation、资源准入、输出所有权和 hash 阶段，再以相同完整域重新取得功能 GREEN。完成这些工作仍只代表可以采样，不代表采用任何 wire。

## 二、进入 N2 的阻断问题

### P0：C2 在资源限制前物化 Protobuf 对象树

`real-fixed-schema-validate.mjs:174-182` 只先检查 4 MiB frame 上限，随后立即执行 `proto.decode()` 和 `proto.toObject()`；repeated field 数量、字符串长度、cell 数量和嵌套结构上限都在对象树已经创建后检查。一个不超过 4 MiB 的 wire 可以包含大量零长度嵌套 message 或 repeated value，在最终被拒绝前制造远高于 wire 大小的对象、数组和引用开销。

最小准入条件：

1. 在完整物化前增加受限 wire preflight，或使用能在解码过程中执行深度、字段计数、累计字符串字节和累计元素预算的 decoder。
2. 同时限制单数组、全 frame 累计节点、嵌套深度、字符串总字节和解码后的预算，不能只限制单个业务数组。
3. 增加不超过 4 MiB 的恶意样本：大量零长度 `Revision`、`Cell`、重复字符串和嵌套 message；断言在超过预登记预算时停止，而不是先物化再拒绝。

### P0：C1、C2、C0 的复制与所有权口径不等价

`real-fixed-schema-validate.mjs:45-56` 的 C1 `Reader.take()` 对每次读取都调用 `slice()`。因此每个 `u8/u32/i32/f64` 都先分配新 `Uint8Array`，`u32/i32/f64` 随后再为该小切片创建 `DataView`。`openFixedFrame()` 还会复制整个 payload，baseline 的 64 KiB 和 32 KiB raw block 又各复制一次。Writer 已复用一个 `DataView`，Reader 却没有对应复用，所以该开销属于当前参考实现，而不是 C1 格式的必要成本。

C0 在 `c0-raw-reference.mjs:48-63` 解析 JSON metadata 后，以 `subarray()` 返回 raw block 的借用 view。C2 的 `bytes` 也没有与 C1 明确统一成相同的独立所有权。若直接计时，结果会同时比较编码格式和三套不同的复制策略，无法回答 codec 本身或完整应用成本的问题。

最小准入条件：

1. C1 Reader 在原输入上持有一个 `DataView`，按 offset 直接读取 scalar；string/raw 先返回受界 `subarray()`。
2. 三个候选统一约定 decoded binary 的所有权。可以统一返回借用 view，并把需要长期保留的 copy 归入共同 normalization 阶段；也可以统一在 decode 后复制，但三者必须一致。
3. 分别记录 parse、schema validation、normalization/ownership copy 与 hash，不把某候选的隐式复制混入 parser 后再与另一个候选的借用 view 比较。
4. 在调用者释放输入或复用接收缓冲后验证 decoded DTO 的生命周期，防止为追求少复制引入悬空或被改写的业务数据。

### P0：三个候选都没有验证 wire 中 raw block 与 descriptor hash 一致

C0 的 `c0-raw-validate.mjs:13-18` 在编码前验证 fixture sidecar 的 SHA-256；之后只比较 decode 输出与同一个 source。C1/C2 同样保留 baseline descriptor 与 raw bytes，却没有在 frame decode 后独立重算 descriptor hash。对 raw block 的一个合法长度 bit flip 可能通过 framing 和 shape，再由当前 roundtrip oracle 之外的真实接收路径接纳。

最小准入条件：

1. 三个候选在相同的 decode 后阶段，以独立实现重算每个 binary block 的 SHA-256，并与 descriptor 比较。
2. 增加 canonical/fluid raw bit flip、descriptor hash 非法格式和正确 hash 配错误 block 的入站样本；三者应在同一阶段 fail closed。
3. hash 是否包含在计时范围必须预登记；若应用必需，则报告不含 hash 的 parser 时间与包含 hash 的完整应用时间，不能只为某个候选省略。

### P0：C0 的功能工作量显著少于 C1/C2

`c0-raw-reference.mjs:41-63` 只验证通用 envelope、metadata JSON 可解析、block 名称/数量、长度和尾随字节。它不执行 C1/C2 已实现的 category schema、字段存在性、枚举、有限数、安全整数、数组上限、baseline shape 或业务互斥关系。`JSON.parse` 后得到的任意 metadata 对象即可返回。

所以当前 C0 是正确的“JSON metadata + raw binary”格式参考，却还不是与 C1/C2 等量的 validator。直接比较会把 C0 少做的业务检查当作性能优势。

最小准入条件：三个候选必须调用同一个独立 semantic validator，或实现经相同测试矩阵证明等价的 validator；计时按 parse、schema validation、normalization、hash 分阶段报告。C0 也必须覆盖安全整数、有限数、字段白名单、枚举、数组/字符串上限、互斥分支和 baseline descriptor。

### P0：消息域仍是 partial subset

九条 fixture 覆盖六种 category，但 gameplay 只覆盖当前空形状，action 只覆盖 `select-hotbar`。生产 `AuthorityAction` 的其余动作、非空 inventory、recipe、entity、break action，以及 status/outcome/reason 组合没有进入固定 schema。当前 schema 会主动拒绝其中一部分，而不是完成可逆编码。

最小准入条件：

1. 先冻结 N2 要比较的消息域。若只比较九条 partial fixture，报告标题、表格与选择结论都必须明确“partial CODEC9”，不得推导完整游戏 wire。
2. 若 N2 要支持选型，须补齐 input state/edge、pose、非空 gameplay、全部 Authority action 与 receipt status/outcome、完整 world/baseline 边界，并分别用真实受控 corpus 或明确标注的 structured synthetic 覆盖。
3. 三个候选使用完全相同的记录顺序、字段值、频率和 binary ownership；不支持项不能透传或计入成功样本。

## 三、P1 parser 与 schema 缺口

### C2 `double` 的有限性缺少完整 encode/decode 回归

C1 的 `Writer.f64()` 与 `Reader.f64()` 都显式拒绝非有限数。C2 decode 对 welcome、correction 和 gameplay 的现有 double 做了有限性检查，但 C2 encode 构造 message 前没有对所有这些字段执行同样检查；`proto.verify()` 主要验证 JS 类型，不能作为 `NaN`、`Infinity`、`-Infinity` 的业务有限性合同。

进入 N2 前应在 encode 和 decode 两端统一 finite validator，并为每类 double 字段注入 `NaN`、正负无穷的真实 protobuf wire。不能只测试一个 position 分量后外推到 world time、gameplay time 和 stats。

### C2 string、UTF-8 与数组累计上限不完整

C2 当前只对 welcome 的八个 string 做非空和 4096 UTF-8 byte 检查。correction 的 epoch/player id/revision key、gameplay player id、world structural/revision/delta key、receipt epoch/issuer/stream、baseline epoch/world/key/hash 都没有统一 string byte 上限或空值语义。数组多在 `toObject()` 后才检查单数组数量，也没有累计 string/element 预算。

进入 N2 前应：

- 复用一套 identifier/string validator，按 UTF-8 byte 计限并明确哪些字段可空；
- 增加 4096/4097 byte、多字节边界、非法 UTF-8 wire、512/513 项 string/revision/cell 列表和累计预算样本；
- 将当前 protobuf runtime 对非法 UTF-8 的行为固化成实际 parser 回归，不能只依据库内部实现推断。

### C2 oneof、未知字段与重复字段策略未冻结

`real-fixed-schema-validate.mjs:175-176` 按固定优先级从多个 payload 属性中选择 category，没有自行证明 wire 中恰好出现一个 payload。Protobuf parser 对未知字段会跳过；未来未知 oneof 与已知 payload 同时出现时，当前实现可能接受已知分支。重复 scalar 一般按最后一个值解释，重复 message/oneof 的覆盖语义也与 C1 的唯一固定字段不同。

进入 N2 前须明确 wire v1 的 canonical parser 策略：

- 顶层必须恰有一个已知 payload；未知 oneof 单独出现、未知 oneof 与已知 payload 同现的处理要有用例；
- 明确未知普通字段是为前向兼容保留，还是 v1 fail closed；不能由 runtime 默认行为暗中决定；
- 明确重复 scalar、重复相同 oneof 和多个不同 oneof 是拒绝、same-value 容忍还是 last-wins，并对相同值/不同值、两种字段顺序分别测试。

若选择严格拒绝，需在 `proto.decode()` 之前扫描 tag/field occurrence；仅检查转换后的对象无法恢复被覆盖或跳过的信息。

### C2 未知 category 的 encode fallback 不安全

`real-fixed-schema-validate.mjs:171` 的最终 `else` 把任何未被前序分支匹配的 category 当作 `chunk-baseline` 编码。当前 source 由已过滤 fixture 提供，因而没有触发现有 9/9 失败；作为独立候选入口时，未知 category 应在读取 baseline 字段前明确拒绝。

最小准入条件：encode 首先验证 category 白名单，baseline 使用显式 `record.category === 'chunk-baseline'` 分支，最终 `else` 只抛错。

## 四、C0 线格式核对

C0 确实是 UTF-8 JSON metadata 加长度前缀 raw block，不是旧的 base64 wire：

- `c0-raw-reference.mjs:16-21` 只把 category、metadata 和 block 名称写入 JSON；
- `c0-raw-reference.mjs:31-36` 把每个 binary block 的原始字节直接写入 frame；
- `c0-raw-reference.mjs:48-59` 解析 JSON 后以输入 buffer 的 `subarray()` 返回 raw block。

`c0-raw-validate.mjs:28` 中的 base64 仅用于把 decoded evidence 写入 JSON artifact，不属于传输帧。后续报告不得把证据文件的 base64 表示误写成 C0 wire 成本。

## 五、建议的最小修复顺序

1. **冻结范围和共同 semantic validator。** 明确 N2 是 partial CODEC9 还是完整消息域；让 C0/C1/C2 执行等价字段、枚举、整数、有限数、字符串、数组和互斥校验。
2. **先堵资源准入。** 为 C2 增加解码中预算，并为三者统一 frame、metadata、累计节点、累计字符串、数组、binary 与深度上限；用恶意 wire 取得功能 GREEN。
3. **统一 ownership 和 Reader。** 移除 C1 每 scalar/payload/raw 的额外复制，冻结 borrowed/copy 语义，并把必要 normalization copy 作为共同阶段。
4. **补 hash 完整性。** 三者对 decode 后 raw block 执行同一独立 SHA-256 校验，覆盖 bit flip 与 descriptor mismatch。
5. **冻结 Protobuf canonical/兼容策略。** 补 oneof、未知/重复字段、非法 UTF-8、字符串和 double 畸形矩阵；未知 category encode fail closed。
6. **重新取得无计时功能证据。** 完整记录三者对同一 corpus 和 synthetic 边界的逐项结果，保持 `wireStatus: not-adopted`。
7. **最后才运行 N2。** 预登记 parse、validate、normalize/copy、hash 与 end-to-end 阶段；Node encode/browser decode 和反向分开，固定所有权、频率、GC/暖机和输出使用方式。任何阶段不可量测时标 `NOT_COLLECTED`，不得填 0。

## 六、CODEC9 证据边界

可以继续引用：

- 当前九条 fixture 的 source identity 已绑定；
- C0/C1/C2 对这九条当前投影的 roundtrip/application oracle 为 GREEN；
- C1/C2 已覆盖记录中的安全整数边界和一组实际 parser mutations；
- C0 wire 是 JSON metadata + raw binary；C1/C2 是固定字段参考；三者都未采用为正式 wire。

不能据此宣称：

- 完整 Gameplay/AuthorityAction/receipt 状态域已经编码；
- C2 对资源放大、所有未知/重复 field、所有 string/UTF-8/double 畸形输入已 fail closed；
- 三个候选当前执行了等量 validation、copy 和 hash 工作；
- 9/9 代表浏览器互操作、网络传输、性能优势、wire v1 冻结或 codec 采用。
