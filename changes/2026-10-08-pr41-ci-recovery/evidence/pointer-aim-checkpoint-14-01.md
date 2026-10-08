# Browser14 与真实鼠标目标发布 checkpoint

2026-10-08，冻结基线 `9b38ac1854ab14a916b2b1ff8369874c1d346b49`。本组候选尚未 build/browser，不宣称 V2、性能或完整玩法验收通过。

## 当前 artifact 的实际终态

build13 PASS：sourceDigest `67b4acfb346a690d6c5c70e1812a651f58290d2a4e0f3ff74c3aee11ff90480c`，artifactDigest `5717cb1b0a9e8d2663e944cc18f36e151ab7c35c251332c7f9c417129808ab46`。

唯一 Browser14 runId `pr41-cloud-browser-14-01`：CLI exit1、CANONICAL_MAIN receipt FAIL，主旅程 FAIL / visual PASS / modular SKIP。失败附件 stages 明确记录 C0、C1、C2、C3 PASS；C3 的原断言实际要求真实 held mouse 的“已衔接下一击”“第 2 击”“7 点伤害”和怪物消失，并完成工作台放置、打开、拆除和回收。不能仅凭 step end 或耗时判定通过。

主旅程 15.2m 后于 V2 resource strip 的切换生存模式耗尽原 900000ms；此时尚未开始正式资源收集、四槽铁甲或后续保存恢复。visual 1.5m PASS，整个 run 17.0m。远端同 SHA CI `37825171423` 也是五项静态/确定性/headless/build 检查 PASS、Chromium FAIL、preview SKIP：第一次 C0 原10秒断言失败，retry 到 V2 放置资源时耗尽900秒。偶发启动边界没有关闭。

## 有效 RED 与最小修复

有限审查发现 mousemove 会立即把 held 方向送到 Worker，却丢弃实体命中 boolean，使旧挖掘门控继续打开。有效 RED `held-mining-mousemove-red-16-06.log` 使用真实安装 mousedown/mousemove/render，实际 BrowserPointerAttackInput probe=true，并通过实际 canonical loaded cells、AuthorityRuntime、正式 target resolver 和 registered performAction 选中怪物；旧分支未取消活动挖掘，cancelledBreaks 期望1实为0。修复把 mousemove 和 cadence 统一到 captureHeldAttack，存储实体命中门控并立即取消旧挖掘。独占文件19/19 GREEN `held-mining-mousemove-green-17-01.log`。早期 red05 和 green15 等日志是几何/fixture 校准失败，不作为行为 RED。

第二个有效 RED `idle-pointer-aim-red-14-01.log` 为1 FAIL/14 PASS：未held的真实 Pointer Lock 事件更新角度，却没有更新相机射线，预期 +X 方块实际 null。修复在鼠标事件同步设置相机角度、发布当前目标；不推进预测、physics 或 Authority。

继续沿实际消费者检查，BrowserGameplay.setAimTarget 原来仅设置内存字段，UiBridge target 通道仍等 render。有效 RED `idle-pointer-target-channel-red-14-01.log` 为1 FAIL/2 PASS，真实 ray target 有效但实际 retained UI 通道为null。修复直接发布现有 UiWorldSession.publishTarget，复用同一 target projector 保持原标签及阻挡规则；保留其他 HUD、breaking 状态。瞄准助手只移除固定双 RAF 依赖，仍读取可见 target-card 和正式 aimedVoxelTarget，保留80px步长、180次边界、adjacent核验、原900秒、画质和所有玩法断言。真实 DOM 收敛需新browser确认。

## 验证与诊断边界

最终受影响7文件62/62 PASS：`pointer-aim-focused-green-14-03.log`。新的输入和target通道测试已加入正式 Classic headless/types 选择。生产types、Classic types及scoped ESLint PASS。Classic types新增选择暴露旧fluid-target fixture的partial cast，改为从现有ready()补齐基础projection；对应文件3/3 PASS（idle-pointer-target-channel-green-14-01.log）。不以这些代替产品验收。

20秒有界 CPU 诊断用原9b artifact、独占窗口 `pr41-cloud-cpu-diagnostic-14-01`，exit0并释放窗口。自然启动场景 loaded18/triangles68736，frame p50约263ms，页面主线程profile约75% idle；该诊断不等同 Browser14 的 V2 场景、不含GPU/Worker profile，也不是性能验收或优化收益。Browser14失败时 Low、阴影/反射关闭，最终frame窗口p50约407ms；trace显示大量鼠标/PointerLock/UI与RAF累积等待，没有一个按钮阻塞900秒的证据。没有调低画质或增加预算。

根输出 `/workspace/pr41-recovery-20261008-root-01/`；有界子任务输出 `/workspace/pr41-recovery-20261008-fixtures-01/`。18:57 UTC主对话从实际产品UI确认周剩余93%，停止线约60%；Cloud无法直接读取产品额度页。V2正式producer、V3、V4、modular和194项完整验收仍未关闭；不可宣布PR可合入。
