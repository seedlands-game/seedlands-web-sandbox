# 历史断言与当前保护

基准为 `c18a890c7f97f76421e13565ec628d8c50a942da`。[逐场景与断言索引](assertion-migration-ledger.json)读取该 SHA 的全部 Playwright `testMatch` 源，保留文件摘要、测试标题、行号和直接断言。历史 opt-in 和实验也在索引内，数量不代表每次旧 CI 实际执行量。辅助函数、参数化循环与间接断言仍须查冻结源码；索引不是等价证明。

## 去向

- Kernel、stdlib、Classic、Agent、Web 和 ESLint 的原确定性测试经 [初始目录映射](test-owner-map.json)、[Classic 集成映射](classic-integration-test-map.json)、[Web runtime 映射](web-runtime-test-map.json) 和 [局部 benchmark 映射](benchmark-owner-map.json)继续维护。路径映射可以串联；最终有效集合由 registry 和 runner 的实际报告对账。
- 旧隐式默认内容改为测试明确选择 Classic 内容。原未装配模块的测试仅注入内容与生成器，不能用完整 Classic composition 增加原先不存在的系统、combat schema 或调度器；原显式 composition 保持原样。迁移不以改断言适应新的默认行为。
- 旧正常路径中移动、跳跃、跨 Chunk、采集、拾取、合成、放置、战斗、NPC、存退继续与 Worker/Wasm 消费进入唯一 [Classic 场景](../../playbooks/classic/scenarios/canonical-runtime-v1.json)。只有新回执实际完成的观察点可标 PASS；其中局部重叠不能覆盖同名旧测试里的全部断言。
- 支撑/薄平台/登阶规则保留在 `packages/stdlib/tests/physics/step-body.test.ts`，预测新鲜度保留在 `apps/web/tests/unit/client/local-player-prediction.test.ts`。旧浏览器整段轨迹仍是非等价缺口，不能只凭纯逻辑绿测宣称浏览器保护保持。
- 历史性能 A/B、长时间 soak、视觉矩阵和外部真实模型场景退出默认线路，原源码/结论保留。新的 `bench:local` 与 `bench:runtime` 使用新身份与边界；旧样本没有自动晋升或与新样本混算。

## 显式缺口

确定性测试另有 [422 个 base 文件的迁移索引](deterministic-test-migration-ledger.json)，记录源码摘要、目标路径、测试标题与直接断言。三个数量减少项已单独核对：monorepo 包规则拆为独立规则反例及 Web 仓库装配检查；Pack 的退役历史根替换为活跃 Playbook 根，正反例保留；SDD 治理将旧命令矩阵合并为新入口合同，并保留原先建立反例、独立评审和授权边界断言。Worker bootstrap 曾遗漏的握手、去重、失败与 transfer 保护已恢复。数量只用于发现需复核的变化，不作为语义等价的裁决。

索引中的 `GAP_NOT_EQUIVALENT`、`LOWER_WITH_BROWSER_GAP` 和 `INTEGRATE_PARTIAL` 都不能被计作全部保护已迁移。特别包括：无 JS 首绘与 hydration 连续性、窄屏 Macro/F3 UI、资产工作台 IndexedDB/导入/编辑/视觉矩阵、灯笼高画质阴影、水体视觉/音频、真实后台/故障注入、300 Chunk 与长时资源 soak、完整指针拖放/容器组合、完整成长路线、三居民与真实模型/PG 连接。

本 change 批准的是唯一浏览器线路与可见的缺口账本，不是全浏览器历史等价承诺。未重现保护保持未验证；不得把删去历史默认发现、编译成功或单条线路成功写成这些场景全部通过。后续新增浏览器观察必须进入同一 Classic 的已批准范围，或由独立需求选择人工/外部验收，不恢复第二套隐式 Playwright 矩阵。
