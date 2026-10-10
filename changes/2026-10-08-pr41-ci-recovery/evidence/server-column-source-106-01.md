# GameServer 同 owner 的列来源观察

基于14fcd40b的当前源，新server-column-source helper由GameServer窄入口调用，同一个canonical Map/Kernel epoch/worldRevision。真实provider generatedEmptyAboveY逐列cell聚合，缺声明或不支持generator返回unknown，不从identity猜51；这是程序生成空域保证，任意正负高cy edited/persisted键保留，不改世界高度。旧ChunkPersistence可选目录、当前resident/dirty metadata合并，resident优先；durable更新于resident、损坏/未知/容量不足均unknown、不返回部分complete。

查询不调用loadSnapshot/generate/ensure/getChunk，不消费prepared读缓存、不复制voxel、不扫描全部存档。只访问现有resident Map最多1024项，目录与合并最多128项，世界坐标安全边界检查；当前列vector、Kernel epoch/worldRevision或producer函数在异步目录期间变化返回superseded。返回detached metadata。目录只是point-in-time，后续写/跨tab不受永久negative缓存保证；outer Worker world epoch与实际Sky/R8/shader消费仍未接线，不是光照验收。

实际真实GameServer+Memory缺方法RED6FAIL→首6PASS。最终source20cases，包括生成cell上界、负生成上界、任意±10000cy、dirty与persisted-only、保存后clean、超限无partial、损坏回复/metadata、安全坐标、缺端口/不支持版本、throwing source以及异步edit/纯residency/restore epoch。Stdlib邻近列/目录/版本/源/旧generator save/residency/coordinator最终6files65PASS。此前6files59、6files61记录按当时覆盖保留，不重复累计。Web真实冻结/代理/restore3files14PASS，WebSvelte0errors0warnings+两项tsc PASS；stdlib production/根测试/Classic类型与范围ESLint PASS。

GameServer新增接线先触发max-lines514/503/501>500（三轮范围lint FAIL，链中后续types未运行，不冒充types失败/通过）；把原snapshot上下文拼装移到既有game-server-restore并将原完整ensureNeighborhood异步函数体移到canonical-chunk-observation，GameServer仍直接返回同函数Promise，原逻辑、参数和all-loaded早退保持。复用已导入GameServerOptions提供provider类型后500effective lines PASS，不增加例外或压缩格式凑行。上述load/save/legacy/residency/Web恢复回归覆盖提取范围。

私有证据在 /workspace/pr41-recovery-20261008-root-01/：server-column-red-106-01.log、server-column-green-106-01.log、server-column-{regression-106-01,regression-106-02,final-regression-106-01,final-regression-106-02}.log；范围lint106-01/02/03三失败保留，最终server-column-final-lint-106-02.log PASS；server-column-final-production-types-106-02.log、server-column-final-test-types-106-02.log、server-column-classic-types-106-04.log、server-column-web-regression-106-01.log、server-column-web-types-106-01.log。本证据与源码同提交，旧48d artifact/CI409不证明新SHA产品验收，完整headless/newidentified/Browser本组未跑，不重复已有效但旧源码的1235全量作新证明。

没有push/merge/automerge/main/生产部署。本组不解决CI409 V2时延、完整运输/194矩阵或统一lighting，整PR仍不可合入。08:26真实产品UI周剩78%，约60停止线；09:10刷新已请求待答。
