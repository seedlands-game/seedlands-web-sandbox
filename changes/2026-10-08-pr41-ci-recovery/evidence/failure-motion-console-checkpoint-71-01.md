# 失败控制台同次运动观察 checkpoint71

## 实际问题与最小改动

精确5790da0的CI69两次主旅程在V2铁矿资源路线耗尽原900秒。现有failure collector已调用正式harness.snapshot一次，用于观察相邻chunk，却未将玩家/Authority位置、速度、ground/collision与ACK输出到控制台。完整失败附件包含snapshot，但云环境ZIP传入仍待具体域名许可；没有绕过权限或伪造附件。

在d9d41f18上，仅把同一次snapshot的窄motion字段加入presentation诊断：player、serverPlayerPosition、serverPlayerVelocity、viewAngles、onGround、colliding、worldRevision、authority。沿用diagnosticOnly:true/eligible:false；尚未启动时null，snapshot抛错保留原error，独立input诊断和startup字段保持。没有新采样、状态写入、输入/时限/断言/质量/调度改变，也不宣称V2修复或性能收益。

## 验证

private `/workspace/pr41-recovery-20261008-root-01` 独立日志：

- `failure-motion-red-71-01.log`：真实collector执行2FAIL/1PASS，有效snapshot与未启动分支缺字段；异常分支原行为通过。
- `failure-motion-green-71-01.log`：四文件17PASS/EXIT0，含新三项、canonical reporter及70的telemetry/scheduler诊断；验证snapshot仅调用一次，不冒充真实Browser。
- `failure-motion-types-71-01.log`：Classic正式测试类型EXIT0。
- `failure-motion-lint-71-01.log`、`failure-motion-paths-71-01.log`：相关lint与路径检查通过。
- `failure-motion-ci-selection-71-01.log`：工程16项PASS。
- 确定性JSON比较：package除原headless选择末尾追加一条新路径外全部相同；Classic类型include只追加同一条，原选择及字段保持。

复用70最终完整static和113文件704项headless的有效输出；71只改变failure collector和新诊断测试，使用相关增量检查，不把未重复运行项标成新一次PASS。两项本地commit完成后一起正常push，只触发一次新head CI；新head真实控制台字段/完整Classic及合入验收仍待结果。

## 预算与边界

传统0.1PD保守×120%=0.12PD；AI12分钟保守14.4分钟，00:12开始。真实型号/credits/API不可核实，不换算周额度；最新23:09产品UI82%/5d3h，刷新待答，约60%停止线保持。长期产品docs不更新，未改变owner或产品合同。PR保持Draft，不合并、不开自动合并、不部署生产。
