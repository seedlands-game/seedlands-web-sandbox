# 真实 Host 参考投影进度

## 目标与边界

本子任务只增加 codec 无关的公共参考投影和真实 Host fixture，为 N2 后续真实 corpus 做准备。`NetworkReferenceProjection` 明确不是最终 wire v1：不引入 transport、codec、鉴权、GUI 或 Node 监听，也不修改既有网络消息/codec 文件。

## 准出合同

1. `AuthoritySnapshot` 投影为独立 clone 的 player correction，保留 string epoch、signed `acknowledgedInputSequence`（含 `-1`）、physics/commit/world revision、浏览器环境消费的 `worldTime`、权威 body/grounded 与按 key 稳定排序的 collision revisions；不带当前浏览器未消费的 `worldMutationCount`、contacts 或 diagnostics。
2. `AuthorityGameplayView` 投影只保留 UI player/inventory/recipes 与实际可表现的 world-item/creature/npc（含 presenter 使用的 health/maxHealth）；每个 view 以 epoch、所属 snapshot physics/commit/world revision 锚定，供跨 stream 清理旧 epoch；不带 metrics、完整 actor state、player entity 或未白名单字段；浮点必须保持 f64 值。
3. `WorldCommitResult` 投影只保留所属 publication snapshot 的 `publicationCommitSequenceUpperBound`、`causalCommitSequence: null`、结构 Chunk revision 与允许的 collision delta；上界明确不是单个 commit 的精确因果索引，不得把 `worldRevision` 冒充 commit sequence，也不得泄漏 semantic event `data`、metrics 或 unknown 扩展数据。
4. 每项在真实 `DedicatedServerHost` + `MemoryGamePersistence` fixture 中取得 Authority runtime 的 snapshot/view/commit，并经过 `World.edit()` 生产路径触发 commit；结果不共享可变引用。
5. 投影器拒绝不支持 entity type/archetype、非有限坐标/速度、无效 cell、非法 revision 与未知/越界 inventory 映射；错误不返回部分 DTO。

## RED 设计

- `tests/server/network-reference-projection.test.ts` 先从尚不存在的 `src/server/protocol/network-reference-projection.ts` 导入投影器，证明测试在实现前不可解析。
- fixture 使用固定测试 seed、`DedicatedServerHost.create()` 与 `MemoryGamePersistence`，推进 runtime、通过 Host 的 `World.edit()` 产生真实 commit；不构造假 archetype/Chunk。
- 覆盖 `ack=-1` 初始 correction、已确认 input 后 correction、真实 gameplay entity 白名单、真实 commit/delta、独立 clone、diagnostics/metrics/actors/semantic data 排除与拒绝边界。

## 当前状态

- 已完成：字段合同已发 root；只读确认 AuthoritySnapshot、AuthorityGameplayView、WorldCommitResult 和浏览器消费者。
- 进行中：等待字段合同确认后写 RED 与生产投影。
- 已完成：change-local recorder 从同一真实 Host publication 构造 welcome/correction/gameplay/commit 的 metadata UTF-8 投影样本，并从 `readCollisionBaseline()` 保留完整 canonical/fluid 二进制块、typed length/revision 与注入的 SHA-256。welcome/baseline 均是 `wireStatus: not-adopted` reference；未提供实际 action receipt 时才记录 `NOT_COLLECTED`。它不是 wire encoder。
- 未开始：正式 recorder 落点、codec、wire v1、网络、GUI 和计时。

## 可复现 fixture 与无计时 codec 功能准备

