# Web↔Node 本机单人闭环交付快照

## 完成状态

实现工作完成，最终产品源码为 `21d210b`，完整真实旅程 source binding 为其直接父提交 `4cf859db1f1edf882a0f2f672852f7bd57ea93e7`。真实浏览器已完成认证连接、完整脚下 3×3 首屏、移动/转向/跳跃、挖块/拾取/放块、durable 保存、关闭页面后 Node 继续、手动重连和 Node 重启恢复。最后一个提交只让 9 个已 postrender 合法空网格无需等待非空 first-visible，定向 RED/GREEN、typecheck 和 ESLint 已通过。正常 60Hz 输入经单一在途/latest 背压发送，首屏必需 key 在单 Worker 下优先于其余未开始的 streaming 请求。M3 只剩 root 将最终独立报告与 CI 终态写入并把草稿 PR 转交人类审核。

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
- `f1d9116`：冻结真实 WebSocket burst 测试时钟。
- `f33f541`：补充不含口令的浏览器连接失败诊断。
- `7da861a`：正常远端输入单一在途/latest 背压。
- `9ef0982`：旧输入回执不解锁新代际。
- `4cf859d`：脚下 3×3 首屏请求优先及只读队列诊断。
- `21d210b`：全空远端首屏按必需网格 postrender 结算。

## 变更

- Node CLI 增加显式 loopback/Origin/口令网络入口；单玩家连接通过受限二进制实验协议消费同一 Authority。
- Web 启动页支持本地/Node 双模式；远端只保留输入、预测、派生镜像、Worker mesh 与渲染，不持有 canonical writer 或浏览器存档写者。
- baseline/commit/action/input/checkpoint 均绑定 epoch、sequence/revision 和有界资源；断线取消、迟到结果、重同步、反压与失败连接不会终止世界。
- 正常输入采样至多一条网络/Authority 输入在途，并只保留最新状态；首屏 9 个必需网格原位提升优先级，合法空网格、高度边界和后续全半径流送保持有效。
- 菜单显示只读 Node 地址和 seed，明确网页关闭后世界继续、存档位于 Node；离开等待 durable 保存，断线可回主菜单手动重连。
- README 中英文、代码地图、当前 spec 和 CI Chromium job 已更新；长期 baseline 更新是因为双模式产品入口和 Node 本机运行命令已成为实际接线。正式公网网络与性能路线没有晋升。

## 验证结果

`4cf859d` 的 source-bound `pnpm test:web-node-playable` 为 11 文件 32 项 Vitest + 1 项真实 Chromium 全绿；同源码的 `pnpm verify:static:ci`（245 文件、1245 项通过）、`pnpm build:web`、`pnpm build:server`、`pnpm verify:node-isolation`、`pnpm verify:web-node-playable-dist` 与既有 15 项 Chromium regression 均退出 0。最终 `21d210b` 的全空首屏 delta 另有 3 文件 22 项、typecheck 与 ESLint 全绿，最新 CI 由 root 收口。完整数值、日志摘要、source/hash 绑定和原始帧清单见 `execution.md` 与 `evidence/`。

## 限制

只支持 loopback、单世界、单玩家与手动重连；没有 TLS/WSS、公网/局域网部署、账户、多玩家、自动恢复或浏览器存档导入。实验 C0/WebSocket 接口不代表正式协议采用或性能结论。只有收到 checkpoint receipt 的状态具备 durable 承诺。

## 剩余工作

root 需提交其最终独立验收报告和 CI 终态，确认 draft PR #17 可转为 ready-for-review。PR #15 的冲突与 main 整合由用户在另一台设备处理；本任务不修改 #15，#17 保持现有 base。不得自动合并。
