# 输入协议复查与修订

## 范围

落实批准合同 A7 的可靠输入边界，审查 `InputCommandBuffer` 对执行环境传入数据的处理。保留合法输入的按目标 tick 消费、ack 和持续按键语义。

## RED

修改生产实现之前，新增两个定向用例：不完整/非有限输入拒绝且不污染序列状态；入队和读取均不泄露可变输入对象。2026-09-06 执行 `pnpm exec vitest run tests/runtime/session-protocol.test.ts`，11 项原有测试通过、2 项新增测试失败：空消息读取 `protocolVersion` 抛错，调用方修改入队对象导致实际移动输入被改写。

## 修订

- 校验消息种类/版本、有限时间戳、两个方向轴的有限值及 `[-1,1]` 范围、离散竖直意图及布尔按键。
- 校验发生在序列门之前，无效高序号不会消耗合法序列；返回明确 `invalid`，不抛出异常或进入物理步骤。
- 入队、当前输入查询和消费返回均复制嵌套状态，避免 headless 同进程调用方修改已经接纳的命令。
- 原有倒序目标 tick 用例改用合法方向量 `1`，序列仍为 10/11/12，保持该用例原本的 ack/顺序断言。

## GREEN 与边界

- `pnpm exec vitest run tests/runtime/session-protocol.test.ts tests/server/authority-session.test.ts tests/client/prediction-buffer.test.ts`：3 个文件、31 项通过。
- 相关文件 Prettier 与 ESLint 通过。
- `pnpm exec tsc --noEmit`：主线并行 V3 迁移尚未适配 `GameServerGameplayFacade.restoredVersion`，报 `1 | 2 | 3` 不能赋给 `1 | 2 | null`。本次文件无诊断，不将该运行记录为整体类型检查通过。
- 这些结果只证明纯协议边界；实际 Worker 拒绝回执、客户端状态提示和延迟输入验收仍由主线浏览器集成证明。
