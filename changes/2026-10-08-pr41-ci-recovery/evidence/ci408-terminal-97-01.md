# CI408 终态：V2 未闭合

精确远端source407774d33838664fb7eb20b1456a3ea8bcb21735，run38031941067，Chromium job114154753956。[原运行](https://github.com/seedlands-game/seedlands-web-sandbox/actions/runs/38031941067)。Production build、deterministic modules、architecture static、Classic headless、static summary均SUCCESS；Chromium FAILURE，PR预览部署SKIPPED。主旅程原900000ms首次和一次既有CI重试均15.3m失败，视觉1.6m PASS、原native矿车42.5s PASS，Modular分支按原选择SKIP。不能由两专项PASS宣称整PR可合入。

两次主失败都在V2真实资源链，未进入C4；C4 pulse diagnostic记录0，因此此前等待新C4事实的计划没有得到该事实。日志中的V2 step结束8.4m/8.6m只是失败步骤耗时，不能说V2已成功完成。首次栈waitForSnapshot→walkTo→followEquipmentRoute→mineResources→prepareCraftedIronArmor；retry栈expectPresentedDropOrPickup→mineResources→prepareCraftedIronArmor。均由总900秒耗尽中断，不能凭这些栈认定某局部predicate在自身时限内永久不满足。

首次07:00:55.827 UTC：player[89.41607666015625,32.599998474121094,-0.46281951665878296]，Authority[89.41607580127564,32.6,-0.462819507130108]，velocity[0,0,0]、ground=true/colliding=false、revision169、tick58445、ACK5018，resident67/dirty1。retry07:16:23.545 UTC：player[90.46951293945312,32.599998474121094,-0.49797070026397705]，Authority[90.46951333197435,32.6,-0.49797069620916795]，同样静止ground=true/noncolliding、revision169、tick58567、ACK5048，resident67/dirty1。终点与输入决策累计计数尚不能解释累计耗时或授予增大pulse/缩短旅程/降低断言/关trace/改质量/延长时限的依据。

Decoded完整job日志158676bytes，SHA256 bcb28b2bf9ba7db5adac6f18b77c3929d308b17ad00f2b0bcf31886b8f41692e，Root独立ci408-chromium-decoded-log-01.txt；两条精确时间的派生motion与artifact元数据另保存。GitHub报告results/trace artifact11663118516为202552455bytes，digest f5872b4c697da0cb20634470894af82d1b7b121e6ad5ee48045ba6bbc719ceac；HTML11662778867为215798424bytes，digest acdbfdef5d37a25b9da015306815f4cc12170f082fe8503d4950298a3eca17a7，均10月17日过期。这些是平台metadata，ZIP未本地物化/校验，不冒充实际UI或receipt查阅。

后续先给V2现有真实路由/资源操作补只复用原观察的有界耗时诊断，再按新证据处理，不盲目重复原full旅程。目录版本96是另一个已批准Sky来源前提，不能解决或解释该V2失败；完整lighting/GPU、运输/194矩阵与主旅程仍未闭合。长期docs不因该失败修改。
