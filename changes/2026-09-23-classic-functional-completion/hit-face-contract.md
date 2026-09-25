# 体素交互命中面可见性合同

状态：冻结，供 V1-HIT-FACE-CLOSE-01 实施。

## 坐标与输入

1. 权威 Gameplay entity.position 是 body/feet。Browser Harness 的 serverPlayerPosition 为方便对照相机，在该坐标 y 上加 PLAYER_FEET_OFFSET=1.6，因此不是 body位置。
2. 体素交互只接受整数 hit/adjacent；二者必须 Manhattan距离1。客户端不提交可信相机、精确命中点、物品或operation ID。
3. Dispatcher从权威entity.position计算 playerInteractionOrigin，不能信任Browser camera。Browser04实际body为 [65.34008376511767,31.000001,2.602567930028762]，对应eye y=32.600001。

## 权威门禁

1. 保留 hit center和adjacent center各自5格范围门禁。
2. 在LOS前分别权威读取hit与adjacent。任一未加载返回 chunk-unavailable。
3. hit voxel必须由当前composition voxel semantics声明 targetable=true；Air、non-targetable和未注册语义统一返回 invalid-target。
4. hit LOS终点由已校验正交delta推导：hit center + delta * (0.5 + 1e-6)，即共享面向adjacent内部微偏，统一正负方向的floor语义。不得修改全局traceVoxelRay。
5. adjacent center LOS继续独立执行。墙、背面伪造、unknown内部cell仍分别返回blocked或chunk-unavailable。

## 验收

- Browser04实际body、hit [68,30,2]、adjacent [68,31,2]、floor [67,30,2]/[68,30,2]必须可由正式Authority water-bucket放source，再由bucket收回。
- 六个正负轴面端点均可达；diagonal、超过5格、墙/背面、hit/adjacent unknown、Air/non-targetable/未注册语义和stale selection均在invoke前拒绝。
- 拒绝路径不写world、inventory、commit或operation receipt。
- Browser03将eye 32.600001误作initialPlayerBodyPosition的fixture必须更正；历史Browser03 RED仍如实保留，但不再声称该fixture复现Browser04几何。
