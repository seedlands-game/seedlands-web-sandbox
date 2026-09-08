# WorldCommit 呈现 v2 参考投影进度

## RED → GREEN

- RED：`tests/server/network-reference-world-commit-presentation.test.ts` 先导入不存在的 `network-reference-world-commit-presentation` 模块；Vitest 在收集阶段明确报缺模块。
- GREEN：新增独立 `projectWorldCommitPresentationReference()`，不改 v1 投影、Host、浏览器入口或历史语料。定向 Node Vitest `6/6` 通过；新模块和测试的 Prettier、ESLint 与 `git diff --check` 通过。
- 追加 RED：稀疏 `meshChunks` 在旧实现会被 `map` 跳过而意外接受。用例以扩容制造 holes 后真实失败；实现改为逐索引密集数组门禁，现已 GREEN，覆盖结构 chunks/revisions、bounds 与 collision cells。

## 已投影的 v2 语义

`WorldCommitPresentationReference` 使用独立 kind `world-commit-presentation-reference` 和 `projectionVersion: 2`。它复制 epoch、publication commit 上界、显式 `causalCommitSequence: null`、committed/world revision 与 collision delta，并在 `structuralChange` 中保留：

- `presentationClass`：仅内部 `actorId === 'fluid-v2'` 映射为 `fluid`，其余均为 `default`；原 actor id 不输出。
- `mutationCount`、canonical `chunks`、完整 `meshChunks`、`chunkRevisions` 和 bounds。边界编辑的相邻 mesh key 不会被裁剪成 canonical 写入集合。
- 结构 chunks、meshChunks、chunkRevisions 与 collision delta 顶层都使用 512 项上限、唯一合法 canonical chunk key 和生产 `compareChunkKeys` 数值坐标排序；`chunkRevisions` 的 key 集合严格等于 chunks。每个 collision chunk 的 cells 保持现有每 Chunk `32³` 索引域，按 index 排序且拒绝重复/越界，未擅自把生产单 Chunk 写入上限压缩为 512。
- structural mutation 必须大于零、world revision 与顶层一致、每个 canonical chunk 必须也在 mesh 集合。bounds 使用签名安全整数、逐轴 `min <= max`；fluid 结构提交必须有 bounds。

所有数组、元组、collision cell 均重新构造；非法 key/revision、重复、超结构预算、非密集数组、倒置 bounds、v1 缺失字段及不一致 revision 均 fail closed。v2 不公开 metrics、semantic events、actor id、mesh payload 或 trace。

## 呈现接线状态

现有 `World.consumeServerCommit()` 仍只接受生产 `WorldCommitResult`，通过 `actorId` 判断 fluid/default。因此当前没有可把 v2 DTO 送入该入口的解码/适配层，也没有为测试复制新的 reducer。fluid/default 的 `interactive-fluid`/`interactive`、visible revision protection、0/48 ms 调度和反馈绑定的现有生产测试仍是字段来源；v2 到该入口的真实 adapter spy 为 `PENDING`，不能计为浏览器或接收应用证据。

本切片未采用 wire。v2 语料仅证明预算内投影来源；codec、计时、全仓静态和构建仍未由本切片运行。后续应以同一 corpus 做候选 codec/接收端强等价与应用验证。

## collision 值域补正与真实语料

独立审阅指出 collision cell 先前只校验非负安全整数，会错误接受 `voxel = 65536` 或 `fluid = 256`。新增两个 RED 反例后，v2 现在显式绑定 canonical `Uint16` 的 `0..65535` 与 fluid `Uint8` 的 `0..255`；旧 v1 未修改。该定向单元现为 `7/7` GREEN。

追加 RED：旧实现会把 key 按代码单元排序，并允许 collision delta 脱离本次 structural commit。新增 `-1/2/10` 顺序、未提交/缺结构、错误 key 或 revision、非连续 revision 与空 cells 的反例，旧逻辑真实 `3` 项失败；现实现复用生产 `compareChunkKeys`，且当 delta 存在时要求本次已 committed 且有 structural change、key 属于 chunks、revision 精确等于对应 chunk revision、`previousRevision + 1 === revision`、cells 非空。结构提交不强制附带 delta，以保留未来独立 baseline 重取路径。

