# 流体、持久化与跨 Chunk 集成后专项复核

## 结论

本轮先以只读方式发现 2 项 P1，随后按主任务授权建立 RED 并完成修复。修复后的 focused 测试、ESLint、TypeScript 与 diff check 通过；当前未发现剩余 P0/P1。现有持久化校验、脏 Chunk 驱逐保护、多源回退和 worker-first 边界续流没有发现新的 P0/P1。

## 已修复 P1：自然水在权威重网格后会缩成最低水位

### 证据

- `GameServer.getChunk()` 的新生成分支把 `fluid` 初始化为全零；`acceptWorkerCanonical()` 首次接受 worker canonical 时同样写入全零 sidecar：`src/server/game-server.ts:142-154`、`src/server/game-server.ts:258-270`。
- `createProceduralMeshInput()` 只在 `fluid` 缺失时才从 Water 生成 `0x88`；只要传入全零 sidecar，就直接复制零值：`src/world/mesh.ts:162-164`。
- `meshChunk()` 对已存在 sidecar 中的零值执行 `Math.max(1, level)`，所以自然 Water 被解释为 level 1，而不是兼容源 level 8：`src/world/mesh.ts:266-274`。
- runtime 的读取路径把“Water 且 sidecar 无 cell”临时解释为 level 8 source，但 source 分支不会把该兼容值回写 sidecar：`src/server/fluid/voxel-fluid-runtime.ts:82-107`。

### 影响

自然河流或湖泊首次 worker 网格可能因 worker 内部 fallback 正常显示；一旦编辑触发权威 main snapshot/重网格，同一水体可能从满水降为 `1/8`，造成明显视觉跳变及几何不一致。该问题同时影响 main-snapshot 新 Chunk 与 worker-first canonical 接纳路径。

### 最小修复与验证

新生成 canonical 和首次接受 worker canonical 时均应使用 `legacyFluid(voxels)` 初始化 Water 为 `0x88`，空气/固体保持零。新增测试应对同一自然 Water Chunk 比较首次 worker mesh 与后续权威重网格的水面高度和 sidecar，二者都应为 level 8 / `7/8` 暴露高度。

## 已修复 P1：队列满时活动窗口激活会静默丢失，可能永久停流

### 证据

- 活动队列和清理队列分别限制为 8192；达到容量后 `enqueue()` / `enqueueCleanup()` 直接返回，没有溢出标记或重试：`src/server/fluid/voxel-fluid-runtime.ts:142-156`。
- `setFluidActiveChunks()` 对已经存在的新窗口 Chunk 只执行一次激活：`src/server/game-server.ts:303-307`。
- 每个加载 Chunk 会扫描全部 Water，并扫描六个边界面的外邻水：`src/server/fluid/fluid-cell-state.ts:70-94`。多个含自然水的 Chunk 可在一次窗口更新中快速消耗队列容量。
- 队列随后即使排空，也没有记录“本次 Chunk 激活未完全入队”。若这些 Chunk 已经加载完成，worker canonical 到达回调不会再次发生；玩家不再跨越 streaming center 时，水体不会自动重激活。

### 影响

水域密集世界或快速切换 streaming 窗口时，用户新放置的源、恢复中的非源水或边界续流可能被容量门槛丢弃，并停滞到下一次窗口变化或邻近编辑。每 tick 工作仍有界，但当前容量策略不保证最终公平。

### 最小修复与验证

队列满时应保留有界的 Chunk 级待激活标记，队列出现空间后按轮转顺序继续扫描；或让 `activate()` 返回是否完整入队，由活动窗口维护去重的待重试 Chunk。测试应先填满队列，再切换到包含既有流水的窗口；无需再次移动玩家，旧工作排空后该流水必须继续收敛。

## 已核查且未发现 P0/P1 的路径

- **驱逐与保存：** `evictChunk()` 在删除前保存脏 Chunk，并用对象身份、访问 epoch、revision、dirty 和 persisted revision 二次校验异步期间的变化；证据见 `src/server/game-server.ts:400-433`。
- **sidecar 完整性：** 存储记录带 `fluidVersion: 1` 和独立 CRC32；缺少全部流体字段的旧记录明确返回 `undefined`，随后由 `legacyFluid()` 恢复旧 Water 源；证据见 `src/world/chunk-snapshot-codec.ts:185-203` 与 `src/server/game-server.ts:128-141`。
- **源移除与多源：** cleanup 遇到 source 不删除并重新激活该源；其他非源水可能短暂清空后由幸存源重铺，但没有发现永久删除幸存 source 的路径；证据见 `src/server/fluid/voxel-fluid-runtime.ts:56-70`。
- **固定预算：** 单次最多补算 8 步、每步合计处理 128 个 cleanup/active 位置，工作量有硬上限；cleanup 优先可能造成最多一个有限队列长度的延迟。持续外部删除可造成活跃队列延迟，但不构成本次已证明的 P0/P1。
- **跨 Chunk 到达：** main snapshot、恢复和 worker-first canonical 均会激活新 Chunk 水体及边界外已加载水；已有 focused 测试验证 worker canonical 到达后无需移动 stream center 即可续流。

## 次要风险

- 队列使用 `Array.shift()`，在 8192 上限下存在额外搬移成本；属于需用真实性能采样确认的 P2，不据此修改。
- 流体 sidecar 语义校验只约束低四位水位范围，没有拒绝未知高位；CRC 可证明字节未损坏，但不能证明未来位语义兼容。当前唯一高位是 source 标志，建议后续版本校验保留位。
- 水位 sidecar 以完整 32 KiB 随每个快照保存，正确但可能增加存储写放大；需结合实际 corpus 指标评估，不构成功能阻塞。

## 修复后证据

- `tests/server/voxel-fluid-runtime.test.ts` 先得到两项 RED：worker canonical Water 的权威 sidecar 实际为 0；队列饱和后目标非源水推进仍未回退。
- 新生成与 worker canonical 路径现在用 `legacyFluid()` 初始化自然 Water。
- 新增 `FluidChunkActivationQueue`：仅保留活动窗口内去重 Chunk 任务；每次 `advanceFluid()` 最多扫描 2048 个位置；任务保存 cursor，并轮转起点。重复同步仍在窗口的 Chunk 不会重置 cursor，队列满时当前位置不前移，下一轮继续重试。边界面优先扫描，worker-first 到达后可恢复相邻 Chunk 的暂停水流。
- 最终 focused 4 文件 31 项通过；`pnpm lint`、`pnpm exec tsc --noEmit`、`git diff --check` 通过。