- 显式 runner `pnpm exec vitest run --config changes/2026-09-06-node-dedicated-server/e2e/vitest.real-corpus.config.ts --no-file-parallelism --maxWorkers=1` 会原子替换 `/tmp/seedlands-network-real-corpus-v1`。固定 seed/输入、source commit（明确为 Git SHA-1）、tracked worktree diff SHA-256、config SHA-256 与 corpus SHA-256 都写入 `manifest.json`；每条 JSONL record 以 `manifestPayloadSha256` 显式继承该 provenance。
- `frames.jsonl` 有 welcome、初始 correction、initial gameplay、baseline、已 ack correction、更新 gameplay、真实 `World.edit()` commit，以及 select-hotbar 的成功和 invalid-slot 失败 receipt。baseline block 独立落在 `blocks/`；canonical 固定转换为 `uint16-le` 65,536 B，fluid 为 `uint8` 32,768 B。写盘时 metadata 与 sidecar 都重写为相同的 element type、byte order、byte length 和 sidecar SHA-256，避免把主机原始 buffer hash 冒充 LE bytes hash。
- `notCollected` 明列额外 entity/archetype、其他动作类别、baseline 分页/取消/压缩/重同步及 codec wire mutation；不能把本 fixture 冒充完整玩家旅程。
- Node 22 功能命令 `/tmp/seedlands-node-22/node-v22.23.2-darwin-arm64/bin/node /tmp/seedlands-network-probe-codec/real-fixture-validate.mjs` 读取该 fixture，写 `/tmp/seedlands-network-probe-codec/real-fixture-validation.json`。C0、C1、C2、MP 对同一 9 条真实投影 roundtrip 通过，并各自拒绝截断、trailing 与 oversize parser 输入。该 C1 是无 JSON 的 reference value-tree framing、C2 是 Protobuf envelope；尚非正式固定字段 C1/C2 wire schema，不能用于 N2 codec 采用或性能比较。oracle 只在 roundtrip 等价检查中，未运行 timing。

## RED 与实现记录

- RED：`pnpm exec vitest run tests/server/network-reference-projection.test.ts --no-file-parallelism --maxWorkers=1` 在投影模块不存在时失败，错误为找不到 `src/server/protocol/network-reference-projection`。
- GREEN：新增 `network-reference-projection-types.ts` 和 `network-reference-projection.ts`。`PlayerCorrectionReference` 带浏览器环境使用的 `worldTime`；`GameplayViewReference` 带 epoch 及同 publication snapshot 的 physics/commit/world revision 锚点；`WorldCommitReference` 只接受同一 publication 的 `{ epoch, publicationCommitSequenceUpperBound }` context，并以 `causalCommitSequence: null` 明示不能从中推导单个 commit 的精确序号。`GameplayViewReference` 保留 presenter 使用的 entity health/maxHealth、stack 与 archetype；省略 `spawnPosition`、world mutation count、metrics、actors、diagnostics、contacts、semantic events 和 unknown payload。新增 `network-reference-bootstrap*`：welcome 对 Host 未提供的 world/session/config 使用显式 context，校验字段与 limits 关系，只声明空 capability、`wireStatus: not-adopted`；baseline 只接受真实 available 结果、固定 cell 大小、复制 raw buffer 并经注入 digest 端口校验 SHA-256 格式。
- 真实 fixture：固定测试 seed 的 `DedicatedServerHost` 与 `MemoryGamePersistence` 生成 snapshot/view；commit 通过 `host.runtime.server.edit()` 的 `GameServer.edit()`→`World.edit()` 生产路径获得，再以 `commitHostActivation()` 取得同 publication 的 snapshot 上界。没有手写实体 archetype 或 Chunk。
- 当前验证：`pnpm exec vitest run tests/server/network-reference-projection.test.ts --no-file-parallelism --maxWorkers=1` 通过 7/7，覆盖真实 Host snapshot/view/World.edit、welcome context 与由 `runDedicatedComputeTask()` 得到后经 `acceptGeneratedChunk()`/`readCollisionBaseline()` 查询的 baseline；额外拒绝 player id 与 snapshot 不一致、非枚举频率及超越 snapshot 的虚假 durable checkpoint。change-local corpus runner 使用 `pnpm exec vitest run --config changes/2026-09-06-node-dedicated-server/e2e/vitest.real-corpus.config.ts --no-file-parallelism --maxWorkers=1`，通过 1/1：welcome、correction、gameplay、commit、baseline metadata/binary hash，以及由真实 `host.performAction(select-hotbar)` 与 `projectActionReceiptReference()` 得到的 receipt 均被捕获。长期 `tests/server` 不再导入 change recorder，避免 Delivered/Archived change 反向成为基线依赖。fixture sidecar 已明确为 `uint16-le`；这只是 corpus 存档格式，未成为网络字节序合同。N2/wire 仍须单独冻结并核验字节序。`pnpm exec tsc --noEmit` 通过；tests 类型检查当前仅被并行改动的 `tests/node/authority-lane-protocol.test.ts:99` readonly `entities` 赋值阻断。Prettier、ESLint 与 `git diff --check` 通过。未运行 coverage、benchmark、codec 或 transport。

