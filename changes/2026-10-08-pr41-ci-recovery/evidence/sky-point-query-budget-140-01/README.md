# 单列 Sky 点采样查询硬预算140

139 实际profile已核实：每个表面点采样都经 WorldSkyLighting 扫描全部注册 entries。140只将点采样校验限定到其所请求chunk的完整16个column dependency revisions；原每帧/request/notifyCommit全局失效、failDark、epoch/revisionFloor、异步源/proof/current publish保护完整保留。没有时间缓存或粗worldRevision缓存，不改Authority/输入/渲染/shader/CI/predicate/旧断言。

预注册的唯一主指标是固定4个ready air columns、64个同位置点采样的revision lookup次数。旧A/A均4096；B最终精确array assertion核实均1024，减少75%，恰为每sample16次。passing reporter未输出console，保留两次尝试并以exact assertion为证，不伪造raw。确定性计数无需计时A/A噪声，不宣称frame、keyup、GPU或终端用户延迟改善。

原Owner加新合同33PASS；最后将primary断言从上限加强为精确两个值后单项1PASS/32SKIP。另8个消费者文件59PASS，共9个unique files/92tests，重复计数不叠加。目标same-world-revision revision/residency变化即时dark；未采样的其他columns在原frame/commit/epoch边界全局dark，原async superseded/roof/unknown/save guards均通过。Web types（Svelte0error0warning）、含该unit文件的Classic types与定向lint通过。

第一条Vitest用了root Kernel/stdlib config而NoTestsFound，NOT_RUN；实际Web config初轮五个新增failDark次数断言把缓存注册遗漏，修正为观察基数+1后，仅真实查询预算RED1FAIL32PASS。所有原负日志保留。没有降低原门槛或排除用例；旧identified artifact不是本候选的Browser验收。新的build/原无sampler主旅程/精确CI另登记，136支持坡道和其余产品矩阵仍开放，PR仍不可合入。

这是独立查询硬预算的exact A/B准入，不替代最终组合端到端性能证据。长期baseline未改。UI17:54实际周74%，18:52已请求真实新读数，约60停止线，云端不能直接读取UI。
