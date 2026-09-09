# 本机角色认知宿主

`@seedlands/agent-server` 是浏览器单角色控制器的本机 Node 宿主。它持有模型 wire history、调度、会话预算与待确认草稿，不持有或直接修改游戏世界。浏览器 Authority 仍会验证每个 `intent` 和 `memory` 请求并返回回执。

## 启动

```sh
corepack pnpm --filter @seedlands/agent-server build
DEEPSEEK_API_KEY=... corepack pnpm --filter @seedlands/agent-server start
```

服务只监听显式 loopback 地址，CLI 默认使用 `127.0.0.1:8787`；`AGENT_SERVER_PORT=0` 可选择随机空闲端口。启动后 stdout 输出一行 JSON，包含 `url`、临时 `pairingToken` 和模型可用状态，不包含模型密钥。浏览器必须把 token 放在首个 `hello` 帧中；不要把 token 放进 URL。允许来源通过逗号分隔的 `SEEDLANDS_ALLOWED_ORIGINS` 配置，默认是本地 Vite 的 `localhost:5173` 和 `127.0.0.1:5173`。

凭据按以下顺序解析，不读取 `.env`：

1. `DEEPSEEK_API_KEY`，端点为 `DEEPSEEK_BASE_URL` 或官方默认端点。
2. `MIDSCENE_MODEL_API_KEY`，仅在同时存在 `MIDSCENE_MODEL_BASE_URL` 时复用，避免把代理密钥发往不同端点。

日常决定固定使用文本输入的 `deepseek-v4-flash-vision-exp`；`deepseek-v4-pro` 只用于上下文压缩。Flash 历史保留 provider reasoning 以满足后续调用的协议要求，但 reasoning 不进入 Pro 压缩输入、世界记忆、普通日志或浏览器帧。

## 生命周期边界

事件会合并后唤醒决定，实际派发模型请求时才重置 60–600 秒的活跃时间兜底（默认 180 秒）。暂停不会累计补发请求。连接内同时最多一个模型请求和一个尚未闭合的语义工具调用；Authority 回执会闭合 DeepSeek tool pair，迟到或不匹配的回执不会影响当前决定。

上下文默认 128K，在 112K 软阈值准备压缩；可切换 256K/224K。压缩冻结 event cursor，新事件继续进入尾部；只有 Authority 接纳 `memory` 后才原子切换，拒绝或失败保留旧历史。Pro 失败且达到硬阈值时生成明确标注的确定性恢复摘要，仍须 Authority 接纳。

模型预算是每次本机 runtime session 的上限，不会在一小时后自动刷新。状态中的 `estimatedCostUsd` 按 2026-09-09 的公开价目保守估算，供保护与诊断使用，不是供应商实际账单。服务重启后，未压缩的私有 Flash history 不恢复；世界持久摘要与 Authority 保留的近期事件用于创建新的认知会话。
