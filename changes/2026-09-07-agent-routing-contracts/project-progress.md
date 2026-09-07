# 项目资源与路由规则交付记录

## 完成状态

已实现机器级阻塞性能窗口、新入口与旧 wrapper 兼容，并更新项目路由、证据分层和性能执行文档。未修改游戏生产代码，未创建长期任务或运行真实 benchmark。

## 改动文件

- `scripts/benchmark-window.mjs`：阻塞获取、有限等待、owner 校验、进程组清理和证据采样。
- `scripts/with-benchmark-reservation.mjs`：保留旧命令形式并转入统一实现。
- `project-tests/`：隔离进程与临时锁测试。
- `AGENTS.md`、`docs/collaboration-routing.md`、`docs/development-governance.md`、`docs/performance-execution.md`：短指针和完整策略。

## 验证结果

- RED：新入口不存在时 4 个隔离进程用例全部失败。
- GREEN：6 个隔离原生测试覆盖并发串行、旧 wrapper、旧 owner 超时不抢锁、取消等待、子进程失败、持有者信号、派生子孙清理，以及 owner 提交异常不删除后来出现的他人内容。
- 已执行：项目文件 Prettier、定向 ESLint、Node 22 原生测试与 `ls-lint`。
- 未由实施者执行：`pnpm verify:static` 与 `pnpm build`；按 root 安排由独立 Terra/high 单一执行，避免重复占用性能/额度。

## 限制

- 锁是协作式机器窗口，不是系统级资源隔离。未知或损坏 owner 不自动抢占；强杀或系统崩溃后的遗留锁需人工核对。
- 默认 Terra/high 是可注册的项目验收职责，不自动创建长期任务，也不覆盖人类选择。
- Midscene 的用户预算估算可接近零，但真实依赖不保证免费；单步 CDP 只作诊断补充。

## 下一步

完成静态、构建和独立 Terra/high 验收，由 root 统一提交交付。
