# Agent Server 测试核查

2026-09-09 当前主干 `01bab28ace506685f39c1d4a86fec541cbbf2f1b` 不含 Agent Server。用户提到的功能在 [PR #26](https://github.com/seedlands-game/seedlands-web-sandbox/pull/26)，本次只读绑定 HEAD `6a24891142dc0abc196a8c07c2488eb308f902fe`；它与已退役 Node Dedicated 游戏宿主不同。本 change 不合并或重写另一功能分支，以下是该 SHA 的覆盖评估。

## 已有保障

- `tests/agent-server/websocket-host.test.ts:47-106` 已使用真实 loopback WebSocket，覆盖 pairing、binding freeze、旧 sequence、错误 token 不回显、非法 Origin 403。
- `tests/client/character-controller-bridge.test.ts:113-166` 覆盖 ready、Authority 拒绝、断开后迟到消息和 pause/resume。
- `changes/2026-09-09-living-npc-mvp/e2e/controller-connection.spec.ts:8-97` 已用真实浏览器连接真实 Agent host，确定性模型 fixture，验证两轮对话、follow 意图和断开后角色/目标保留。CI 已接入 `test:living-npc`。
- `real-cognition.spec.ts` 仅显式设置 `SEEDLANDS_LIVE_MODEL=1` 执行，普通 CI 跳过是正确的环境边界，不能算真实模型验收通过。
- 默认 Vitest 全量发现 Agent Server tests，但 world-only 的 80% 行覆盖率门槛不覆盖它。

## 优先补齐

1. `websocket-host.ts:107-186` 的拒绝矩阵：binary、非法 JSON、超大 frame、认证超时、重复 hello、binding mismatch、连接上限及正常递增 sequence。
2. `websocket-host.ts:199-210` 的释放矩阵：pending cognition 时 server close、socket close/error、runtime dispose；确认关闭返回且端口释放。另测 createRuntime/receive 抛错和 bufferedAmount 超限是否收敛。
3. build 后真实 child process smoke：运行 `dist/main.js`，等待 ready，外部 WebSocket hello/ready，再发 SIGTERM 并检查退出/端口释放。目前 E2E 在测试进程内 import `startAgentServer`，不能发现打包入口、信号和依赖遗漏。
4. 浏览器 bridge 对畸形 host frame、sequence 回退、pending 上限、意外 close/连接超时的可观察 UI 状态；保证角色状态保留，已断开连接的迟到结果不能回写。

这些是可由无密钥 CI 自动验证的缺口，不是 GitHub 机器无法达成的条件。模型答案质量、真实 DeepSeek 网络与额度单列 opt-in 验收。当前评估没有在本分支实现以上四组新增测试，PR #26 合并后应按其最终合同补齐，不能声称已经保护。
