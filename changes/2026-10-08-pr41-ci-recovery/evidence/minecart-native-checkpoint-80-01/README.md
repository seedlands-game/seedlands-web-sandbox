# 普通矿车原生输入验收 checkpoint80

精确源码 `5eee6e15eb165cc4c1898c038ef23ae8ecedb089` 与生产产物 `14285c69e9209342d7d57192ccd232d7cda19c7942b02cb247103caed040aff9`：唯一 canonical runner 的普通矿车用例45.0秒PASS，runner48.9秒，receipt明确NON_MAIN。真实右键部署/骑乘、W行驶到轨道终点、停稳、Shift右键下车、保存重开全部断言通过。矿车从[2.5,31,0.5]至[9,31,0.5]；恢复保持位置、无乘员，旧ECS引用epoch1为stale，新epoch2为current，三个WorldHarness frontier属于同一当前world epoch。没有降低原时限、输入或产品断言。

保留native77/78/79失败：77是测试误要求恢复后ECS引用不变，78是新增测试误要求跨页面runtimeEpoch不同，79是误将runtimeEpoch与WorldHarness epoch混用。80-01类型FAIL也保留，修正成功分支/string守卫后80-03 exit0。此前Logic有效RED与两条旧预加载故障反例以及当前消费者GREEN见checkpoint77；没有用测试契约修正代替生产body消费者修复。

本轮raw JSON从完整HTML报告的内嵌ZIP精确提取；PASS时配置不保留trace，不能声称有PASS trace或视觉连续运动证据。部署PNG经查看能看到实际矿车模型；恢复PNG被诊断面板/天空视角遮挡，只有权威保存恢复状态证据，不声明恢复后模型可见或照明正确。附JSON绑定本轮raw文件字节，不复制历史证据。

全stdlib1196PASS/1条原CLI15秒超时、完整Headless793PASS/2条原5秒超时及隔离PASS仍按原结果保留，不改写为全量GREEN。该纵向验收不代表完整Classic、统一照明、完整运输类型/非空旧载具迁移、Modular、整帧性能或整个PR可合入。

长期docs baseline在77仅更新真实配置body消费者公共合同；本轮为测试契约与运行证据，无新增长期架构约定。最新真实周额度03:09为81%，原约60%停止线保持，无token/credit百分比换算。
