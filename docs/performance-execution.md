# 性能执行窗口

浏览器 benchmark、Harness 性能采样和其他竞争 CPU/内存的证据任务统一通过机器级阻塞窗口执行。固定职责标识为 `seedlands-performance-validator`，默认使用 `Terra/high` 做一次独立验收；跨请求反复复用时才考虑经用户授权建立独立任务。

## 调用

旧入口保持可用并改为等待窗口：

```text
node scripts/with-benchmark-reservation.mjs <command> [args...]
```

新入口支持显式等待上限：

```text
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- <command> [args...]
```

默认锁目录仍是 `/tmp/seedlands-benchmark-reservation`；测试可用 `--lock-dir`，旧调用可用 `SEEDLANDS_BENCHMARK_LOCK_DIR` 与 `SEEDLANDS_RESERVATION_WAIT_MS`。已有 `ownerThread/runId/pid/startedAt` owner 格式可读取，新 owner 增加 `version` 但保留旧字段。未知、损坏或仍存在的 owner 只等待至超时，不自动抢占或删除。

## 等待、取消与清理

- 第二个调用阻塞等待前者释放；等待有上限，超时返回 75。
- 等待者收到 `SIGINT`/`SIGTERM` 时退出，不删除他人锁。
- 持有者把命令放入独立进程组。命令成功、失败或收到信号后，先终止仍存活的派生子孙，再核对 `pid + runId` 并只释放自己的锁。
- 信号清理是本机尽力边界；`SIGKILL`、系统崩溃或权限异常仍可能留下锁。未知遗留锁不自动回收，应由人核对 owner 和进程后处理。
- `SEEDLANDS_RESERVATION_EVIDENCE` 继续写入 owner、等待时间、退出状态和机器采样，不能把它当成应用指标本身。

窗口只保证这些命令不在同一锁下并发，不能消除操作系统和其他进程噪声。普通功能测试、历史浏览器结果或一次“机器看起来空闲”不能冒充有效性能证据；spec 仍需分别记录 benchmark、静态、构建和功能结果。
