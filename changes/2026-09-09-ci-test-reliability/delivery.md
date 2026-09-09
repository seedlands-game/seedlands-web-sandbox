# 交付记录

## 已实施

- 五个 Wasm/数据面测试的 17 处大型缓冲比较改用 Node strict deep equality，所有 corpus、字段和 input immutability 断言保留。受控组件对照减少约 76.19%，详见 performance.md。
- Static verification 保持原 required check 名、单 worker 全量 coverage、80% world 行门槛；拆成可定位的六个步骤，类型检查提前。新增命令集合契约，防止 workflow 与 `verify:static:ci` 演进后遗漏检查。
- Chromium 每轮立即保全独立 artifact（含 run id/attempt）；重试一次仅用于 trace 取证，flaky 仍阻塞。Static/Chromium job 20 分钟硬上限避免失控运行。
- 木剑长旅程改为真实库存增量驱动拾取，100 ms 有界轮询、实际掉落物导向、Pointer Lock 检查及 finally 释放输入。战斗目标相对玩家定位；成功截图移到非 CI 视觉运行，功能断言保留。
- 长期文档更新 `docs/ci-testing.md`，并从 development-governance 链接。记录当前核心保障、环境边界、覆盖率解释、TDD 反例要求和 PR #26 Agent Server 未覆盖项。没有改变产品架构、保护规则或合并权限。

## 已验证

| 验证                 | 当前结果 / 边界                                                                                                                                                         |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 原静态完整命令       | `VITEST_MAX_WORKERS=2 pnpm verify:static` 通过，236 文件/1167 用例通过，4 个 opt-in 性能用例跳过，world 行覆盖率 96.89%；本机 worker 数与 CI 单 worker 不同，不比较墙钟 |
| 后续新增 CI 集合契约 | `pnpm exec vitest run tests/scripts/ci-change-scope.test.ts` 10/10，通过后续 ESLint/tsconfig.test 和格式复查；新 SHA 远端全量还须重新运行                               |
| 木剑旅程             | `CI=true ... --grep 木剑通过真实采集合成与输入战斗 --repeat-each=3 --retries=0` 连续 3/3，通过                                                                          |
| 浏览器 regression    | `CI=true ... pnpm test:e2e:regression` 20/20，通过，无 retry/flaky                                                                                                      |
| World Harness        | `CI=true pnpm test:developer-harness` 2/2，通过                                                                                                                         |
| 资源集成             | `CI=true pnpm test:pr15:integration` 2/2，通过                                                                                                                          |
| 近战集成             | 系统 Chrome + SwiftShader + low，1/1，通过；本机缺 Playwright Chromium 1234，指定 full Chromium 的初次运行在 launch 前失败，不算产品失败或同环境验收                    |
| 构建                 | `pnpm build` 通过，保留既有大 chunk warning                                                                                                                             |
| 生命周期             | 本轮所有 Playwright 服务结束，4173 无 listener；性能预约命令均已结束                                                                                                    |

本机结果不替代 GitHub Ubuntu / Node 22.12 / 已安装 Chromium 的结果。仓库三项 required checks 已 live 读取，名称和部署依赖不变；保护配置未写入。

## RED 与未掩盖的失败

- 初始 GitHub 基线有一条木剑 flaky，两次失败后重试通过仍 green。新的 flaky gate 会拒绝这种结果。
- 第一次事件驱动拾取版本连续 3 次失败：玩家拾取后更早停步，离旧固定坐标敌人超出攻击范围，权威 combat lastResult 为 null。改为相对玩家构造近距离目标后，连续 3 次和完整 20 条均通过。没有降低攻击、掉落、存档或 UI 断言。
- 五轮比较器采样的 11 条用例均通过，但局部 world 覆盖率均 66.45%，低于完整门槛而 exit 1，原始日志保留。这些仅作为同语义组件计时，最终完整覆盖率独立通过。
- 本机指定 full Chromium 未安装；保留环境失败，不把系统 Chrome 的结果标成同环境通过。

## 交接边界

Agent Server 属于未合并 PR #26，本次只读核查其绑定 SHA；已存在真实 WS 集成与浏览器 fixture 链路，打包后独立进程/信号/异常帧/关闭清理矩阵仍有缺口，详见 agent-server-audit.md。没有把该功能分支隐式合入，也没有实现或宣称这些新增保障。

最新 PR CI、mergeability 和独立评审在提交交接时读回；只有实际通过才能声明可交棒。模型请求为只读 Luna/medium 侦察与 Sol/xhigh 复核；有效模型未独立回显，记 unknown。没有新增长期子任务或 automation，没有创建 Goal。精确 token/credits/API 账单归因 unknown。

## 独立复核

请求只读 Sol/xhigh 复核当前 base 加完整 diff；有效运行模型没有独立回显，仍记 unknown。结论：同意方案，未发现可证实的 P0/P1/P2。采纳其库存增量、100ms 有界轮询、Pointer Lock 及 artifact run_attempt 建议。reviewer 为静态复核，功能数据由主任务实际运行取得；当前本地构建和所有集成均已完成，余项为发布后 exact-SHA GitHub CI。
