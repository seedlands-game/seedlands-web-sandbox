# Web↔Node 本机单人闭环执行记录

## M0 RED

- 源码起点：`3481069`（合同提交，基于 `3c727f7`）。
- 合同校验：`implementation.json` 的 SHA-256 为 `721bd6e9e54f61f58c35ddab740590e5249749134367d00c3877e157185b642c`，全局校验脚本返回 `valid: true`。
- RED 命令：`pnpm exec vitest run tests/server/network-playable-protocol.test.ts tests/node/node-network-options.test.ts tests/node/node-authority-publication-listener.test.ts tests/client/remote-authority-client.test.ts`。
- RED 结果：退出码 1；4 个测试文件失败。缺少远端客户端和 publication listener 隔离模块；CLI 拒绝 `--listen`；C0 不识别 `session-hello`；interest 仍接纳多主块请求。
- 接缝：公开入口只允许首条有界凭据握手、输入、玩家 action、单主块 interest、checkpoint、heartbeat 和 disconnect。Node 将每连接的客户端序号映射到进程内持续单调的 Authority 序号；浏览器不创建 Authority、Logic、Fluid 或持久化写者，完整基线只由 Node capture 并经既有 reference publication/reassembly/consumer 安装。
- 安全边界：远端产品禁用 `editWorld`、`setPlayerPosition`、时间/暂停和 server command；单连接网络 listener 失败只关闭该连接，不能终止 Authority lane。
