# 协调、文件所有权与阶段任务

## 通讯录与运行约束

全部任务留在 wks_21d57633a4799ce3，parentAgentId=null；唯一总负责人为 Paseo `4decc58b-bca7-4d00-a0ca-392fc5532f10`。不得建立第二协调链，不得创建/取消/停止其他 agent，不创建 Goal。每次 IMPLEMENT 活跃阶段 ≤6h，先 RED，checkpoint/报告后退出；由 Paseo 消息触发下一阶段，不长轮询。测试、类型检查、构建等重负载命令统一经 `node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- <command...>` 取得默认全机锁，Vitest 固定 `--maxWorkers=1`，已持锁命令不得二次嵌套。
本文后续表格中的 `coordinator` 均为角色简称，唯一指当前 root，不代表第二协调会话。

| 职责                     | Paseo agentId                        | 当前状态                                     |
| ------------------------ | ------------------------------------ | -------------------------------------------- |
| root / 唯一总负责人      | 4decc58b-bca7-4d00-a0ca-392fc5532f10 | 派工、建模、准出；接收全部里程碑与阻塞       |
| TAKEOVER-01 / Git writer | 954ef059-b17c-4842-bf46-5ebc1807b38e | 合同、状态、公共实施和唯一 Git 写入          |
| interactions / equipment | 761fb4f2-9bc7-48bb-8520-0cf639839357 | A1-CLOSE，独占 A1 生产/测试修改              |
| structures / transport   | 7943067e-ff8e-4faf-b717-f14bded59d1c | A3.1 geometry registry + Classic descriptors |
| records / media          | a288bb43-cad6-49bb-8a32-03b7d9d7cd94 | Media 私有 checkpoint 已报告                 |
| lighting                 | 88d41b38-2a70-4653-9cf1-7f35edf7e5e2 | Lighting 模型/接线图已报告                   |

普通实施委派配置固定 provider=traex model=gpt-5.6-sol/max/xhigh thinking=xhigh；不得改 root/worker 模型。Paseo snapshot 的完整 model ID 是配置证据；TraeX runtimeInfo 归一化回显 gpt-5.6-sol、thinking=xhigh，未独立回显 max。

## 保护清单

其他任务既有 dirty 不得清理、覆盖、暂存或提交：.github/workflows/ci.yml、README.md、README.zh-CN.md、apps/web/index.html、package.json、changes/2026-09-22-hotpath-allocation-baseline/、changes/2026-09-23-cloudflare-pages-migration/、reports/2026-09-23-classic-stage3/browser/appearance-before-draft-save.json、reports/2026-09-23-classic-stage3/browser/wool-save-reopen.webm。不得读取 .env/secret。

## A0：Architecture Approved

架构、owner/API/失败/保存/第二配置/矩阵/预算/preview 已形成并获用户批准。历史 hash 仅为历史快照；用户本轮已批准现有目标和执行安排，不能虚构其曾审核某个 SHA，也不重复请求 hash/IMPLEMENT。

当前分类仍为 Breaking。实施、提交、推送、最终 CI/review 修复和 Cloudflare PR preview 已获授权；不自动合并、不部署 production、不改权限凭据。开发过程中由唯一 Git writer 及时做语义 commit+push，中途不跟 CI，最后集中处理到可合入。

## V1：最小纵向切片先行

V1 只引入 water-bucket、两格可开关门、唱片三旅程所需公共接口；每个 checkpoint 最长 6h，超时即保存 RED/GREEN/文件/剩余风险并退出。V1 浏览器未通过前，不建设 equipment/climb/route/transport/lighting 公共 schema。

