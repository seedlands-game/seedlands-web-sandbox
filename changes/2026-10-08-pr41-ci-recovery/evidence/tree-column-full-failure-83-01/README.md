# checkpoint83 完整生产Classic：FAIL

绑定source2b17241b64dfba61147444d9187881cddc32e942、artifactefd549f30cc12570084c5742f33bbe9de2b3e522582dafe114a68600ffd5a580，canonical run pr41-tree-column-full-browser83-01。runner exit1，CANONICAL_MAIN终态FAIL；1失败/2通过/1默认跳过，17.3分钟。本地没有CI retry。原源码/断言/900000ms、mouse/key/Pointer Lock/WebGL2保持。

C0–C3有实际PASS证据；作物导航和V1完成并进入V2，不能外推最终保存恢复。V2到wood-pickaxe阶段，第一块stone86取得1 cobblestone、木镐durability59；到第二块stone88时耗尽总时限，未到C4/C5、全装备、死亡或恢复末尾。最终目标88,31,2、玩家/Authority位置一致且速度0。诊断中breakAction有效，elapsed0.6/required1.2；trace末尾mouse.down在902735.386ms，getVoxel轮询902853.109→903437.953，903448.670进入catch。原8秒poll实际不足0.6秒，支持外层时限截断，不足以认定挖掘模块故障。退出Pointer Lock后paused是清理态，不倒置成早先原因。

视觉v3 PASS1.3分钟；同一次完整suite的原生矿车PASS25.8秒；默认模块化SKIP。它们不替代mainFAIL，也不宣称全部运输/照明/连续像素或产品完成。出生Worker2701.9ms、first-visible915.6ms，仅同次功能诊断；旧CI或其它source/环境不作A/B。

trace API累计：完整snapshot函数前缀2281次187688.625ms，DOM click211次184922.767ms，keyboardPress399次69059.549ms，mouseMove144次43825.702ms；嵌套/观察/排队时长不可相加为critical path。末尾frame interval p50=469.2ms、p95=1206.5ms；最后128个CPU观察中update median21.35ms、tick27.05ms、inter-tick gap405.15ms、receive-gap34.8ms，异步GPU/浏览器调度/trace成本未归因，不能单凭这些指标指定根因。整帧/组合受控AA/AB未完成，无性能准出。

validation.json保留精确产物、失败frontier/库存/挖掘、trace ZIP单文件SHA256及当前80%周额度读数。trace原始495MB浏览器JSON只按需流式读取，本ZIP未删除/改写；不复制历史证据。当前候选未正式采用/未推送，原远端778811f6 CI80主旅程和矿车FAIL仍保持。后续先诊断主要延迟差距，不能提高总限、减少断言或拿微测代替最终消费者。
