# 碰撞镜像基线进度

## 内部合同

客户端只能按 Authority 快照中的 active Chunk key 与最低 revision 请求碰撞基线。Authority 只复制已驻留且 revision 足够新的 canonical 与 fluid；缺失或落后时返回 `unavailable`，不得加载持久层、生成世界、增加 mesh pin 或改变 canonical 驻留状态。可用结果通过现有 Authority Worker 回执并转移两个 buffer。

## RED 与状态

- [x] 已新增只读端口 RED：当前 `AuthorityRuntime` 不存在 `readCollisionBaseline`。
- [x] 已实现 GameServer 只读副本、Authority Runtime 与 Worker 传输接线；可用回执转移 canonical 与 fluid buffer，缺失或 revision 落后时明确返回 `unavailable`。
- [x] Vitest：2 个文件 4 项通过；目标 ESLint、测试 TypeScript、`pnpm build` 与 `git diff --check` 通过。
