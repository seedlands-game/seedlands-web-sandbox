# Geometry fixture 对齐真实 floor

有效RED是旧严格position断言：64.995而非65。实际Modular provider的floor常量为32，fixture仍Y65起步、接受cy2（全Air）的原生成数据，未建立被测支撑面。临时使用407旧stdlib worldgen模块的对照也同样失败；候选module原字节恢复并校验SHA，不能把这个基线fixture问题归因于94新增source端口。

只修deterministic fixture：由原MODULAR_WORLD_FLOOR_Y/CHUNK_SIZE推导player start=floor+1、floor chunk坐标/key与placement/recovery目标。接收的仍是原provider实际生成canonical，新增断言floor单元确为500；没有手改生成bytes、metadata或碰撞实现。

原4位position精度、20ms wake、blocking/open差异、player-collision拒放置、open正常放置、recovery增长、registry隔离及真实Worker mesh断言全部保留。相关geometry3例＋Modular4例，2files7PASS。原失败与对照日志保留，不放宽断言或假设0.005容差。该deterministic证据不是浏览器产品、全运输/lighting或完整矩阵通过。

本片不触碰browser场景坐标、原C4输入或超时。94生产source在本片不变，随后两片合用一次最终SHA identified artifact和唯一原native回归，分层记录结果；CI408自然运行不取消。长期docs不改，因为无生产协议/owner/世界规则变化。

07:14UTC补充：最终source2682a223的同一identified build与原native均PASS（1.6m、NON_MAIN），精确source/lock/artifact与原始JSON身份见generated-source-bound-94-01.md。构建和矿车回归不是该geometry单元的浏览器产品证明，也不覆盖完整Classic/lighting/194矩阵。07:10实际周剩79%；远端仍407774d3、CI408 Chromium运行，不提前报告其通过。