旧目录 `/tmp/seedlands-network-world-commit-presentation-corpus-v2` 与 r2 均作为历史 generation 保留。r2 的编辑和流体提交直接调用 `GameServer`，没有经过 `AuthorityRuntime.recordWorldCommit()` 与 `session.commitExternalState()`，因此其 snapshot `commitSequence` 不能作为 record 的 publication 上界，不能纳入最终强等价输入。

最终语料写入新目录 `/tmp/seedlands-network-world-commit-presentation-corpus-v2-r5`；writer 对已存在的目标目录直接失败。普通编辑和水准备均走 `AuthorityRuntime.editWorld()`，真实 fluid lease 仍来自运行时所持 server，但 candidate 回写走 `AuthorityRuntime.commitFluidCandidate()`；没有手写 `actorId`。单次 Host 的实际 commit sequence 为普通 edit 前 `2`、普通 edit 后 `3`、水准备后 `4`、accepted fluid 后 `5`。两条输出都绑定最终上界 `5`；最终 snapshot world revision 为 `4`，不小于普通 commit 的 `2` 与 fluid commit 的 `4`。显式 source binding 包含 v2 projector、整数规范化、生产 Chunk comparator、体素常量、collector 与采集测试。

| 场景                       | class     | mutationCount | chunks  | meshChunks                           | bounds                 | content SHA-256                                                    |
| -------------------------- | --------- | ------------: | ------- | ------------------------------------ | ---------------------- | ------------------------------------------------------------------ |
| `ordinary-boundary-edit`   | `default` |             1 | `0,1,0` | `0,1,-1`、`0,1,0`、`1,1,-1`、`1,1,0` | `[31,33,0]..[31,33,0]` | `535441997ebd9476a7c5cf8ddb84debfc4b683da49b07d06adab6531e1304c30` |
| `accepted-fluid-candidate` | `fluid`   |             2 | `0,1,0` | `0,1,0`                              | `[4,48,4]..[4,49,4]`   | `2798e6b39c14aee2a0421f73f47dc2e4c99033e66a805feaa52b9cb1ee5e08a8` |

每条 metadata 的规范化生产 `WorldCommit` 输入 hash 与 v2 输出 hash 均在 provenance；collector 写盘后重读并与内存 `deepStrictEqual`，复核逐条 content hash、index、manifest payload/corpus hash、显式 source hash 与旧语料文件前后 hash。最终 r5 manifest payload SHA-256 为 `e2ebb8df882d11a5f2cc9e8080673ee23923a396a84014aac5402c2402a54f04`，corpus SHA-256 为 `38cddd331425344ab656ba252d5fcb72f8c499b0de15e24c45061f2308b092fd`。

新增 corpus test 的首个 RED 为缺少 collector 模块；最终 Node 定向 corpus `1/1` GREEN，v2 纯投影经最终修正为 `10/10` GREEN。仅运行定向单元/采集、Prettier、ESLint 与 diff check；未运行 codec、客户端 adapter、计时、全仓静态或构建。现有 `World.consumeServerCommit()` 仍没有 v2 接收适配，应用 spy 继续是 `PENDING`。512 仍只是参考表示上限：真实 Authority 至多可涉及 2,048 个 Chunk，正式接线还需定义分帧或 baseline resync，当前语料不宣称覆盖超预算提交。

## 最终集成修正

r3 已建立正确 Runtime 提交锚点，但实际采集运行时为 Node 26；r4 在 Node 22 重采后，完整类型检查暴露 projection 的可空闭包和字面量类型错误。两档均保留历史，不作为最终源码绑定。root 修正类型，并先以空 collisionDelta 的反例取得 RED，再允许显式空数组与省略字段同样表示没有碰撞写入。最终纯投影为 10 项；完整类型检查已通过。

r5 在源码格式化和类型检查后，以官方 Node 22.23.2 直接运行 Vitest，1/1 通过；测试现在显式拒绝非 Node 22 采集。当前六个显式 source hash 在进入 codec 前逐文件重核。三候选对两条 r5 记录及真实 Chrome 两个方向均通过，详情见 [呈现编解码证据](network-presentation-codec-evidence.json)；这仍不代表生产客户端适配或性能准出。
