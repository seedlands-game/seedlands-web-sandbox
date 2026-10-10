# 失败控制台Authority字段收窄 checkpoint74

真实CI71在66467feb输出的motion.authority含额外physicsCost样本数组，说明TypeScript窄类型没有收窄运行时对象。沿原同一次snapshot显式选择physicsTick、acknowledgedInputSequence、commitSequence及residency的evictionCount/residentCount/dirtyCount；null保持。完整snapshot附件及源对象保持，不新增采样、输入或状态修改。

实际collector新增运行时额外字段反例，旧代码1FAIL/3PASS；候选4PASS/EXIT0。原有效snapshot、未启动、错误及输入诊断三例断言保持，新例验证顶层与residency内部额外数组不进入控制台且原对象未改。独立日志 `/workspace/pr41-recovery-20261008-root-01/failure-motion-narrow-{red,green,types,lint,format}-74-01.log`；Classic类型与相关lint EXIT0，最终格式及commit hooks另记录。复用73完整116文件726PASS和工程16PASS，不重复未受影响全量。

此片仅收窄既定诊断合同，没有性能收益或产品PASS声明；真实CI控制台形状待新SHA检验。73 GPU失效的真实WebGL像素仍未验收，统一sky照明、全Classic、运输和组合性能仍有阻塞。00:38开始，00:39本地闭合；传统0.05PD×120%=0.06PD、AI5min×120%=6min，仍在00:44有界checkpoint内。

最近真实产品UI00:09UTC剩82%/5d2h，约60%停止线；实际服务型号未核实，不换算tokens/credits/API。原sealed证据不改，长期docs不改。CI71自然terminal FAIL，新分支push只触发既有授权PR preview门禁；不合并、不启用自动合并、不生产部署。
