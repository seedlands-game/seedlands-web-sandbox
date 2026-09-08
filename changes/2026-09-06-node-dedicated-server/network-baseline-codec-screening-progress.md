# 基线编解码筛选：环境门禁与可恢复结果

状态：**没有可采用的性能组**。生产源码检查点 `0378b970ee688529718dc8f79f64586fc71857ef` 已推送；本批只增加隔离探索的证据，不改变 codec/transport 采用决定，整个 change 仍 Active。

## 合同与独立复核

执行前的 [筛选计划](network-baseline-codec-screening-plan.md) 原始 SHA-256 为 `f145878e28caab52ee5a0fd139dcd20f499e195d260eda450f094e04eee07f9e`。Terra/high 编写 runner，Sol/high 独立复核：热区只包含 encode 或 parse→validate→own，强等价在停表后校验；依赖、来源、运行时和 reservation 在前后重采；失败保留部分完成计数和原始 journal。root 集成并运行，假时钟控制通过不算性能证据。

隔离 runner SHA-256 为 `6f3e10b0f29ec45415f40af3a76552d41444c016c5274b8694a518acb7cda23d`。真实依赖为 protobufjs 8.8.0 / long 5.3.2；输入仍为冻结 r2 的 333 条基线消息（3 descriptor、330 page），没有为了计时更改生产协议或过滤困难样本。包体比较不代表实际业务消息频率。

## v1：正确性通过，但整组环境未验证

2026-09-07 08:37 UTC 校准依次尝试 iterations 1/2/4，选定共同 iterations=4；筛选于 08:39:59–08:40:08 UTC 正常完成。15 个 warmup、30 个 A/A batch 和 90 个筛选 batch 全部通过，每个 batch 计划及实际 encode/decode 消息数均为 1332。来源、依赖和 reservation 前后相等，累计计时门槛达标。

但这一版只有前后环境快照：一次启动前检查发现 CodexBar 94.2% 而未启动，真正运行后又观测到 100%；没有窗口内记录。不能据此证明实际计时期间发生竞争，也不能证明它满足安静窗口，因此整组分类为 `CONTENDED_OR_UNVERIFIED`，不排名、不计算迁移收益，不选出部分批次重新拼组。原始 120 条 batch 已随 [机器证据](network-baseline-codec-screening-evidence.json) 保存，临时原型与原始 journal 另以路径和 SHA-256 追溯。

## v2：补充监控后，在启动前被拦截

root 将校准、阶段切换和筛选放入同一个外部监控窗口：至少 3 个连续安静快照才启动；运行中每秒记录其他进程是否达到单核 50%；正常结束后再采 3 次。75 秒外部上限、进程组 TERM/KILL、失败留痕和 reservation 释放独立于 codec 同线程计时。这个阈值只能说明是否观测到明显竞争，不能证明连续零干扰或代替 CPU/分配/GC 计量。

Sol/high 对以下最终文件只读复核通过：supervisor `8abadfa3922bb28af2a7169faccea84b5f7dd3484c1b00b7d944950b050f99f2`，driver `ff5eccd98ac17d8a2f36b08dbc5378458ce8efe53a43d9c33bfdf97bd3797340`。清理控制检查覆盖已退出和运行中的子进程；首次组存活探测遇到瞬态 PermissionError 后，改为先回收 leader，未知状态失效关闭。控制检查不产生性能数据。

08:53:56–08:54:17 UTC 的唯一 v2 尝试为 `PREFLIGHT_BUSY_NOT_STARTED`（退出码 75）：20 次快照均发现 CodexBar PID 2082，CPU 84.7%–100%；另各一次观测到 Codex 56% 和 log 95.9%。校准、预热、driver 与筛选均未启动，没有第二组性能数据。reservation 已正常释放，没有停止任何其他应用。

## 准出与下一步

- `Static`：本批仅文档/证据，执行定向 Prettier 与 diff 检查；生产源码沿用 `0378b97` 已通过的完整静态、真实组合、本地浏览器回归与两端构建，不冒称重跑。
- `Vitest`：完整 worker 在精确清理本 worktree 的遗留测试后，45 秒外部监督下 20/20 通过并正常退出；功能耗时不作为 benchmark。
- 性能采样：v1 整组环境未验证，v2 未启动，**未准出**。浏览器开销、代表性混合负载、CPU/分配/GC、正式 N2 对照、N3/N4 采用与 A13 保持未完成。
- 下一次只在可用环境中创建新输出目录与新 reservation，沿用冻结输入和日程重新校准；不能覆盖 v1/v2、重用旧环境快照或反复运行直到得到希望的排序。当前不继续占用繁忙机器采样。
- 远端会话/受限 World 能力、双模式 GUI、目标服务器/CI 仍是产品关键路径。隔离 codec 探索没有将当前 app 改成远端可玩。

## 交付快照

交付前 root 核对全部 artifact SHA、120 条完成计数、冻结 spec 与 reservation 释放，全部通过；定向 Prettier 和 `git diff --check` 通过。Terra/high 独立只读复算批次、前后绑定、20 条预检快照与实际 artifact，确认无阻断、无性能误宣称。

本批保存筛选计划、进度、机器证据、恢复入口与额度快照；长期 docs baseline 没有新增通用决策，故不重复扩张。未提交 `/tmp` 原型、依赖、构建产物或密钥。主 spec 的冻结 SHA-256 仍为 `0181d7a49487a9a88de98e572e0ea2ec82b8f2cc6b43921f97dc32c214475274`。所有完成/失败/未启动证据保持分离，随当前功能分支提交推送。
