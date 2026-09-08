# Web↔Node 本机单人闭环交付快照

## 完成状态

实现工作完成，冻结产品源码与真实旅程 source binding 为 `ae8a49fd9f43c1e29b59a518e35473205eff3b08`。真实浏览器已完成认证连接、完整首屏、移动/转向/跳跃、挖块/拾取/放块、durable 保存、关闭页面后 Node 继续、手动重连和 Node 重启恢复。后续只修正了真实 WebSocket burst 测试的时钟确定性，没有修改产品限额或运行逻辑。M3 只剩 root 将独立报告与最终 CI 终态写入并把草稿 PR 转交人类审核。

## 提交和推送

稳定阶段均已推送到 `origin/codex/web-node-playable`：

- `6b9b949`：可执行 RED 与公开边界。
- `b6ab3e0`：有界本机 Node transport。
- `4719842`：Web 远端 Authority 与真实首帧。
- `51e97fa`：完整远端游玩、保存与重连。
- `ef71bfb`：证据 source binding。
- `7191c06`：真实 WS 负向和无连接 tick。
- `e1d7ab3`：异步 session 工作有界。
- `331fea0`：真实分页/cancel/input 与完整脚下区域。
- `ae8a49f`：精确层边界和可照抄启动说明。

## 变更

- Node CLI 增加显式 loopback/Origin/口令网络入口；单玩家连接通过受限二进制实验协议消费同一 Authority。
- Web 启动页支持本地/Node 双模式；远端只保留输入、预测、派生镜像、Worker mesh 与渲染，不持有 canonical writer 或浏览器存档写者。
- baseline/commit/action/input/checkpoint 均绑定 epoch、sequence/revision 和有界资源；断线取消、迟到结果、重同步、反压与失败连接不会终止世界。
- 菜单显示只读 Node 地址和 seed，明确网页关闭后世界继续、存档位于 Node；离开等待 durable 保存，断线可回主菜单手动重连。
- README 中英文、代码地图、当前 spec 和 CI Chromium job 已更新；长期 baseline 更新是因为双模式产品入口和 Node 本机运行命令已成为实际接线。正式公网网络与性能路线没有晋升。

## 验证结果

最终 source-bound `pnpm test:web-node-playable` 为 10 文件 23 项 Vitest + 1 项真实 Chromium 全绿。`pnpm verify:static:ci`、`pnpm build:web`、`pnpm build:server`、`pnpm verify:node-isolation`、`pnpm verify:web-node-playable-dist` 与既有 15 项 Chromium regression 均退出 0。完整数值、日志摘要、source/hash 绑定和原始帧清单见 `execution.md` 与 `evidence/`。

## 限制

只支持 loopback、单世界、单玩家与手动重连；没有 TLS/WSS、公网/局域网部署、账户、多玩家、自动恢复或浏览器存档导入。实验 C0/WebSocket 接口不代表正式协议采用或性能结论。只有收到 checkpoint receipt 的状态具备 durable 承诺。

## 剩余工作

root 需提交其独立验收报告和最终 CI 终态，确认 draft PR #17 可转为 ready-for-review；PR #15 未合并前继续以 `codex/node-monorepo` 为 base。不得自动合并。
