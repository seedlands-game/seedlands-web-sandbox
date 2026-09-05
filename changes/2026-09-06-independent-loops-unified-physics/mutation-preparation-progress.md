# Authority 写事务异步 Chunk 准备进度

## 内部合同

浏览器 Authority 的任何体素写事务在进入短原子提交前，必须先对全部目标 Chunk 完成持久化可用性确认。已驻留直接继续；已持久化但缓存未命中的 Chunk 先异步加载并恢复 canonical；确认耐久 missing 后才向现有 General Worker 请求确定性生成，并等待 `accept-generated-chunk` 接纳。准备期间物理时钟继续推进，提交阶段不 `await`，也不在 Authority Worker 内调用 `makeChunk`。

同 key 的并发准备合并；等待有界，失败返回可重试的 `chunk-unavailable`，不扣库存、不改变已有 canonical 或持久化内容。无异步 Worker 端口的纯 Headless `GameServer` 保留同步确定性生成适配。

## RED 与状态

- [x] 已新增远端单格 World edit RED：当前调用同步生成，General 请求未发出且 resident 从 0 变 1。
- [x] 已新增持久化编辑 → 原子保存 → canonical 驱逐 → direct edit RED：当前缓存 miss 被误作耐久 missing，旧 Stone 被基础世界覆盖。
- [x] 已新增远端 `set-block` 命令 RED：当前命令在 Authority 热路径同步生成目标 Chunk。
- [x] 已实现统一异步准备、同 key 合并、5 秒超时失败与 General Worker 独立 canonical 生成；计算任务只返回 canonical，不提前构造 Mesh。
- [x] `BrowserWorkerSession` 已把 `authority-chunk-needed` 路由到 General lane，并通过既有 `accept-generated-chunk` 接纳；同 key 在客户端也只保留一个在途生成。
- [x] 已把旧同步测试调用迁移为 `await`，并验证异步准备时物理 tick 继续增长、库存只在一次成功提交后扣减。
- [x] Headless 命令适配会在等待同一 Authority 事务时并行清空 General canonical 请求；不再等 5 秒失败后才加载 Chunk，且已缓存 key 被 canonical 驱逐后会重新准备。

## 驱逐后物理回载竞态

真实浏览器跨 300 个 Chunk 往返的预置用例在 `4cf5cea` 不可变生产包得到 RED：起点 Lantern 编辑已完成保存 ACK，最远处驻留收敛到 256；返回后客户端与 Authority `inspect-voxel` 都读到 Air，目标 Chunk revision 回到 0。原因是物理 unknown 直接请求 General Worker 的 procedural canonical，可能早于 Persistence Worker 回载已保存 revision 1；revision 0 一旦先驻留，后续网格准备便不会再消费耐久快照。

新增正式反例要求物理查询已保存但已驱逐的 Chunk 时，必须先完成 Worker 内持久化预检；命中耐久快照不得请求 procedural，读取失败不得伪装成 missing，同 key 并发观察只允许一个预检。生产修复前定向运行 5 项中 1 项 RED，实际为目标 baseline 持续 `unavailable`。修复把所有 Authority unknown 统一路由到有界、合并的持久化优先准备；只有明确 missing 才请求 General Worker，迟到 revision 0 仍由现有接纳版本检查拒绝。

`d65b2b5` 不可变生产包的真实浏览器往返用例 1 项通过，用时 27.34 秒。Medium 路径请求 300 个 Chunk；最远处 canonical 驻留为 256、累计驱逐 44、拒绝接纳 0，返程累计驱逐 88。IndexedDB 精确记录 `[worldId,0,1,0]` 在出发、最远处、返程和重载后始终为 revision 1、`procedural-diff-v1`，checksum 始终为 `4167765130`；返程客户端为 Lantern/revision 1，Authority `inspect-voxel` 同为 Lantern，重载后两者仍一致。原始 Playwright JSON 为 `/tmp/canonical-d65-run-2.json`。

- [x] 定向 Vitest：7 个文件 24 项通过；`tsc -p tsconfig.test.json --noEmit` 通过；`pnpm build` 通过；`git diff --check` 通过。
- [ ] 真实浏览器 direct edit、长穿越、保存后重载证据由 root 在不可变生产构建中执行。
