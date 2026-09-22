# 热路径投影分配优化

状态：Validated，最终生产回归通过，按授权交给 PR 审阅。类型：Agile。用户已授权并行优化及真实 benchmark。

## Scope 与依据

冻结 control：0759202cd0efbd6cc23dca4f96f657f70f8879d0。此前真实 C0–C4 profile 显示 Authority 配方枚举与主线程 UI 投影为主要 CPU/分配路径；本次仅做两个可独立消融的候选。不改碰撞、快照、Worker transfer 或 worldgen。独立工作树保护其他会话的视觉施工。

- C：可合成配方查询避免为每条配方构造完整事务候选和以异常表达普通缺料；实际提交的验证、provider、容量、顺序和失败语义保持。
- U：UI 投影消除 JSON 深比较和不必要重复派生；所有当前展示字段、变更传播及引用复用合同保持，不依赖未覆盖字段的 revision。

## Behaviour 与 Test Design

先取得定向 RED，再实现 GREEN。C 覆盖可合成/缺料/满背包/实例/替代 provider，枚举与真实候选成功集合等价且不修改输入；实际动作仍走完整验证。U 覆盖所有展示字段更新、等值引用复用、空值、模式、工位和物品定义变化，防止陈旧缓存。禁止向可变消费者泄漏共享派生缓冲。各 worker 仅修改自己的源码和定向测试，不运行性能采样、不 push。

## 性能预注册

A 为冻结 control；B-C 只含 C；B-U 只含 U；B-CU 含两者。共用相同诊断接线、隐藏 sourcemap、生产 C0–C5、seed、输入、1 general worker、headless Chrome、视口及 profiler（CPU 2000us、heap 65536 bytes）。所有产物在采样前构建并验明 identity。采样期间不构建/测试。

使用既有唯一 Classic 浏览器旅程，不新增浏览器套件。CPU 样本只统计两端均在 C1 完成后、C4 完成前的完整 10 秒片段，按目标被采样秒数归一化；不把函数 inclusive CPU 相加。主指标是该目标线程完整活动 CPU ms/s（包含 GC，排除 idle/program）：C 为 Authority，U 为主线程，组合为二者之和。它是目标系统的实际 CPU 资源成本，不能直接称帧率或操作延迟提升。heap 分配、热点 CPU、frame p95/p99、chunk p95、失败/stale/longframe 和 kernel bytes 为次指标。

顺序：新 A/A/A 建噪声，然后每候选 A/B/B/A；仅通过的候选进入组合 A/B/B/A。每格一个完整旅程，保留所有失败原始样本。噪声 N=(max-min)/median；主指标需降低至少 max(5%, 2N)。否决：语义失败、窗口/身份不成立、缺失目标有效片段、frame p95 或 chunk p95 的中位数回归超过 max(15%, 2倍该指标 A/A 噪声)、新 failed/stale task、kernel bytes 增长。普通计时不作性能证据。若噪声 N>25% 则本轮 NOT_COMPARABLE，停止采用而不改阈值；最多一次基于明确基础设施故障的重开，原失败保留。组合不通过最多分别消融两个候选；无确定收益移除候选生产改动，保留结果。未收集 GPU/RSS/精确复制 bytes 写 NOT_COLLECTED。

全机锁唯一 /tmp/seedlands-benchmark-reservation，由 scripts/benchmark-window.mjs 获取；所有工作树共用，未知 owner 不抢锁。由根任务串行队列执行；结束清理自己的子进程、端口与 lease。

## 预算与交付

两个组件正常 2 PD、保守 4 PD；准备/集成/性能正常 1 PD、保守 2 PD，总正常 3 PD、保守 6 PD。AI：两个 Terra/high worker 各 0.5–1.5 小时；根集成/实验 1–3 小时，总 active/tool 人时约 2–6，并行墙钟 2–4 小时，保守 ×120% 建议 4.8 小时。单阶段不超过 6 小时。子模型实际回显未知则记 unknown；credits/当前余额/官方费率本轮未取得，费用与额度占比 unknown，不伪造换算，不创建 Goal。

任务：RED/GREEN → 静态与定向检查 → 冻结四份产物 → 串行 A/A 与单项/组合 A/B → 仅保留通过项 → Delivery Snapshot/语义提交/授权 PR。长期 docs 默认不更新：本 change 是局部实现，沿用现有性能窗口和证据合同。

## 实验裁决

详见 report.md 与 decisions.json。11 次有效采样后 C 通过，U 因 chunk p95 +26.52% 超出 15% 否决线而撤回。组合 NOT_RUN（无两个通过候选共存）；没有更换主指标、降低阈值或重跑择优。保留 C 的结论限 Authority CPU/分配下降，不宣称总 CPU 或帧率改善。