## 固定字段 C1/C2 三类流量功能探针（未计时、非正式 wire）

本节替换旧的 value-tree C1 与 Protobuf envelope 作为后续探索的功能基线，但**不**冻结 wire v1，也不构成 N2 性能或采用结论。可重建原型为 `/tmp/seedlands-network-probe-codec/real-fixed-schema-validate.mjs`；它从 `/tmp/seedlands-network-real-corpus-v1` 读取已捕获的受控 fixture，使用 Node 22 仅执行保真和拒绝路径，写出 `/tmp/seedlands-network-probe-codec/real-fixed-schema-validation.json`。该原型可丢弃，下面的布局、范围和证据才是可审阅记录。

### 覆盖范围与等价边界

- 实测的是 5 条、3 类真实参考投影：两条 `player-correction`（初始 `acknowledgedInputSequence: -1` 与 ack 后 correction）、两条 `gameplay-view`、一条完整 `chunk-baseline`。每条都与相同 fixture 的 metadata 和原始 block 字节逐字节比较；比较 oracle 在编码/解码之外。
- 本轮**未覆盖** welcome、`world-commit`、成功 receipt、失败 receipt 四条记录，故不能称为 9 条 fixture 或完整玩家旅程的 schema 保真；它们不得混入 C1/C2 比较。
- 当前两条 gameplay 的真实值恰为 24 个 `null` inventory slot、`breakAction: null`、空 recipes、空 entities。C1/C2 都会拒绝非空 inventory、break action、recipe 或 entity，而非悄悄丢字段。因此该类只证明当前捕获形状，不证明通用 `GameplayViewReference`。

### C1：手写固定字段 schema binary

帧为 `SLR1` magic、`u8 schemaVersion=1`、`u8 category`、little-endian `u32 payloadLength` 与 payload。category 仅有 correction=1、gameplay=2、baseline=3；未知版本、未知 category、帧长度不一致、截断、尾随字节和超过 4 MiB 的帧均拒绝。

- correction 以长度前缀 UTF-8 string 保存 epoch/player id；tick/commit/world revision 和 collision revision 为 LE `u32`；ack 为 LE signed `i32`，允许 `-1`；position、velocity、world time 全为有限 LE `f64`，不量化；布尔值仅为 0/1。
- gameplay 保存同一 epoch/commit 锚点、四个有限 `f64` 生存数值和固定当前形状的 inventory count、selected/hotbar。它不是 value-tree，也没有 JSON/stringified envelope。
- baseline 保存 epoch/world/key/revision/generator、每个 block 的 element count、byte length、SHA-256 hex string 与独立 raw bytes。canonical block 的要求为 32,768 个 `uint16-le`、65,536 B；fluid 为 32,768 个 `uint8`、32,768 B。raw block 通过精确长度 framing，不能借剩余 payload 隐式延展。

### C2：直接字段 Protobuf message

