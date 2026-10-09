# checkpoint40：Browser30 实际主线程采样

精确 source63f8d24cfc2c083fc82f4f298932cec648550022 / build29 / pr41-cloud-browser-30，原完整 runner 已终结：main FAIL、visual PASS、Modular 条件 SKIP、wrapper exit1。C0–C3、Creative 作物和 V1 已完成；900秒终结前石镐已制作并关闭工作台，随后进入铁资源路线。不能把栈中的 prepareCraftedIronArmor 当作完整装备验收通过，也不能沿用 Browser29 的石镐提交失败位置。

原 CPU profile 覆盖主线程900.139563秒，75033样本、4537节点，包含当前生产 bootstrap、PlayCanvas 与模型资源。10000微秒采样，diagnosticOnly=true、eligible=false；约506.822秒为 idle、178.345秒为 program，不能据此认定 GPU、trace 或 compositor 因果。同步 Authority receive、UI JSON 比较、光照重建均有真实调用，但尚未定位主要帧间空档。最后同128样本 tick中位26.75ms、gap793.15ms、receive64.35ms；不同窗口中位数不相减。

完整结果、trace、原始profile与失败附件保留在私有 Root browser-30-results、browser-30-cpu-profile-40-01.json、browser-30-failure-40-01.json。派生 call timeline 保留各原始时间，不另造通过证据；各方法耗时总和可能包含重叠，不当作互斥 CPU 分类。末段 station craft/close 的实际操作支持本次失败阶段判断。

相邻 pre-navigation-v4-browser30-01.json 来自该已结束主旅程真实 world.checkpoint export 返回的 composition 投影。只捕获实际旧身份，尚未新增迁移 allowlist，也不声称完整存档恢复通过。导航 self action 已存在；未来正式 producer、唯一 owner prepared commit、accepted view 和 HUD 仍须实现。

本组仅固化新诊断，不新增生产优化、不改原20/45/900秒、质量、renderer、输入断言或 trace。不重复已有效的静态、构建与确定性测试；本组证据格式及受保护冻结检查另记实际结果。06:09真实周 UI 仍剩89%，60%停止线不变。完整V2/V3/V4/194、Survival农业/恢复、真实Modular玩法和组合整帧A/A、A/B仍未完成，不可合入。
