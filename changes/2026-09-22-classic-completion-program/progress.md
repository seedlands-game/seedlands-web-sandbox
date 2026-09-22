# Classic 完成计划进度

状态：Active。目标由用户于 2026-09-22 授权，按阶段 1 → 2 → 3 → 4 串行准出；阶段内部允许并行。

## 持续目标

- Goal thread：`01a0c907-5c91-73c1-a6b8-0f4d790ba6a2`
- Token budget：4,000,000（平台 goal 口径；credits、API 美元与账户额度仍为 unknown，不混算）
- 功能分支：`feat/classic-beta173-playable`
- 起始提交：`27249bd80e4388e2a36f61e84424b793b0f9c80a`
- 远端交付：每个完整阶段形成语义提交并 push 到既有 Draft PR #41；不自动合并。
- 无关工作：`changes/2026-09-22-hotpath-allocation-baseline/` 属于用户的独立性能任务，不读取为本任务依据、不修改、不提交。

## 阶段台账

### 阶段 1：当前视觉改动闭环

状态：COMPLETE。实现、缩略图、生产构建和 agent-browser 实机矩阵完成；首轮独立审阅 0 P0 / 2 P1 / 1 P2，全部修复。关闭性复核确认 0 个残留 P0/P1/P2。

完成条件：

- 最终材质对应的静态物品缩略图已由既有生产链重新派生并目视检查。
- 当前源码完成生产构建并记录 source/artifact identity。
- 使用隔离的 `agent-browser` 会话完成 `classic-experience-coherence/visual-acceptance.md` 的组合体验矩阵；页面 DOM/视频/控制台/网络由 agent-browser 取证，WebGL 画布动作与结果必须有截图或应用状态读回。
- 发现的当前范围问题修复后重新执行受影响项；静态、构建和真实画面证据分层记录。
- 独立审阅没有未处理的 P0/P1/P2。

工作包：

- `phase1-thumbnails`：缩略图生产与派生一致性。
- `phase1-browser`：agent-browser smoke、录制与组合体验矩阵。
- `phase1-evidence-review`：只读检查证据缺口和回归风险。

### 阶段 2：版本化世界生成与出生体验

状态：IN_PROGRESS。Breaking spec 与 A/B 实验合同已建立，尚未修改生产 worldgen。

范围：树冠层次、森林植被密度、出生通路与初始朝向。必须新增 generator version、保留 v10 结果、用多 seed 固定 A/B 与确定性证据；不得修改旧世界。

### 阶段 3：Classic 玩法与验收债务

状态：PENDING。仅在阶段 2 完成后开始。

范围：十六色羊毛世界方块、C0–C5 新合同、缺失 checkpoint fixture、用户外观旅程、超出相机附近 64³ 的完整块光范围。每项先冻结独立验收与兼容边界。

### 阶段 4：全局审阅与最终交付

状态：PENDING。

完成条件：使用高智能审阅模型覆盖最终 `base...HEAD`；全部 P0/P1/P2 经主线程复核、修复并回归；更新 Delivery Snapshot、长期文档、远端提交与 Draft PR。

## 工作量与预算

这是跨四阶段、跨 Web/stdlib/Playbook/存档与浏览器的超大 change。当前为初始保守登记，阶段范围冻结时重估。

| 阶段             | 传统工程量 | Agent 活跃工时 | 关键路径正常 / 保守 |
| ---------------- | ---------: | -------------: | ------------------: |
| 1 视觉闭环       |     1–2 PD |          4–8 h |         4–6 h / 8 h |
| 2 worldgen vNext |     3–6 PD |        10–20 h |       8–14 h / 20 h |
| 3 玩法与验收债务 |    8–15 PD |        30–60 h |      24–40 h / 60 h |
| 4 全局审阅交付   |     2–4 PD |         8–16 h |       8–12 h / 18 h |
| 合计             |   14–27 PD |       52–104 h |     44–72 h / 106 h |

AI 连续墙钟按阶段依赖串行、阶段内最多四个 native agent 并发估算；保守剩余 106 小时，20% buffer 后建议 128 小时。用户已明确设置平台 token budget 4,000,000；该值不等于 credits、API 美元或墙钟。模型 token 分类、credits、API 等价费用、账户余额和预测额度占比均缺少可靠分母，记 `unknown`，每阶段回填可观测值。

## Agent 回报协议

每个工作包回报：任务名、owner、输入 SHA、修改路径、运行命令、PASS/FAIL/BLOCKED、产物路径、未验证项、建议下一步。主线程将结论写回本文件或对应阶段证据文件；临时 `/tmp` 材料不能作为唯一长期记录。
