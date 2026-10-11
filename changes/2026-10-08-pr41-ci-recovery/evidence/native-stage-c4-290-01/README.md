# C4阶段可选原生诊断290

显式 `SEEDLANDS_CLASSIC_NATIVE_TRACE_STAGE=C4` 在原主旅程beforeEach登记请求，到原C4 step才创建CDP并采集既有5秒窗口。默认仍main阶段、六分钟延迟。未激活只记录NOT_STARTED；初始化失败记录FAILED与原错误；不生成虚假trace。source/run、冲突、dataLoss、stream close/detach及既有资源上限保持。

首轮RED5失败/4通过，setup失败边界RED1失败/11通过；最终相关3文件39通过，新owner12例，包括完整五秒stream和数据丢失拒绝。类型、lint、选择17、冻结5/5与全仓格式通过，详见validation.json。新owner只加入现有Classic headless选择，原e2e类型覆盖保持。

此回执只证明诊断边界，新的真实C4 trace尚未运行。原main/C4、视觉flaky及完整产品验收仍未关闭。所有诊断都diagnosticOnly/eligible=false，不宣称性能改善或正式PASS。
