# 同机资源协调记录

本任务与 `设计 Node Dedicated Server 方案`（01a07751-c72c-7ea3-82bb-03c9ce46b982）共享同一机器。用户于实施中提醒资源争用，双方明确通过原子目录 `/tmp/seedlands-benchmark-reservation` 串行预约。不得以时间到了为由抢锁；只删除属于自己的锁。另一任务及本任务所有 subagent 的测试、构建和 benchmark 在对方窗口内暂停，编辑和只读审查可继续。

- 本轮第一次 11 workload 短预检：1 pair、0 ms 配置预热（仍有最少20次warmup），资源隔离未核验，只作 runner/等价性/热点方向诊断。**排除正式选型**。
- Node 独占 codec：2026-09-06 17:38:18 UTC 开始，Node 回报约127秒结束；明确释放自己的锁，随后通知本任务。Node 原17:28–17:35计时同样不作为其选型依据。
- 本任务构建/功能窗口：其 owner/process/开始/结束与系统负载见 `reservation-validation.json`、`reservation-static.json`、`reservation-static-corrected.json`。首轮 static 因历史实验 source hash 与新代码不匹配失败，保留历史产物，改当前回归测试使用本轮产物后通过。
- 2026-09-06 17:46 UTC 本任务明确交还 Node 5–8分钟功能检查窗口。Node 于17:48:01 UTC 取得自己的锁；本任务暂停所有高CPU工作，只编辑runner和审查。
- Node 于 17:54:56 UTC 明确完成验证并释放自己的锁，本任务接续。
- 本任务第二次 11 项 1-pair 预检与首次统一 1-block smoke 仍只作诊断。首次统一 smoke 因缺省 favicon 404 被资源清单器错误拒绝，全部失败输出保留；真实输入、Worker 状态、编辑反馈已完成。修正规则仅排除浏览器缺省图标，其他生产资源失败仍阻止准出。
- 正式 TS 数据平面对照见 `reservation-ts-fixes.json`：生产压缩的不可变 Worker bundle，每组至少1秒预热，10个平衡配对block；本轮产生 `ts-fixes-1788717907150.json`。此前 dev-module 结果只作诊断。
- 正式11项分项：2026-09-06 18:07:40–18:24:36 UTC，11项通过，见 `reservation-workloads-formal-1.json`。
- 18:29:44 UTC再次明确借出Node短窗口；Node于18:30:38–18:30:40 UTC完成N2修正计时、明确释放。其根任务与agents继续暂停，coverage等待本任务交还。
- 本任务修正后5项正式分项于约18:34–18:39 UTC完成，5项通过，见 `combined-reservation-refinement.json`。W10采用真实生产循环控制，W14/W15采用优化后生产TS。
- 第二轮统一smoke在启动Chrome前被Node fetch的禁止端口拒绝；改为未占用端口45891/4281/45893，未终止其他任务占用的4280/4282。第三轮smoke的3个运行均通过产物、CPU窗口、轨迹及任务量门禁，仍仅作诊断（`combined-smoke-3`）。
- 正式统一10 block即将使用独立 `combined-reservation-final-1.json`，实验结束再明确交还资源。

隔离承诺只覆盖已协调的任务。系统负载/可用内存用于暴露环境变化；用户应用、操作系统后台活动和温度仍可能造成噪声，所以必须保持平衡顺序、重复配对和区间报告，不声称实验室绝对空闲。

- 第一批统一正式采样完整30次通过，耗时21.4分钟；因编辑p99相对修复TS回归而触发消融，不因统计不利排除该批。额外逐role检查通过（`combined-final-1/posthoc-role-audit.json`）。
- Node于2026-09-06 19:11:29 UTC取得功能窗口，19:16:18 UTC释放并明确通知；本任务仅做轻量编辑/分析，无测试、构建或Chrome竞争。其后本任务接续默认集合RED/GREEN、生产构建和基线回归，再执行收缩后完整第二批。

- 第二批 `combined-final-2` 于2026-09-06 19:17:49–19:39:13 UTC完成，30run/10block均有效，候选仅General W02–W06；与Node明确互斥。最终仅余独立测试文件整理和静态门禁，无追加benchmark。各正式窗口系统负载与free memory范围汇总见 `resource-windows-summary.json`；free memory不是进程RSS或系统内存压力等级。
