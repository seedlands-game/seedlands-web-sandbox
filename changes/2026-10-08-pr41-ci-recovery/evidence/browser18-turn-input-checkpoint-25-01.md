# Browser18 与完整转向 checkpoint

## 冻结身份与终态

- HEAD/远端：`47f5af61e38f733b14122c5f2ee040f205d7a89c`；base仍为`fba4486e433c145db658f6b1598b70c47f759c8a`。
- build17：sourceDigest `6096dee100fb9ea93892f0b9901f705df65720ae3907e4a864472d1ed533b8d2`；artifactDigest `c55dddfb6248b3d98d158a93a0864dc1237740b6044e42563789e4e82297d0a6`；276文件，构建通过。
- `pr41-cloud-browser-18` 唯一 canonical attempt：**2 FAIL / 1 SKIP**，wrapper已终止，整个调用期间源码和HEAD未变。主旅程C0-C3与V1已执行，V2在900000ms总时限耗尽；C4/C5和装备完成未验收。视觉单击 `[0,61,17]` 仍为3，期望0；断言及时限未修改。
- 结果、HTML、trace原件移到 `/workspace/pr41-recovery-20261008-root-01/browser-18-{results,html}`；receipt在`harness/results/pr41-cloud-browser-18/classic.json`。流式诊断 `browser-18-diagnosis-25-01.json`；实际export返回的完整composition保存在`browser-18-composition-25-01.json`，没有按新Pack反推旧身份。
- 首次过早读取尚未完成的ZIP失败；随后首个全量JSON解析因内存偏高被主动终止，保留退出143，不视为产品失败。终态后有界流式解析完成；没有因此重跑浏览器。

## 诊断边界与输入修复

末尾frame interval p50=449ms、p95=1091.4ms、p99=1598.1ms，不能把局部Wasm meshing的98.11%收益解释为整帧收益。V2有453次mouse.move（调用耗时合计180229ms）和2088次完整snapshot（184233ms）；调用、嵌套等待、帧间隔不可相加为CPU/GPU critical path。旧辅助器的80px步长造成一次180度转向最多18次鼠标事件。

新的完整转向仍是有限的、最短方向的真实Pointer Lock鼠标gesture。现有输入handler以同一灵敏度处理；之后必须读回实际角度、可见卡片和ray。逐步模型保留为control。没有直接setView、代移动、扩大19次路线观察/18次移动、180次voxel尝试、到达容差或任何操作断言/时限。

- `whole-turn-red-25-01.log`：路线真实适配成功到达，但事件数超出新最多两次gesture合同，1 FAIL / 4 PASS。
- `whole-turn-red-25-02.log`：几何ray实际命中，但17次事件超过新合同，1 FAIL / 11 PASS。
- `whole-turn-green-25-01.log`：68 PASS / 2 FAIL；旧未选中的无响应路线夹具没有模拟Pointer Lock，触发了输入guard而非期望的耗尽。补齐夹具锁生命周期，保留失败及无键盘输入断言。
- `whole-turn-green-25-02.log`：5文件71 PASS，含旧门邻面/装备瞄准、无响应卡片不能冒充ray命中、原18事件耗尽。
- `whole-turn-helper-suite-25-01.log`：20文件181 PASS / 2 FAIL，后两项旧post-drift夹具与现有fresh-heading优先选择不一致，非本组新增生产行为RED。修订将反向hint约束到缺失heading fallback，并覆盖fresh-heading优先，不修改生产选择器。
- `whole-turn-types-25-01.log`：FAIL，新的只读视觉观察使用了共享Classic夹具视图中未声明的paused/ui。改用产品实际导出的HarnessSnapshot类型；25-02 PASS；新增所有20辅助器到类型选择后的25-03 PASS。
- `whole-turn-helper-suite-25-02.log`：格式/Lint与20文件184项PASS；root审阅删除了夹具报告中无法证明的“旧录制缺少view angle”历史推断，只保留明确的缺失heading反事实边界。
- `whole-turn-headless-25-01.log`：完整Classic类型与更新后canonical headless **67文件471项PASS**，136.71秒。原47的stdlib/kernel结果复用；本组只改输入辅助、测试选择、只读观察与证据，没有改生产规则或状态owner。
- `whole-turn-static-25-01.log`：完整静态门禁PASS，含frozen evidence5/5字节身份、全仓格式/路径/Lint、生产/根/工具/Classic类型、ESLint规则66项与CI selection14项；不将其当作真实产品验收。

视觉旧trace已经确认点击前fresh ray命中、Authority未暂停。最终暂停modal在失败后的exitPointerLock清理之后，不作为根因。新同线路观察记录真实down/up前后目标、Pointer Lock、交互尝试、正式player-state查询、反馈和提交状态；失败也保存。尚未认定或修复该生产根因。

## 远端与范围

[47f CI run](https://github.com/seedlands-game/seedlands-web-sandbox/actions/runs/37855205835)：deterministic、architecture、headless、build、static均PASS；Chromium先在V2超时，重试到V1后job被取消，preview SKIP。完整日志持久保存为`ci-47f-chromium-25-01.log`。23:19只读PR查询：open/draft、mergeable=true、未合并，无reviews/review threads；mergeable不等于验收或批准。

23:01UTC 产品真实周剩余91%，距初始98%的7个百分点包含同期其它任务；不按tokens/credits推算。停止线约60%。Cloud无法直接读取UI。原2d生产artifact11525739429未找到完整本地持久副本，当前验收使用新精确产物，当前不需要它作为基线；原浏览器trace保留期另算。没有为该核对下载、扩网络或启动重复开发。

本片仍未完成新的真实浏览器、完整194/V2-V4、非Classic正式producer与整帧组合A/B；不能宣布可合入。下一次验收绑定新的source/lock/产物身份，旧PASS不能替代。