原型的 `.proto` 摘要内嵌在同一可重建脚本：`Frame { version; oneof correction|gameplay|baseline }`，`Correction` 有直接的 scalar/vector/collision-revisions 字段，`Gameplay` 有直接的 anchor/player/stats/current-empty-shape 字段，`Baseline` 有嵌套 `Block { element_count, byte_length, sha256, bytes }`。所有浮点为 protobuf `double`（f64）；ack 为 `sint32`，所以 `-1` 可逆；epoch 等 identifier 是 string，不转成 numeric epoch。C2 不使用 JSON、value-tree 或“把全部 payload 放入 bytes/string”逃生封套。

C2 decode 先以 Protobuf parser 读取 Frame，再要求 version=1、恰有一个已知 oneof 分支、有限/固定长度 vector、可支持 gameplay shape 和精确 baseline 形状；否则拒绝。unknown version、无 oneof 分支（unknown category）、畸形 wire、截断、tag 0 尾随和超过 4 MiB 均是实际 parser 输入，不是共享 DTO validator 的替代。

### 本次功能证据

执行命令：

```text
/tmp/seedlands-node-22/node-v22.23.2-darwin-arm64/bin/node /tmp/seedlands-network-probe-codec/real-fixed-schema-validate.mjs
```

结果：C1 与 C2 各自对 5 条选定记录的完整 metadata/block roundtrip 通过；各自实际 decode parser 对 `truncation`、`trailing`、`oversize`、`corrupt`、`unknown-version`、`unknown-enum` 六类 mutation 均拒绝。此命令没有计时、没有采样、没有 codec 排名。下一步须先扩展到其余四条真实记录和非空 gameplay 形状，修复 fixture provenance/LE metadata 一致性后，才可讨论完整 N2 schema 对照。

## fixture provenance 与跨端序修正

审阅发现早期写盘虽将 canonical sidecar 转为 little-endian，却仍在 JSON metadata 中保留 `uint16-source-buffer` 与原 Host-buffer digest。这会让本机 little-endian 的偶合掩盖跨端序错误，不能作为 codec 语义输入。现已在 `writeFixture()` 修正：canonical metadata 与 binary index 均为 `uint16-le`/`little-endian`、65,536 B、sidecar 实算 SHA-256；fluid 均为 `uint8`/`not-applicable` 与 sidecar digest。测试读取实际 JSONL 和 block 文件交叉断言这两个 hash 一致。

`sourceSha256` 也已改为显式 `provenance.sourceState.commit`（`git-sha1`）与 `trackedWorktreeDiffSha256`，避免把 40 位 Git object id 误标为 SHA-256。`manifestPayloadSha256` 覆盖格式、生成器、provenance 和 record index；每条 JSONL record 写 `{ manifest: "manifest.json", manifestPayloadSha256 }`，所以其 source/config 继承关系可复核而不制造自指 hash。测试严格断言固定九条记录、类别顺序、二次写盘后的 manifest/JSONL/two sidecars byte-identical。该确定性只针对同一 checkout 状态与受控 fixture，不代表跨版本 corpus 相同。

第三轮 provenance 校正：每条 record 现在带 `metadataSha256` 与覆盖 `{ frameId, category, metadata, binary, metadataSha256 }` 的 `contentSha256`；同一内容 hash 进入 `manifestPayload.records`，所以 `manifestPayloadSha256` 会随任一记录 metadata 或 binary descriptor 改变。写盘后的测试逐条重算这两种 hash。`sourceState` 也列出受限源码路径（`src`、`tests`、当前 change）中所有未跟踪文件的 path/SHA-256；不扫描或读取 `.env`。fluid binary index 现在同样明确 `byteOrder: not-applicable`，与 metadata 对齐。

给 reference receiver 的临时适配输出为 `/tmp/seedlands-network-probe-codec/real-fixed-schema-decoded-fixture.json`：按 fixture 九条原顺序，为 C1/C2 分别给出 `records`。当前 C1/C2 真正解码的五条记录标 `DECODED`，带 metadata 与 `binary` base64（baseline 是已存档的 LE bytes）；welcome、world-commit 和两条 action receipt 明确标为 `NOT_SUPPORTED`，没有将 JSONL payload 透传伪装成 codec decode。该适配输出仍是 `/tmp` 探针证据，不是生产依赖或正式 wire。

