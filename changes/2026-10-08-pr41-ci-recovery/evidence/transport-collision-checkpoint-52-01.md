# 当前运输身体的正式碰撞消费者

本组接续精确 `4a477ad8071b57b4cc8a6b2fcbf0c1444d879f2e`。实际创建世界、通过正常创造目录选择运输物品、registered deploy 后切回 Survival，合法 receiveInput 和 55 次 50ms Authority 推进取得行为 RED：玩家穿过载具到 x=12.7083。无载具对照沿同路越过 x=3.5；载具的最小 x=3.1、玩家半宽0.32，接受上限2.80含原夹具0.02容差。生产接线后同夹具 GREEN，玩家在体积前停止且完整运输 snapshot 保持（pose、velocity、component、cargo、fuel、rider、reference）。这是实际 headless Authority caller，不是浏览器验收。

## 实现与状态边界

`authority-transport-collision-world.ts` 从该次当前 ECS entities 和 world-local body config 派生只读 colliders，没有跨 tick、restore 或世界的缓存。普通身体/flight、角色分离、已存在的 geometry recovery 使用这个 PhysicsWorld；transport 自身排除。原 VoxelCollisionWorld 的 unknown blockers、fluid 和 active chunks 继续由原实例处理。无 transport 时返回原 PhysicsWorld；现有 layer/mask 保持，Item 的原 World-only mask 不会因此新增与 Character 的碰撞。

提交仍沿原 physics entity batch 与 EntityStore/Kernel frontier；没有新运动 owner、注册 operation、Host grant、输入字段、policy 或协议/快照 schema。mounted rider 的原 seat 约束保持；正式 registered motion 和两向移动实体 sweep 仍待接线。

运输 body 统一使用 definition AABB 的 canonical yaw 保守包围盒。风险检查取得两个有效几何 RED：非对称实际 ECS 载具旋转90°后，旧占位检测返回 null，且两个标为 safe 的出口与实际 body 重叠。现在 physics body selector、route deployment 候选、已存在载具占位与四出口使用同一 helper。零 yaw 保留原 definition AABB；旋转 AABB 是保守形状，不声称精确旋转多边形求解。

## 真实检查结果

- Authority 新 consumer 1/1 RED→GREEN；根最终四文件24/24 PASS，包含既有部署、关系、死亡、mounted输入和 portable restore 反例。
- 新投影3例、yaw geometry3例和旧 loaded geometry4例：三文件10/10 PASS。根最终 stdlib 八文件36/36 PASS，覆盖旧 session、checkpoint restore、creative physics、voxel geometry/unknown 与上述新夹具。
- 完整 `pnpm verify:static:ci` 实际 EXIT0：sealed evidence 5/5字节保持，格式、路径、全仓 ESLint、生产与测试 types PASS，Svelte 0 errors/0 warnings、ESLint规则66/66、CI selector14/14。530行的 authority-session 仍通过原500有效代码行门禁，未改门禁或 allowlist。
- 精确 Classic Pack control/candidate 字节相同，SHA256均为 `3bb6fb967fb270e97d1843892734863c64fdb20f3f3709ec18a04a7c782bcb33`。此检查仅证明 Pack entry identity，本组没有运行生产 app build、本地浏览器或性能采样。

真实 Authority RED 的前四次 setup 错误分别涉及未加载地形/无效 no-op，均保留且不计行为 RED。使用正式 `prepareCanonicalChunkForMutation(0,1,0)`、读取和只编辑实际有差异的格后，第05轮取得上述穿透 RED。yaw fixture 首次用 inventory=null 违反原空容量数组合同，改为[]后才取得2 FAIL/1 PASS有效几何 RED。投影 helper 最初 missing-module RED 是缺API证据，与实际穿透 RED 分开记录。

原始日志位于 `/workspace/pr41-recovery-20261008-root-01/transport-collision-*52*`、`transport-yaw-geometry-*52*`，实际 caller 的原 RED/GREEN 在 `/workspace/pr41-recovery-20261008-fixtures-01/task109-*`。保留失败、修复前后和真实进程 exit；不重复历史 evidence 或改写 sealed bytes。长期 code-map 更新对应新派生消费者，其余架构 owner 合同保持。

## 前驱精确 CI 与剩余阻塞

远端 run `37934652652` 的精确 `4a477ad8`：Architecture、Static、Deterministic、Classic headless、Production build 五项 SUCCESS，Chromium job `113834011112` FAILURE、Cloudflare SKIPPED。原日志在下一组 push 前保存。首轮 V1 离开支持地面，目标73.5,2.5；retry 的新放置门 mesh 原5秒断言期望[0,0]、实得[-1,0]，即一侧没有可读的实际门 material mesh。最终1 failed /1 passed /1 skipped、16.7分钟；并未通过或被本组推送取消。

运输静态障碍物现在可被正常输入阻挡；这不闭合正式车辆运动/燃料/货箱/UI、Classic/Modular生产消费、旧非空载具迁移、完整194项与C0–C5、组合整帧性能。远端浏览器日志尚不能单独证实缺mesh的根因，继续从实际调用与可执行反例定位，不放宽时限、断言或画质。
