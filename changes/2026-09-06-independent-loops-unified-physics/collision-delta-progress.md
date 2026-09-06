# 权威碰撞稀疏增量进度

## 冻结合同

所有带结构变化的 `WorldCommitResult` 可携带 `collisionDelta`：按 Chunk 给出 `key`、`previousRevision`、`revision`，以及真正改变格子的 `index`、最终 `voxel` 和最终原始 `fluid` 字节。单编辑、批编辑、玩法动作与接纳的流体 Worker 写入使用同一数据结构；纯语义或无变化提交不发送格子。

客户端仅在本地 `chunkRevision === previousRevision` 且 `revision` 等于结构事件所声明版本时应用。缺失增量、revision 缺口或非法 index 必须失效该 Chunk 碰撞缓存并请求新基线；迟到的旧 mesh 不得回滚更高版本的稀疏事实。字段保持可选以兼容同协议版本的旧测试夹具，生产结构提交必须提供。

## RED 与状态

- [x] 客户端连续应用、缺口失效、基线回拉和旧 mesh 不回滚用例已由 A7 提交覆盖。
- [x] 服务端三项 RED 已记录：单格、跨 Chunk 精确批量和流体候选均实际提交成功，但 `collisionDelta` 为 `undefined`，客户端只能失效缓存并等待完整 mesh。
- [x] 服务端已为单编辑、一般/唯一缓冲批量和流体候选生成精确 delta；体素编辑依据最终 sidecar 规则写入 `0x88 | 0`，流体候选直接采用 Worker 已验证的最终字节。
- [x] 服务端与客户端纯镜像定向 6 文件 54 项通过；源码/测试 TypeScript 与所改文件 ESLint 通过。
- [ ] 生产构建与真实浏览器即时碰撞回归由主任务在不可变 SHA 上执行。