## 九条固定字段 schema 扩展的未冻结草图

下一版 C1 与 C2 使用相同的真实 reference DTO 判别值，不把任意对象塞入 JSON/string/`bytes` payload：顶层 category 为 welcome、player-correction、gameplay-view、world-commit、chunk-baseline、action-receipt；C1 以固定顺序字段和可选字段 presence bit 写入，C2 以同名 direct Protobuf message/oneof 写入。所有 `epoch`/session/world/entity/recipe/item/chunk key 都是长度受限 UTF-8 string；所有 time/health/position/velocity/damage/elapsed/required 值为有限 f64；序号、revision、slot、cell/voxel/fluid 为有界整数；ack 单独使用 signed i32 允许 `-1`。

- welcome：checkpoint（含 durable `-1`）、frequency enum（physics 30/60/120、gameplay 10/20、fluid 20/30）、已实现的 empty capability list、limits、seed/schema versions，未知 version/enum/capability 均拒绝。
- gameplay：每 inventory slot 有 presence bit 与 `{ slot,itemId,count }`；`breakAction` 有 presence bit 与 position/voxel/f64 时长；entity type enum 仅 world-item/creature/npc，archetype enum 仅 grazer/night-stalker/settler，stack 只允许 world-item，health/maxHealth 是独立 optional 字段。当前 corpus 的空数组不再作为 schema 特例；非空回归仅用结构化 synthetic 标记，绝不混成真实 Host corpus。
- world commit：`causalCommitSequence` 固定 null，不能被编码为伪精确序号；structural change 和每个 collision delta 都有 presence/count，cell 逐项保留 index/voxel/fluid 与 previous/revision。
- receipt：事务 status enum 为 conflict/expired/capacity/executed；executed action type enum 与真实 `AuthorityAction` 的 select-hotbar/cancel-break/respawn/craft/begin-break/attack/place/move-inventory/use-inventory 对应，outcome success/failure 及 allowlisted reason 是各 action 的固定分支。当前真实 corpus 只含 select-hotbar success/invalid-slot，其他 action 只能作为 synthetic validator 边界。

本节是待实现的 reference-probe schema 摘要，`wireStatus: not-adopted` 仍成立；没有把它当成正式协议冻结或 N2 完成。

## WelcomeReference 固定字段 6/9 闭环（无计时）

C1/C2 已加入完整 `welcome` 分支，adapter 现为每种 codec **6 `DECODED` / 3 `NOT_SUPPORTED`**。C1 是 `SLR1` reference frame 内固定顺序字段；C2 的 `Frame.oneof` 新增 direct-field `Welcome` Protobuf message。两者都保留 epoch/serverEpoch/sessionId/worldId/playerId、seed/seedText、generator/protocol/content/schema versions、有限 f64 worldTime、三种 frequency、十项 limits、initial checkpoint（durable 使用 signed integer）及空 capability list；没有 JSON/value-tree/bytes envelope。

Node 22 功能命令再次验证 6 条选定真实记录完整 metadata 与 baseline raw bytes 保真。welcome 的 C1/C2 实际 parser 都拒绝伪造 frequency=31 和截断 length；既有版本、unknown enum、corrupt、trailing、oversize mutation 仍拒绝。更新后的 `/tmp/seedlands-network-probe-codec/real-fixed-schema-decoded-fixture.json` 含 source corpus identity，000 welcome 为 `DECODED`；006 world-commit、007/008 action-receipt 仍明确 `NOT_SUPPORTED`。无 timing、wire v1 adoption 或性能结论。

当前 C1/C2 的 tick/commit/revision/ack 仍是 v1 探针的 u32/i32 范围，尚未代表生产允许的完整 safe-integer 域；下轮须统一升级为 C1 u64（或受检 f64）与 C2 uint64/sint64 并验证 `2^31`、`2^32`、`Number.MAX_SAFE_INTEGER`，否则必须保持 compatibility gap 而不能称完整等价。

