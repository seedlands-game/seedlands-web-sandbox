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
- [x] 定向 Vitest：7 个文件 24 项通过；`tsc -p tsconfig.test.json --noEmit` 通过；`pnpm build` 通过；`git diff --check` 通过。
- [ ] 真实浏览器 direct edit、长穿越、保存后重载证据由 root 在不可变生产构建中执行。
