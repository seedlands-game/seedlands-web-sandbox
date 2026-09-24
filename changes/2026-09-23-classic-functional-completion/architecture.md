# 分层与公共接口冻结

本文件只记录本 change 的 owner、最小接口与依赖顺序；行为与验收以 spec.md 为准。

## 责任图

Classic / Mod 声明内容 ID、规则参数、获得路径、媒体资源与 lighting profile；stdlib 提供 interaction、prepared commit、equipment、structure/climb/route/transport、media state/actions/facts 和无平台依赖的标量光照算法；Web runtime 消费 Authority intent/projection/facts，实现 input/HUD/prediction/presentation、Pack media/Web Audio、per-chunk lighting 与 WebGL2。Kernel 预期零改动；若需要向 Kernel 添加 door/item/media/light 名称，停止并重开架构审核。

## 公共协议 spine

公共 spine 由当前 root 统筹的公共集成 owner 唯一实现，worker 只消费。本文后续出现的 `coordinator` 均指当前 root `4decc58b-bca7-4d00-a0ca-392fc5532f10`，不表示另有协调者。

InteractionTarget 只允许 self、voxel 的 hit/adjacent，或 entity lifetime reference。InteractAction 只携带 type=interact、target 和 `expectedSelection: { inventoryRevision, modeRevision, creativeCatalogRevision, selectedSlot }`。客户端不提交 item、operation、binding 或 Classic ID。Authority 先比较全部四项，再按当前权威 mode 从 survival inventory 或 creative catalog 解析选中 item，继而从 composition 和 target 解析 handler；固定顺序 target → selected item → place → self，返回 success、handled、stable reason 和 committed facts。Creative 交互不消耗物品，也不生成 bucket 等余物。voxel footprint 由服务端推导并预备全部 Chunk。station 继续用既有 station action，不把 jukebox 塞进 StationKind。

mod-api 按纵向切片逐步公开定义；每个定义只有出现 Classic 消费者和最小非 Classic test fixture 后才进入公共 spine：

- ItemInteractionDefinition：selector、trigger、operation、presentation key。
- StructureDefinition：parts、state variants、transitions、support/collision/drop owner。
- ClimbSurfaceDefinition：variant、face、contact thickness、vertical limits。
- RouteDefinition：family、variant edges、curve/slope、placement tie-break。
- TransportDefinition：deploy selector、locomotion、body/seat、fuel/inventory/presentation。
- MediaTrackDefinition / MediaDeviceDefinition：track→Pack resource、slot/accepted item/mapping。
- 不新增 StarterLoadoutDefinition；本轮复用由 item registry 投影的正式创造目录取得 record-13。生存掉落若未来需要，由 Classic loot 另立合同。
- LightingPresentation：blockLightTint、self-emission、environment keyframes、tone mapper/exposure。

V1 只公开 ItemInteraction、Structure、MediaTrack/MediaDevice 及其最小 projection/checkpoint；sample:modular-world 只注册 click conversion、两格 panel 和 fake media device。它是测试 fixture，不是第二产品，不进入产品浏览器线路。Equipment、ClimbSurface、Route、Transport、LightingPresentation 分别在后续首个实际消费者阶段才加入；未被 Classic＋fixture 使用的字段不得预建。

## 原子提交与失败

通用候选携带 actor/entity lifetime、expected inventory revision、稳定排序 voxel read/write set、有界 entity mutations、inventory/equipment/media/transport state 和 result facts。流程为 prepare dependencies → await → recompute authoritative candidate → validate all → apply all → publish immutable facts。失败不占 ID、不扣物/耐久/燃料、不推进 sequence/revision。

外部音频 I/O 不进入事务。Web playback 是 committed fact 的异步表现；浏览器失败不会回滚合法 jukebox 插入，也不能伪造 Authority stop。

## 状态 owner 与保存

| 状态                                                          | 唯一 owner                             | 保存/恢复                           |
| ------------------------------------------------------------- | -------------------------------------- | ----------------------------------- |
| inventory/cursor/equipment                                    | ECS actor + registered inventory       | Gameplay V4 entityStore             |
| structure state                                               | Chunk 中追加的 Pack voxel variants     | Chunk bytes；旧 ID 不重解释         |
| crop/fishing/projectile/environment/navigation/final entities | 现有 stdlib per-world runtimes，配置化 | 现有 V4 optional child checkpoints  |
| transport pose/occupancy/fuel/inventory                       | Authority transport entity/component   | vehicle child V2；V1 原子迁移       |
| media slot/track/playing intent/revision                      | MediaPlaybackModule per-world state    | V4 optional media child；缺字段为空 |
| block/sky light fields                                        | Web per-chunk derived cache            | 不保存，按 revision 重建            |
| decoded audio/URL/node                                        | Web world media player                 | 不保存，world/session dispose 释放  |

媒体恢复 playing 只投影 resumePending，手势前不出声。结构/route/media/profile identity 属 Pack lock；缺 definition/digest 时在替换当前世界前拒绝。

## 领域边界

### 普通交互与装备

stdlib 拥有 registry、target validation、inventory/equipment prepared candidate 和通用 operation；Classic item-interactions 声明实际 ID。TNT 仍交 Environment owner，投射物交 Projectile owner，地图交 Navigation owner。Web 装备 UI 通过 inventory pointer target 移动，不直接改 ECS。

### structure / route / transport