## WorldCommitReference 固定字段 7/9 闭环（无计时）

C1 与 C2 已加入 `world-commit`：保存 epoch、`publicationCommitSequenceUpperBound`、显式 `causalCommitSequence: null` 标记、committed/world revision、optional structural change（chunks 与 chunk revisions）和每个 collision delta 的 key/previous revision/revision/cells。它不会把 publication upper bound 伪装成单 commit 的精确因果序号。C1 对 count、cell index、voxel、fluid 保持上限；C2 `WorldCommit`/`Structural`/`Delta`/`Cell` 是 direct-field Protobuf message，不含 JSON 或 values envelope。

Node 22 对 corpus 七条 C1/C2 强等价通过；额外 structured synthetic multi-delta（两个 structural chunks、两个 delta、三个 cells）两 codec roundtrip 通过，且该 synthetic 不计入真实 Host corpus。adapter 现为每 codec 7 `DECODED` / 2 `NOT_SUPPORTED`；只余两条 receipt。既有实际 parser 的 version/enum/corrupt/truncation/trailing/oversize mutation 仍通过。本轮未计时，未采用 wire。

## select-hotbar ActionReceiptReference 固定字段 9/9 闭环（无计时）

C1/C2 已解码当前两条真实 `action-receipt`。字段包含 transaction `{ epoch, issuer, stream, sequence }`、`durableCommitSequence: null`、executed status、select-hotbar action enum/slot、executed commit、gameplay revision、完整 committed world revisions，以及 success 与 `invalid-slot` failure 的互斥 outcome。C2 使用 direct-field `Receipt` Protobuf message；C1 以固定 status/action/reason enum 写入。未知 result 没有进入任何 payload。

Node 22 现对 fixture 全部九条逐条 metadata 与 baseline raw byte 强等价：C1=9/9、C2=9/9，adapter `/tmp/seedlands-network-probe-codec/real-fixed-schema-decoded-fixture.json` 也为两 codec 各九条 `DECODED`、零条 `NOT_SUPPORTED`。receipt 的 C1/C2 实际 parser 都拒绝非法 status/action/reason enum 与缺字段。当前支持只覆盖真实 corpus 的 select-hotbar；其余八种 `AuthorityAction` 仍是未支持消息域，阻断全消息域采用，但不影响这九条 corpus 的 application oracle。无 timing、wire adoption 或性能结论。

## safe-integer 计数域兼容（无计时）

C1 的 physics tick、commit/world/gameplay/chunk revision、action stream sequence、receipt revisions、welcome checkpoint/durable 与 correction ack 已从 u32/i32 改为受检 finite f64：编码和解码都要求 `Number.isSafeInteger`；普通域最小值为 0，ack/durable 最小值为 -1。C2 对相同字段使用 `uint64`/`sint64`，Protobuf decode 先转 Number 再作同一 safe-integer/下界检查；encoder 也在消息构造前验证。slot、count、cell/voxel/fluid、schema version 和 seed 等本轮仍是原有有界 u32 域。

Node 22 验证仍为 C1/C2 真实 corpus 9/9 强等价。structured synthetic 正例覆盖 `2^31`、`2^32`、`Number.MAX_SAFE_INTEGER`，分别落在 correction、gameplay、welcome checkpoint、baseline chunk revision、receipt sequence/commit/gameplay/world revisions；两 codec 全部可逆。encoder 拒绝 `MAX_SAFE_INTEGER + 1` 与小于 -1 ack；实际 parser 输入也分别拒绝超 MAX_SAFE physics tick 与 -2 ack。adapter 已刷新，仍为各 codec 九条 `DECODED`。没有 timing 或协议采用。

## 跨消息计数 actual-parser mutation 回归