| checkpoint / owner                              | 最长 | done_when                                                                                                                                                                                     |
| ----------------------------------------------- | ---: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V1.1 interact spine RED / coordinator           |   6h | ItemInteraction＋InteractAction 最小 schema、network copy/validator/authorization 与 modular click-conversion 负例编译；water-bucket 正式 action 测试稳定 RED；未实现其它 item family         |
| V1.2 water-bucket GREEN / interactions          |   6h | 已完成：Classic binding、Water/Lava 对称、expectedSelection、creative 零消耗及失败原子性有定向证据                                                                                            |
| V1.3 bounded structure spine RED / public owner |   6h | 已完成：StructureDefinition、legacy target discovery、跨 Chunk/target-first 门 RED；生产门 GREEN 尚未完成                                                                                     |
| V1.4 two-part door GREEN / structures           |   6h | 两格放置、任一半 toggle、碰撞/mesh state、联动破坏和 legacy pair fail-closed 定向测试 GREEN；无 bed/trapdoor 扩面                                                                             |
| V1.5 media spine RED / coordinator              |   6h | MediaTrack/MediaDevice 最小 schema、V4 optional child、projection/fact 和 Pack locked media resource 的正反例稳定 RED；未加入通用 station 扩展或上传兼容层                                    |
| V1.6 media state + Classic / records            |   6h | 无 DOM 的 MediaPlayback state/actions/facts、Classic record-13/jukebox mapping、slot/inventory 原子性和 V4 缺字段恢复定向 GREEN；Pack MP3 复制仍由 coordinator                                |
| V1.7 Web media + upload retirement / records    |   6h | 独立 locked media loader/world player 单测 GREEN；设置文件上传/移除 UI、GlobalAudio import/remove/reference state、MusicPlayer reference 分支和专属旧测试退场；内置 cue/四音量/SFX 回归 GREEN |
| V1.8 public integration / coordinator           |   6h | 三域 exports/pack.ts/snapshot/projection/browser-gameplay 窄接线；复制 MP3 并核 bytes/hash/provenance；format/typecheck/三域定向测试串行 GREEN                                                |
| V1.9 early browser / coordinator                |   6h | 已完成：Browser-12 单一 production artifact/单一 Chromium attempt 完成 water-bucket、门、record/jukebox、save/reopen、C0-C5 与 Classic visual；Cua/人类听觉和非 Classic smoke 未准出          |

### V1-HARNESS-INTEGRATION-01

Owner：`954ef059-b17c-4842-bf46-5ebc1807b38e`，阶段上限 2h。先冻结 `v1-harness-contract.md`，再消费 794 的 postrender mesh 摘要和 a288 的 Media controller 快照，向现有 BrowserProductHarness 接入 `getVoxelGeometry`、`getRenderedMaterialMesh`、`mediaSnapshot`。761 独占唯一 canonical scenario 整体 y 减 29 及 bucket/door/record/restore 旅程；本阶段不写其文件、不运行 browser/build/CI。done_when 为共享组合测试、相关私有 seam 测试、Web types、targeted lint/format/diff GREEN，并准确记录真实浏览器仍待 root 单例租约。

## V2–V4：完整领域 IMPLEMENT

最终精确文件范围以 Paseo IMPLEMENT 消息为准；每条消息写明“你不是唯一编辑者，不回退他人改动”。
V1.9 早期 canonical browser 门禁已通过；进入 V2 仍须 root 冻结 V2.0 的 equipment pointer target/projection 与 death prepared participant 公共合同。794 当前只读梳理，不是第二协调者，不得在该合同冻结前写 production。

领域开始前只由 coordinator 添加该域首个消费者所需的公共 spine，并在 ≤6h 内结束：V2.0 的 done_when 是 equipment pointer target/projection 与 death prepared participant 的 RED 编译且不含 Classic ID；V3.0a 的 done_when 是 ClimbSurface schema＋Authority movement 接口 RED，V3.0b 是 Route/Transport schema＋entity projection/checkpoint V2 RED；V4.0 的 done_when 是 LightingPresentation schema、Pack loader 和 block+sky cache 数据合同 RED。每个公共 checkpoint 未完成时，对应 worker 不启动；不把四个阶段合成一次大改。

### interactions — 761fb4f2-9bc7-48bb-8520-0cf639839357

互斥私有范围：Classic item-interactions 声明分片；stdlib interaction 私有实现；armor/equipment inventory pointer 私有实现和独立 UI；life-skills/species/crop/final-entities/navigation/ranged/fluid 参数化；相应 tests。不得改 public spine、Classic pack.ts、records/transport 行、唯一 E2E。

| checkpoint                   | 最长 | done_when                                                                                                         |
| ---------------------------- | ---: | ----------------------------------------------------------------------------------------------------------------- |
| I2.1 equipment transaction   |   6h | 四槽穿/脱/交换、错槽/满包/实例耐久、V4 restore 定向 GREEN                                                         |
| I2.2 equipment UI/death      |   6h | pointer target/HUD 接入，Classic death policy 一次清 inventory/cursor/equipment 并产生掉落；定向 UI/runtime GREEN |
| I2.3 ranged/fluid remainder  |   6h | bow/snowball/egg 与剩余 bucket/milk-bucket/stew 容器原子正反例 GREEN                                              |
| I2.4 agriculture             |   6h | 五锄、种子、成熟/提前收割、骨粉、unknown/满包/save GREEN                                                          |
| I2.5 species/life/painting   |   6h | 剪/挤奶/染羊/驯狼/钓鱼/画走 lifetime+LOS dispatcher，失败零提交并恢复 GREEN                                       |
| I2.6 navigation/state blocks |   6h | map/compass/clock 投影与 sign/cake/note/TNT 状态、输入、save 定向 GREEN                                           |
| I2.7 item browser smoke      |   6h | 从真实 UI 至少逐族完成一正一负旅程；194 项矩阵自动断言 unique=194、missing/extra=[]，失败不进入最终集成           |

