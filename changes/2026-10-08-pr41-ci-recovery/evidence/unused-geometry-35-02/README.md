# 未命中自定义 geometry 的完整网格任务对照

状态：局部分项 A/A、A/B 通过；真实 Browser/整帧与组合端到端验收未运行，不能据此声明产品完成或可合入。

Browser17 后的只读 phase 诊断发现18个完成任务的 WorkerMesh aggregate 9891.8ms，中位492.9ms，最大1217.9ms；WorldGeneration3424.5ms、HaloSample2758.9ms。嵌套与队列等待不能相加为关键路径。定位到 Classic 全局门 geometry registry 使无门区块也走 JS 网格。候选只改变这一分派条件：完整36³ window 无任何已注册自定义 voxel 才调用既有 W04/W05，命中 canonical/halo/水面第二圈仍走 JS；W06 pack、未知内容及所有权约定不变。

控制 A 使用原 whole-registry JS mesh 分支和同一 W06；B 使用候选 W04/W05 与同一 W06。两者均计完整 `runWorldComputeTask` 的准备、mesh、pack；同一真实 Classic provider、seed1947、generator3、chunk0,0,0、27个自然邻块、halo/fluid、door registry、机器与 scalar Wasm。匹配语义、材质、分类、layout、顺序及五组 typed array bytes，owner输入哈希每次一致，kernel.failed 为false。

独占窗口35-02保留2次warmup、A/A8对共16样本、平衡AB/BA8对共16样本。A/A中位767.813646/790.5568765ms，偏差2.9188476%≤15%；AB中位A765.3202725/B14.4374225ms，改善98.113545%≥20%。这些不是核内计时，也不是FPS/整帧收益。输入216216bytes；B上传 descriptor window/semantics140808bytes/任务，W06已知输入copy bytes逐样本记录；未transfer/detach owner。派生window生命周期限该任务，没有新持久cache。

精确身份：HEAD28e3119bae38a4ac766fc9099ce3fdc2be3ddebb加dirty候选；sourceDigest158f1af0a0a92e3fc241683b49b93445167464275bdffb78995fcd6bdf1e507e，前后不变；scalar Wasm611c45804d9be51378388c8e7139620e2bbbeb089fe39cbf71792d712a9e7f45。sourceDigest在读取前仅选择物化code/config，排除历史sealed evidence。runnerDigest为外部测试、配置与包装器，不冒充生产bundle身份。后续需新的生产build与Browser验收。

35-01测试断言虽通过，但stdout未收到raw report，wrapper返回FAIL/eligible=false；原始失败measurement与reservation保留。35-02仅改计时结束后的raw JSON输出，不改fixture、门槛或sample规则。官方reservation为PASS/RECORDED，完整JSON保留所有原始样本与声明。

可恢复Cloud路径：`/workspace/pr41-recovery-20261008-fixtures-01/unused-geometry-35-benchmark.{test.ts,config.ts}` 与 `/workspace/pr41-recovery-20261008-root-01/unused-geometry-measure-35-02.mjs`。必须激活已发布环境、独占 `scripts/benchmark-window.mjs`，以新run ID和独立声明/measurement路径运行，不能覆盖本证据。功能RED `unused-geometry-35-red-01.log` 为有效ABI调用缺失；GREEN `unused-geometry-35-green-01.log` 三文件11/11通过。canonical CI新增同组回归。