除 correction 的超界 tick/-2 ack 外，现已对已编码 wire 逐字段改写并调用 C1/C2 decode：correction commit/world revision、baseline chunk revision、welcome checkpoint commit、receipt sequence/executed commit/gameplay revision/committed world revision。每项都分别注入 `MAX_SAFE_INTEGER + 1` 与非法负数；C1 改写相应 f64 field，C2 改写对应 uint64 field 后重编码。两 codec 的真实 parser 全部拒绝，且正常高值 synthetic 与真实九条 roundtrip 仍通过。receipt world revision 的正反例使用仅为该字段存在性而构造的 structured synthetic receipt，不计作真实 corpus。

## Inventory/recipes 固定字段 GREEN（无计时）

C1/C2 inventory 与 recipes 的共享限制已统一为 inventory 128、recipes 512、UTF-8 string 4,096 bytes。真实九条、非空 structured synthetic（null、多 item、中文 UTF-8 itemId、多 recipe、u32 最大 count）及两 codec 参考 validator/ownership/hash 独立阶段均通过。C1 实际 frame mutation 拒绝 inventory count=129、recipe count=513、以及直接 splice 为 4,097-byte itemId/recipe 的帧；C2 direct Protobuf wire 的 inventory=129、recipes=513、4,097-byte itemId/recipe 都由 preflight 在 object decoder 前拒绝（spy=0）。adapter 已由同一 runner 刷新，仍为两 codec 九条 `DECODED`。entities 仍为空、breakAction 仍为 null，未在本步扩展。

## gameplay entities/breakAction 与完整 receipt 扩展 RED

开始新 `/tmp` 原型前已记录现有 RED：codec 仅接受空 entities、`breakAction: null` 及 select-hotbar executed receipt；非空 gameplay 和其余 AuthorityAction 在 encode 被明确拒绝。共享 reference validator 已有这些字段/枚举，此 RED 不是生产 DTO 缺失。后续只使用 structured synthetic 矩阵，不修改原九条真实 Host corpus，也不会把 synthetic 标为真实流量。

## 六类出站消息的共同链路扩展 GREEN（2026-09-07）

上述非空 gameplay/完整 receipt 的 RED 已在可丢弃参考实现中解除。C1/C2 现支持 world-item、grazer、night-stalker、settler，entity optional 的缺省/显式值、null/非空 breakAction。实际 wire 的 entity count 513 在 C1 decoder、C2 preflight 拒绝；C2 object decoder spy 为 0。

独立审计随后发现 C2 `has_* = false` 却携带字段的 wire 会被归一化并丢失隐含值。修复为在 raw protobuf message 转换 defaults 之前检查实际字段 presence；false+payload、true+missing 均不得交付，显式 health/maxHealth=0 保留。此修复针对 optional 分支，不能据此外推所有 protobuf scalar wire 域已经核验。

完整 receipt 参考覆盖九种 action 的成功与 31 种合法失败、三种非执行状态、六组 MAX_SAFE 边界。slot/source/target 和 position 保留生产参考的安全整数域，未收窄为 u32。强等价采用结构比较，不以 JSON 对象键顺序为业务语义。

Node 22.23.2 三候选同一 pipeline 已通过 **9 条 real Host + 50 条 structured synthetic，各 59/59**。Chrome 152.0.7977.76 headless 的 Node→browser 与 browser→Node 各 59/59 也通过；该浏览器运行 UTC 为 2026-09-07T02:56:21.074Z。所有 synthetic 单独带 provenance，不改写原真实 corpus 的 hash、source 或顺序。

这仍只覆盖六类已定义出站参考，输入/edge、动作请求、独立 pose 与实际 HUD/实体消费尚未完整接入。HTTP loopback 运送 fixture 不证明游戏 transport；没有 N2 性能数值、正式 wire 或 GUI 采用结论。共同 validator/资源预检、源 hash 与更新后的复验见[本批共同链路记录](network-shared-validation-progress.md)。