### structures — 7943067e-ff8e-4faf-b717-f14bded59d1c

互斥私有范围：structure/climb/route/transport definition/runtime；Classic structures.ts/transport.ts；独立 transport presenter/interaction component；相应 tests。不得改公共 action/projection/physics、voxel/model/mesh descriptor 或组合根。

| checkpoint                   | 最长 | done_when                                                                                         |
| ---------------------------- | ---: | ------------------------------------------------------------------------------------------------- |
| S3.1 remaining structures    |   6h | bed/trapdoor definitions、放置/transition/break/save 与 non-Classic panel GREEN                   |
| S3.2 climb                   |   6h | 接触＋垂直输入上下、离开恢复重力、unknown fail closed、固定步长容差 GREEN                         |
| S3.3 route                   |   6h | NS/EW、四角、四坡、双向、tie-break、断轨/unknown、overshoot 无 NaN GREEN                          |
| S3.4 transport entity/save   |   6h | deploy 原子、Authority entity/lifetime、唯一 rider、V1→V2 restore 畸形全拒绝 GREEN                |
| S3.5 transport motion        |   6h | mounted position 单 owner、route/boat control、collision/frontier/fuel/safe exit GREEN            |
| S3.6 transport Web           |   6h | presenter、input/prediction reset/seat camera 的 unit/integration GREEN；不改共享 presenter       |
| S3.7 transport browser smoke |   6h | 真实 ladder、corner/slope minecart、boat、mount/control/dismount/save-reopen 可观察；失败回域修复 |

### records — a288bb43-cad6-49bb-8a32-03b7d9d7cd94

互斥私有范围：Classic media.ts/jukebox.ts 和 media definitions；stdlib media-playback 私有 module/state/actions/facts/tests；Web pack-media-loader.ts/world-media-player.ts/tests；apps/web/src/app/ui/shell-overlays.svelte、apps/web/src/app/audio/global-audio.ts、apps/web/src/app/audio/music-player.ts、apps/web/tests/unit/app/reference-audio-lifecycle.test.ts 的旧 reference upload 退场。资源复制与 ASSETS provenance 由 coordinator 唯一完成。不得改 Pack schema/lock/pack.ts、application bootstrap/World media composition root、E2E 或部署。V1.6/V1.7 完成后本域只响应有界修复，不另造长期阶段。

### lighting — 88d41b38-2a70-4653-9cf1-7f35edf7e5e2

互斥私有范围：stdlib voxel-light 与 tests（参数化、无 Classic fallback）；Web block/sky cache、lighting shader/material helper、environment/tone mapping、entity/viewmodel applicator 私有实现与 tests。采用 R8+tint，不做 RGB flood；不改 Classic profile、Pack loader/schema 或 shared descriptor。

| checkpoint                  | 最长 | done_when                                                                                            |
| --------------------------- | ---: | ---------------------------------------------------------------------------------------------------- |
| L4.1 semantics/profile RED  |   6h | synthetic semantics 无 Classic import；LightingPresentation 最小消费者/fixture schema 正反例稳定 RED |
| L4.2 block+sky cache        |   6h | 同 revision block R8＋sky R8、edit invalidation、unknown fail-dark、unload release GREEN             |
| L4.3 terrain/water shader   |   6h | received/self-emission 分通道；compile＋pixel readback 证明邻面受光而非自发光 GREEN                  |
| L4.4 entity/item/viewmodel  |   6h | actor/world item/viewmodel 共用 applicator，灯移除无 stale emission；unit/WebGL2 GREEN               |
| L4.5 environment/quality    |   6h | sky visibility 约束 ambient/direct，Classic tone/exposure 跨 low/medium/high 一致；定向 GREEN        |
| L4.6 lighting browser smoke |   6h | 固定 seed 的昼夜/林下/室内/开口实墙/跨 Chunk/灯开关与 save-ready 真实可观察；单图不计通过            |

## 冲突裁决

- structure-interaction-runtime 同时涉及 TNT/structures：structures 只做结构私有重构；TNT 由 interactions 写新 operation/Environment adapter；旧 facade 由 coordinator 处理。
- gameplay-entity-presenter 同时涉及 transport/lighting：lighting 拥有 lighting applicator；structures 新建 transport presenter；coordinator 接线。
- items.ts/portable-items.ts 被三域涉及：worker 各写新声明分片，coordinator 在 items.ts/pack.ts 汇总。
- voxel-light 与 Pack semantics：lighting 改通用算法；Classic blocks/profile 由 coordinator 接线。
- protocol/exports/snapshot/pack schema/composition root/CI/E2E/deploy 只有 coordinator 写。
- A1、A2、A3 涉及公共接口时必须由 root 显式互斥交接；未收到交接不得并发修改。当前 TAKEOVER-01 只写 change 文档和 Git 批次，不进入 A2。worker 回报统一发送给 root `4decc58b-bca7-4d00-a0ca-392fc5532f10`。
- A3.1 由 794 独占：仅 `voxel-geometry` 新文件/tests、Classic `structure-descriptors`，以及必要的 composition contracts/content-registration/content-capabilities/mod-api；不得触碰 GameServer、Authority、Web、Worker 或 `pack.ts`。地面放门必须支持；垂直点击面不能被简单一概拒绝，朝向由 Authority 拥有并校验。

