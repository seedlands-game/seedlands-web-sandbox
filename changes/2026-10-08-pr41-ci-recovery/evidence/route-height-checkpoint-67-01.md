# checkpoint67 路线部署邻格高度

基于head894e81529b23d8b1dab32fdeaf1a1c4aab00a7d8修复。出口与邻格反向入口均为局部坐标：候选邻格原点Y必须为sourceCellY+exitElevation-entryElevation。实际family的全部反向入口高度去重读取；任一可能邻格unknown先返回chunk-unavailable，多高度连接拒绝ambiguous。缺反向端口与错世界高度均disconnected，边界非safe integer仍unknown。没有新配置、权限或owner；不加入Classic轨道定义。

行为RED：原源码初始8项7FAIL/1PASS；扩展四方向负高度与缺反向端口后13项12FAIL/1PASS。包含错高错误接受、正确坡道错误断开、unknown错误断开与多个高度错误接受。所有失败输出保存于独立private run ID，未把夹具构造失败当RED。

正式registered Authority RED：同样三个literal cell `[0,58,0]`、`[1,59,0]`、`[2,60,0]`，旧源码真实performAction失败，其余原7项PASS；候选正常操作成功、实际库存扣一且cursor/pose `[1.5,59.5,0.5]`匹配，三份World体素不变。共享fixture只增加显式routeElevation1可选参数，默认0保持原flat内容及权限。

冻结候选GREEN：stdlib四文件34项PASS；共享fixture全部六个实际调用测试文件35项PASS/EXIT0，包含部署、碰撞、关系、死亡、保存、运动及新鲜度反例。最后完整stdlib164文件1165项PASS/EXIT0，22:32:52起182.70秒；最后完整verify:static:ci EXIT0，生产/测试types、格式、lint、66项ESLint规则及16项CI工程合同通过。

第一次完整static/stdLib虽均EXIT0，但与旧源码反证的短时替换重叠，不能作为冻结候选证据；已保留并明确作废该层结论。第二次在源码冻结后运行，未再替换源码。没有新Browser/build/性能结果：当前CI66自然运行，整体Classic、正式route motion/运输UI、旧非空迁移及完整V3/V4仍未完成。

根有界复核全部四个源码/测试文件及相关RouteDefinition坐标与配置，未发现新的可证实P0/P1/P2；此非完整PR审阅。传统预估0.24PD、AI36分钟，本片22:24–22:36完成候选与必要检查约12分钟，不能换算额度。22:09真实剩83%，约60%停止。长期docs不变：修复既有局部端点合同，不产生新产品范围。
