# Web↔Node 本机单人闭环交付快照

## 完成状态

最新 `8a5b40a` 干净源码已取得真实本机旅程：认证连接、脚下 3×3 首屏、移动/转向/跳跃、挖块/拾取/放块、durable 保存、关闭页面后 Node 继续、手动重连和 Node 重启恢复。34 项 source input 全部匹配，五张原始帧已更新；停止与重启读取 durableCommitSequence 均为1074，三个连接均回读实际 WebGL2/ANGLE Metal 图形身份。证据保存于 `bee9a47`。

状态仍为 Active，尚未 Delivered。Linux 默认图形配置下的首次同步超时仍未准出；固定 AAABBA 实验中四个连续绘制 A 均在约8–11秒完成，按预注册停止线不采用 `autoRender` 候选。CI34222361251 的默认配置三次均在首屏失败；显式 SwiftShader 配置通过首屏和 Pointer Lock，但 W 移动5秒权威位移仅0.01964。两者实际 renderer 均为 SwiftShader，因此启动配置尚不能采用为修复。当前补齐受限的 client/Node input decision 和移动窗口对账，产品渲染、输入时序与验收门槛保持不变。

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
- `dae0ea6`：有界匿名 baseline 分段诊断。
- `b0a5a1d`：普通合并新 base，保留远端会话与 appearance 接缝。
- `04a8076`：将合并后的 appearance 源码与实际 UI/物品资源加入真实旅程 source binding。

## 变更

- Node CLI 增加显式 loopback/Origin/口令网络入口；单玩家连接通过受限二进制实验协议消费同一 Authority。
- Web 启动页支持本地/Node 双模式；远端只保留输入、预测、派生镜像、Worker mesh 与渲染，不持有 canonical writer 或浏览器存档写者。
- baseline/commit/action/input/checkpoint 均绑定 epoch、sequence/revision 和有界资源；断线取消、迟到结果、重同步、反压与失败连接不会终止世界。
- 正常输入采样至多一条网络/Authority 输入在途，并只保留最新状态；首屏 9 个必需网格原位提升优先级，合法空网格、高度边界和后续全半径流送保持有效。
- 菜单显示只读 Node 地址和 seed，明确网页关闭后世界继续、存档位于 Node；离开等待 durable 保存，断线可回主菜单手动重连。
- README 中英文、代码地图、当前 spec 和 CI Chromium job 已更新；长期 baseline 更新是因为双模式产品入口和 Node 本机运行命令已成为实际接线。正式公网网络与性能路线没有晋升。

## 验证结果

`8a5b40a` 的 source-bound `pnpm test:web-node-playable` 为 11 文件 34 项 Vitest + 2 项真实 Chromium 全绿（包含真实认证失败后图形身份缓存）；合并后的 `pnpm verify:static:ci`（260 文件、1302 项通过）、`pnpm build:web`、`pnpm build:server`、`pnpm verify:node-isolation`、`pnpm verify:web-node-playable-dist`、既有 15 项 Chromium regression 与资产集成 2 项均退出 0。GitHub CI 的初始同步超时仍在定位，完整数值、日志摘要、source/hash 绑定和原始帧清单见 `execution.md` 与 `evidence/`。

## 限制

只支持 loopback、单世界、单玩家与手动重连；没有 TLS/WSS、公网/局域网部署、账户、多玩家、自动恢复或浏览器存档导入。实验 C0/WebSocket 接口不代表正式协议采用或性能结论。只有收到 checkpoint receipt 的状态具备 durable 承诺。

## 剩余工作

先用 CI 移动窗口对账定位并修复实际失败，再由 root 提交最终独立验收报告和最新 CI 终态，确认 draft PR #17 可转为 ready-for-review。PR #15 的冲突与 main 整合由用户在另一台设备处理；本任务不修改 #15，#17 保持现有 base。不得自动合并。
