# checkpoint69 正式注册路线运输运动

基线 head 为52f41c10da6761fa6afc15794166d8515bcc4021；本片修复原motion模块仅允许surface定义，复用已冻结RouteDefinition/TransportState与现有Authority manual system、prepared ECS frontier。非Classic真实组合的正常部署、mount、accepted world-space输入现在进入route adapter。沿directed cursor前进，负输入仅减速到0，垂直于航向的输入不产生加速；不静默反转cursor。

部署和运动共享局部端点高度邻格逻辑：sourceY+exitLocalY-entryLocalY。当前/候选轨道格先经frame.world.querySolids观察包括non-solid轨道的chunk revision，再读取loaded voxel；unknown/断开/多个可连接高度失败关闭。原64transition上限与4096碰撞格上限保持。没有新增权限、存档格式、Classic默认轨道定义或持久状态owner。

碰撞使用实际yaw的carrier及rider body；quarter arc使用全yaw半径与半径0.5的最大弦偏差包络。第二pass从同帧first-pass候选Map取得另一载具实际路径总长L，使用XZ/Y保守包络覆盖其任意多曲线/坡段相对端点弦的偏差。既有surface adapter也在对方为新route provider时复用此包络；surface→surface原分支不变。Map不跨帧，不写World/EntityStore，候选仍重投影并经现有原子发布。实际Authority入口先held transport body、再调用registered motion，符合first-pass对静止载具安全、second-pass仅停车的前提。保守包络可能使近距离并行运输提前停车，不宣称精确time-of-impact或性能改善。

## 反证与定向验证

- 正式注册RED：合法非Classic route组合在构造时被旧surface-only门禁拒绝，不是浏览器或迁移证明。
- 实际Authority八例覆盖正常部署/mount跨平轨格、上坡world-height/cursor/rider一致、loaded墙、移动中before-rule veto、ActorHost身份拒绝、横向无加速、逆向刹车、实际route World revision race不发布陈旧pose/cursor/rider。
- 几何30例覆盖两个直轴/四角/四坡的正反 directed pose、unknown/非route/断开/多高度邻格、真实观察格、carrier弧线外侧和rider-overhang，以及route→route/surface→route同步弧线碰撞。后两例先检查真实first-pass clear、独立字面端点、无contact的relative chord控制和同步字面AABB相交，再观察旧实现漏判；有效Task130 RED-03和根补齐own-body后的mixed RED均保留。
- 最后相关四文件37项PASS；此前七个Authority相关文件43项PASS属于混合碰撞修复前的版本，不能冒充最终完整回归。

## 静态与完整回归

生产源码冻结后，完整verify:static:ci第一轮通过；随后新增相对/mixed路径修复按实际差异补齐检查：全部workspace生产types与Svelte0errors/0warnings通过，修复测试后tsconfig.test/tools/classic-tests三集合EXIT0，受影响lint/format及完整paths检查通过。新增测试达到688行时max-lines实际FAIL，未豁免规则，原样拆为route与mixed两个文件；测试没有删断言。

混合夹具类型错误实际是frame session epoch误用了数字entity epoch。根初次误读后移除未使用reference覆盖仍FAIL；核对精确行后改显式会话字符串，保留真实实体引用与失败日志。不能把原typecheck EXIT2改写成通过。

第一轮完整stdlib165文件1194项为1193PASS/1FAIL，既有CLI用例15.97秒超过原15秒；保持限制，隔离原文件7/7PASS。修复mixed并结束并发types后，最终串行完整stdlib166文件1195项PASS/EXIT0，147.38秒。此前完整headless111文件695项PASS属于mixed修复前；最终冻结源码完整headless111文件695项PASS/EXIT0，217.50秒。最终源代码在两轮完整回归期间未改动，全部本地必要检查已完成。

package.json仅在原headless选择尾部追加实际route Authority文件，逐字段与基线比较其余值不变；Classic类型集合追加同一文件，stdlib新文件走原glob。没有修改CI选择、重试、浏览器时限或断言。本片无新identified build、Browser或性能结果。

## 远端与范围

基线CI68自然终态：build/architecture/deterministic/headless/static SUCCESS，Chromium FAIL，部署SKIP；首次V2资源路线耗尽原900秒，重试V1门mesh原5秒观察得到[-1,0]，visual PASS、Modular SKIP。完整原始results/trace及HTML分别上传139049592/150359464 bytes，均低于工具536870912-byte cap；ZIP目录和trace内容尚未传入环境验证。CI66证据下载引用的云传输HTTPS代理403已报告具体域名，网络许可仍pending，无绕过。

不能据模型/Authority/静态/构建宣布完整运输产品或PR可合入。正式运输UI/燃料货箱交互、Classic/Modular内容声明、非空旧载具迁移、完整Classic C0–C5/V1–V4/死亡保存194、统一生产照明及组合whole-frame性能仍未准出。长期docs暂不更新：沿既有provider/事务合同实现缺口，没有新增长期架构决策；这不代表这些产品功能已完成。

预估传统0.9PD、AI72分钟均已含120%保守量；22:48开始，23:18有界checkpoint报告，23:30完成本片实现、有界审阅与本地必要验证，约42分钟；新精确SHA CI和剩余产品验收继续独立核对。23:09真实产品周剩82%/5d3h，约60%停止线保持；账户总下降包含其他任务，不换算或独占归因本PR。服务型号与credits/API计量未核实。