追加 voxel variant 是冻结方案，不新增稀疏可写 sidecar。Pack descriptor 同时供 collision、mesh、route、save。mounted player 位置只由 Authority physics/transport 写；Web 清 walking prediction 并跟随 seat。车辆进入正式 entity projection。

### media

Classic 映射 record-13 → seedlands:to-far-shores → assets/audio/to-far-shores.mp3；record-cat 保留 identity。Jukebox 使用 MediaDevice，不是 StationKind。Pack builder 摘要/复制 MP3；Web 独立 media loader 有自己的 byte/content-type/digest policy，不调用或放宽 image/GLB loader。AudioContext/decoder/mixer/node/URL 只在 Web。普通 global volume 控制 media bus。

旧 reference upload 不与唱片并存：records worker 删除 shell-overlays 的文件选择/移除 UI、GlobalAudio 的 importReference/removeReference/import epoch/reference snapshot、MusicPlayer 的 reference buffer/source/import/remove/替换分支，以及只保护它的 reference-audio-lifecycle assertions。保留 MusicPlayer 的内置合成 cue、AudioMixer/music bus、GlobalAudio unlock/beginWorld/endWorld、master/music/sfx/ambience 音量与普通 SFX。coordinator 只负责 application bootstrap/World media player 的窄组合根接线。

### lighting

现有 per-chunk owner 扩为同 revision 的 block R8 + skyVisibility R8。stdlib voxel-light 强制接 emission/lightCost resolver，无 Classic fallback。Web received block/sky 进 lighting/diffuse，self-emission 只给 profile 声明 surface；actor/world-item/viewmodel 同一 applicator。Classic 固定 tone mapper/exposure，quality 不切。多色 RGB flood 另立未来 change。

## 公共文件唯一 owner

以下由总负责人 `4decc58b-bca7-4d00-a0ca-392fc5532f10` 统筹，并由 TAKEOVER-01 公共实施负责人 / 唯一 Git writer `954ef059-b17c-4842-bf46-5ebc1807b38e` 提交；`d08...` 与其他会话没有并行协调权：

- 本 change 三文档、docs/development-governance.md、最终 ASSETS.md provenance；
- packages/stdlib/src/server/protocol、Authority action/preparation/projection/session/physics；
- packages/stdlib/src/server/composition、mod-api/exports/package exports；
- gameplay-runtime、game-server-gameplay-host、gameplay-world-systems、Gameplay V4 公共 snapshot/checkpoint；
- world transaction/prepared multi-edit 公共基础；
- voxel semantics/model/mesh descriptor 与 Worker/Wasm 公共 payload；
- playbooks/classic/src/pack.ts 组合根、Pack schema/build/lock；
- apps/web 的 browser-gameplay、主 input/controller、authority client/prediction、Pack media/presentation composition root；
- 唯一 E2E/Harness、串行 test/build/browser、commit/PR/Cloudflare preview。

worker 如需公共接口，只向当前 root 报告需求，不抢改。
worker checkpoint、风险、锁请求和完成报告统一发送给当前 root `4decc58b-bca7-4d00-a0ca-392fc5532f10`，不得发送给旧会话。TAKEOVER-01 `954...` 当前只改合同、状态和 Git 批次，不进入 A2。A1、A2、A3 涉及公共接口时必须由 root 明确互斥交接。

## 纵向依赖顺序

V1a 先完成 interact intent、ItemInteraction V1 与 water-bucket；V1b 只在其上增加 bounded multi-edit、Structure V1 与两格门；V1c 再增加 Media V1、record-13/jukebox 与旧 upload 退场；V1d 串行生成临时 production artifact，用同一浏览器会话验证三条旅程。V1d 之前不添加 Equipment、Climb、Route、Transport 或 Lighting 公共 schema；失败时只修复已引入的最小接口，不扩框架掩盖失败。

V2 普通交互/装备、V3 其余 structure/climb/route/transport、V4 lighting 都只扩展已验证接缝，并各以有界 browser smoke 收尾。V5 再做完整矩阵和唯一 release artifact，随后 PR 与 Cloudflare preview。V1 临时 artifact 只用于早期产品反馈，不作为最终部署身份。

## 被否决候选

- Authority/stdlib 大 switch 继续加 Classic ID：非 Classic 反例失败。
- 给旧 StructureInteractionRuntime/VehicleRuntime 补分支：保留非原子、多 owner、不可投影问题。
- Jukebox 塞入 StationKind：扩大工位协议且无替代配置证明。
- 保留设置上传参考曲并与唱片隔离：用户要求不支持自定义，两套能力共存会留下需求偏差；旧入口与专属实现应退场。
- 放宽 presentation 1 MiB loader：混合图像/模型与媒体生命周期。
- 全量 RGB flood/WebGPU：无当前硬需求且成本超出最小闭环。
- 可写 lighting save 或 structure sidecar：产生第二 truth；光应重建、结构状态进 variants。
- 为赠送唱片新建 loadout/save：获得方式不是用户指定，已有创造目录可完成稳定旅程。

## 重开条件

若需要 Kernel 玩法概念、无法追加 voxel variants、prepared commit 无法保证跨 Chunk＋inventory 原子性、Media state 必须依赖 DOM、Pack lock 无法携带 MP3、R8+tint 无法满足视觉验收、或现有 Cloudflare migration 无可合法复用 preview path，停止相应实现并向当前 root 申请架构重开，不在 worker 内暗改架构。