## V5–V6 串行验收与交付

### RESTORE-OWNER-CLOSE-01

Owner：954ef059-b17c-4842-bf46-5ebc1807b38e；阶段上限 2h。

- RED：真实半程 mining 保存/restore 后继续完成时，旧 game-server-world-commit-adapter 调用已 dispose 的构造期 Kernel owner。
- 实现：world commit adapter 使用当前 owner 的窄 getter；不改 Kernel、不降低 dispose/epoch 校验、不用全局 owner。
- 回归：成功 restore 后新 edit/batch/fluid 使用新 owner；restore 前 prepared edit/batch 在成功 restore 后 stale；失败 restore 保留旧 owner并允许原 prepared 操作继续。
- 验收：半程 mining 完成且只完成一次；必要 A1、Media、Structure restore tests、stdlib/root-test types、targeted ESLint/Prettier/diff PASS。未授权 browser/build/CI/Git。

所有命令串行，不并发 test/build/dev server；单 checkpoint 超过 6h 时在当前可恢复边界记录执行/未执行项后退出，不把部分结果写 PASS。

| checkpoint / owner                                       | 最长 | done_when                                                                                                                                                                                                        |
| -------------------------------------------------------- | ---: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V5.1 source/static / coordinator                         |   6h | 合并所有 domain checkpoint；format/path/lint/typecheck 串行结束并逐项记录 PASS/FAIL；失败只回对应修复，不启动 build/browser                                                                                      |
| V5.2 deterministic/save / coordinator                    |   6h | 受影响 owner tests、deterministic、Classic Headless、V1–V4 save migration、194-ID closure 与 modular fixtures 串行结束；无 selected/todo/pending 冒充 PASS                                                       |
| V5.3 pack/release artifact / coordinator                 |   6h | Pack build、MP3 source/pack/dist bytes+digest、ASSETS provenance 通过；只构建一次 release apps/web/dist 并写出 artifact identity                                                                                 |
| V5.4 full browser functional / coordinator               |   6h | 唯一 Chromium/Cua 对完整物品、门梯轨车、save/reopen 旅程取证；若场景超时则按固定场景边界拆 V5.4a/V5.4b 后退出，不省略旅程                                                                                        |
| V5.5 full browser visual/audio / coordinator             |   6h | 同一 release artifact 完成 lighting matrix、record 播放/停止/恢复/失败、上传入口不存在和 console/network 检查；不以 HTTP200/截图替代                                                                             |
| V5.6 cross-review/fixes / coordinator + existing workers |   6h | 未实现该域的现有 Sol/xhigh worker 分域复核；结论与 P0/P1/P2 记录；需要修复则创建新的编号 ≤6h checkpoint，不在本段无限返工                                                                                        |
| V6.1 scoped commit / coordinator                         |   6h | 仅本 change、治理与 provenance 被暂存；保护清单零 staged；语义 commit 后读回 local SHA，夹带风险则停止                                                                                                           |
| V6.2 push/PR / coordinator                               |   6h | push、创建或更新 PR 并读回 remote SHA、source/target、URL 与 gate 快照；不合并、不常驻等 CI                                                                                                                      |
| V6.3 preview/live readback / coordinator                 |   6h | live check 既有 migration 后，把同一 release dist 部署 pr-<PR号>；读回 terminal success、deploymentId、唯一 URL、稳定 alias、commit/source/artifact 及 HTML/Worker/Wasm/Pack/MP3 bytes；权限不足标 INFRA_BLOCKED |

不部署 production main，不自动合并，不持续监控 CI。领域 worker 不提交、PR 或部署。

## 里程碑消息

- takeover_ready：当前 root、执行状态、Git 批次、远端 SHA 和后续依赖；历史 architecture_ready 只作归档快照。
- implement_checkpoint：阶段、文件、RED/GREEN、usage/墙钟、剩余/风险；worker 随后退出。
- integration_ready：公共/领域接线完成及未跑门禁。
- evidence_ready：静态、定向、browser/audio、save、non-Classic、artifact identity 分层结果。
- delivery_ready：commit/remote SHA、PR URL/gates、Cloudflare deploymentId/URLs/identity 或精确阻塞。
