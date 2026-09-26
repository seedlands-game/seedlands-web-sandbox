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

### V2-EQUIPMENT-SPINE-01

Owner：`954ef059-b17c-4842-bf46-5ebc1807b38e`，阶段上限 6h。公共范围仅为 inventory pointer
equipment target/origin、四槽 actor/Authority/network projection、纯 death inventory settlement
candidate/participant、必要 exports 与对应合同/RED。done_when：公共 copy/validate/projection 与 death
candidate tests GREEN；非 Classic registered equipment action 和现有 death producer armor settlement 在行为
期稳定 RED；stdlib/root/Classic test types、目标 lint/format/diff 通过。阶段不提交含预期 RED 的变更，
不运行 build/browser/Cua/CI；I2.1/I2.1b/I2.1c/I2.2 由 root 后续独立派发。

状态：CHECKPOINT_READY。green-final4 如实保留 27 passed / 1 failed，final5 对唯一受影响合同 suite 复验
9/9；当前有效公共闭包为未受修改的 4 files / 19 tests + final5 的 1 file / 9 tests。equipment、armor-only
revision 与 combat death settlement 保持 1 file / 3 tests 的可执行行为 RED。源码与证据未提交，等待 root
独立审阅；详细窗口、后续私有写域和未验证边界见 equipment-spine-evidence.md。

### V2-EQUIPMENT-REVISION-01

Owner：`954ef059-b17c-4842-bf46-5ebc1807b38e`，阶段上限 3h，与 761 的 I2.1a pointer 私有实现写路径互斥。仅修改
prepared-entity-mutation.ts 与独立 revision 测试，按 equipment-revision-contract.md 闭合
armor-only/shared revision。done_when：既有 RED 第二项转 GREEN；独立 armor-only、组合、durability、兼容空槽、
no-op、selectedSlot、stale 与 overflow 测试通过；必要 types/lint/format/diff 通过。本片不提交或推送，等待
root 与 I2.1a 组合准出。

状态：CHECKPOINT_READY。独立 revision 矩阵 1 file / 12 tests、共享原 RED 第二项 1 passed / 2 skipped、
既有 prepared mutation 回归 2 files / 14 tests 均 GREEN。最新 root test types 被 761 并发 pointer 文件的
TS2367（最新位于 inventory-pointer-model.ts:190）阻断，本片未越权修改；其余结果、窗口与未运行项见
equipment-revision-evidence.md。

### V2-EQUIPMENT-STATION-HOST-01

Owner：`954ef059-b17c-4842-bf46-5ebc1807b38e`，阶段上限 4h。只修改 registered-station-runtime.ts 的
equipment 提交 hunk、独立 station host 测试和 change 内文档/证据。真实 RED 已证明候选与操作成功后
host 丢失 equipment；最小修复后非 Classic 四槽代表路径、revision/station revision、物品守恒、单次 fact、
真实 cancellation 与 authorization/stale/capacity 原子反例 GREEN。761 的 pointer model/slot-state 写域保持互斥。

### GIT-21-EQUIPMENT-CORE + V2-ARTIFACT-BUILD-01

Owner：`954ef059-b17c-4842-bf46-5ebc1807b38e`，唯一 Git writer，阶段上限 6h。先从
`7030adac5ea234319bfe032185828287ee07b85d` 建立精确白名单隔离树，将 spine、pointer、revision 与 station
host 的最终身份按覆盖顺序组合；`mod-api.ts` 只取 equipment exports。done_when：公共合同、pointer
4 files / 35 tests、station 11、revision 12 与相关回归 GREEN；共享 RED 实跑 `2 passed / 1 failed` 且唯一
death 缺口保留；三类 test types、staged TS lint、可编辑 format、scoped diff 和自然 hooks 通过。随后分两笔
语义提交、push、更新 PR #41，并仅从已推送 SHA 建 clean detached tree，分别一次执行 build 与
`harness:artifact`。本阶段不运行 Browser、Cua、CI，不接 death/UI/combat/V4。

状态：BUILD_GREEN。隔离树实际通过 spine `9/9`、pointer `35/35`、revision `12/12`、station host
`11/11`、相关回归 `18/18` 与三类 test types/静态门禁；共享行为精确为 `2 passed / 1 failed`，唯一 death
RED 保留。代码/测试/合同提交 `fe2fcc9f174848ef9d7419cb5df96209a2d25796` 与 evidence/state 提交
`50a1e6ec72583ad4f5feef057a692709da577b19` 已推送并更新 PR #41。V2 BUILD01 的唯一 build 与 artifact
复验均 PASS；BUILD01 evidence/state 已归档，本批以独立语义提交交付，远端身份在最终 checkpoint 读回。

### V2-EQUIPMENT-RESTORE-REGRESSION-01

Owner：`954ef059-b17c-4842-bf46-5ebc1807b38e`，阶段上限 3h。只新增非 Classic restore 回归与
change 内合同/证据，不修改 production 或 `spec.md`，不进入 761 的 registered combat armor 写域。done_when：
已提交 core 的正式 pointer 状态经 V4 保存/恢复保持 bag、cursor/crafting、armor/durability/revision；成功
restore 使旧 reference/access 失效，新 reference 可继续穿脱交换；缺 armor 兼容四空槽；wrong-slot/非法
durability 原子拒绝。

状态：CHECKPOINT_READY。最终新增 suite `1 file / 4 tests` PASS，stdlib/root test/Classic test types 与单文件
lint/format/diff PASS；现有 Web pointer 9 项在 clean `50a1e6ec` tree 上仍 `9/9 FAIL`，全部阻断于 Classic
Pack integrity fixture setup，未进入 pointer/restore 行为。本片未越域修复。761 I2.1c registered combat armor
仍在进行。

### V2-WEB-POINTER-FIXTURE-CLOSE-01 + GIT-22

Owner：`954ef059-b17c-4842-bf46-5ebc1807b38e`。已授权 resources 单 hunk 使测试 receipt 跟随当前 Pack
manifest，首个 integrity mismatch blocker 已关闭。随后的唯一 Web9 GREEN 尝试仍 `9/9 FAIL`，共同首因转为
完整 Classic Media capability 缺少测试宿主 `getLoadedCell`，未进入 pointer 行为。该 seam 不在当前授权写范围；
root 后续授权同源 `readCell/getLoadedCell` 后，Media blocker关闭，但下一次 Web9仍 `9/9 FAIL`于 Structure
capability缺少 `prepareVoxelEdits`。root授权 strict fail-closed batch seam后，原 suite真实 `9/9 PASS`，且未触发
voxel edit异常；root/Classic test types与fixture lint/format/diff PASS。测试/合同提交为
`e6a25d5739608038657c093faa1eb99fcd4e7bea`；阶段状态 GREEN，GIT-22 evidence/state提交待完成。

GIT-22 第二批只提交 restore/Web fixture evidence、两份 evidence 文档与本文件/执行状态；历史 restore
manifest不改写，当前状态为本地 delivery ready，待自然 hooks 后 push/readback。

### GIT-23-REGISTERED-COMBAT-ARMOR

Owner：`954ef059-b17c-4842-bf46-5ebc1807b38e`，唯一 Git writer，阶段上限 4h。集成 root 已准出的
registered combat armor transaction：ruleset产出正伤害后，以通用 armor capability计算减伤/耐久，health与
armor在同一 prepared entity mutation提交。只提交冻结的两个生产文件、一个测试、spec/合同及对应 evidence/state；
`armor-equipment.ts`仅复用。shared death第三项必须保持 `1 failed / 2 skipped`，不得提前进入I2.2。

状态：REMOTE_DELIVERED。GIT-22已提交推送并准出；GIT-23隔离树中的combat `8/8`、既有combat/damage
`22/22`、frontier/effects `14/14`、Classic armor `6/6`与equipment组合 `43/43`均PASS，三类types和静态PASS；
shared death保持 `1 failed / 2 skipped`。代码/测试/spec/合同提交为`067c87607de7d85dace165f81947f84290ed0231`，
evidence/state提交为`a39f7ba6d18b602305372093c43757be83a6125e`；local/upstream/origin/PR head 已读回一致。

### V2-DEATH-POLICY-SPINE-01

Owner：`954ef059-b17c-4842-bf46-5ebc1807b38e`，阶段上限 5h。公共范围仅为无状态 death inventory
policy capability/resolver、原始 source frontier 与统一 prepared mutation series participant；不安装 Classic、
不接 Needs/Combat/Vitals/Autonomy producer、不修改 Web/spec/存档 schema。

状态：REMOTE_DELIVERED。root 已定向准出公共 checkpoint；真实 RED 证明旧单 participant 会接受 build 后 health-only stale；最终 non-Classic
capability/source/series 与既有 equipment spine 为 `3 files / 25 tests` PASS，stdlib/root test types、定向
ESLint/Prettier PASS。GIT-24 隔离树复验还包括 Classic test types 与 staged diff，代码/测试/合同提交
`364c6517848a0c1d03aed28b051a106820264b2f`、evidence/state 提交
`1f0dda0023fb68185ff2ad2a57a9e4aa01ec15ca`，local/upstream/origin/PR head 已读回一致。Classic policy、
`death-inventory-policy-unavailable`、NPC intrinsic/despawn 与实际 producer 仍未接线，不宣称 death 或完整 V2 GREEN。

### GIT-25-EQUIPMENT-WEB-UI + V2-ARTIFACT-BUILD-02

Owner：`954ef059-b17c-4842-bf46-5ebc1807b38e`，唯一 Git writer，阶段上限 6h。集成 root 已准出的
Web equipment presentation 与 pointer queue：只提交 CLOSE-02 SOURCE 的 18 项、两份 UI evidence 目录和
本批 metadata/state；不接 death producer，不运行 Browser/Cua/CI/deploy。

状态：REMOTE_DELIVERED。精确 staged tree 的 UI/queue `33/33`、creative-mode/UI bridge `10/10`、
Web/Svelte、root test、Classic test types、staged ESLint、format、scoped diff 均 PASS。代码/测试/spec/合同提交为
`ff17b4cc14d6650fe2156e559883c824464f5b5d`，evidence/state 提交为
`1bbe3a60d55ffa5d05e405377624fbbd942e6327`，已推送且 PR 已更新。BUILD02 从该 source SHA 的 clean tree
唯一 build 与 artifact verify 均 PASS；BUILD02 evidence/state 提交 `9f5a6ff49cccb1e5ecb9fae9ae0ab9277f42769e`
已推送，并由 root 核验 local/ls-remote/PR 一致。真实浏览器装备旅程与 death producer仍未准出。

### V2-DEATH-MIXED-SERIES-01 + PREDECESSOR-CAPTURE

Owner：`954ef059-b17c-4842-bf46-5ebc1807b38e`，阶段上限 6h。公共 death series 新增显式
`additionalActorReplacements: [{ source, replacement }]`，只用于至少含一个 death candidate 的混合批次；
survivor 与 death/drop 共用一次 `prepareEntityMutationSeries`、既有 128 entries/segment 与 192 segments 总预算。
从保留 clean BUILD02 artifact 实际 load+assemble 捕获 pre-death V4 exact identity；不安装 Classic、不接 producer、
不修改 spec/registered Combat/Vitals/Needs/runtime wiring。

状态：INTEGRATED_GIT26。行为 RED 为 `1 failed / 12 passed`，证明旧 API 忽略 survivor replacement；最终公共
death 合同 `4 files / 38 tests` PASS，stdlib/root/Classic test types 与精确 ESLint PASS。predecessor capture
canonical SHA-256 为 `e799b930b686da9a8bd34d9052e4179e8624013bcbc774da81ff672ed6cd724a`，完整 identity、
artifact provenance 与前后 clean 状态已保存在 `evidence/v2-death-mixed-series-01/`。最终 format/scoped diff 已
PASS，SOURCE/MANIFEST/delivery 已由 root 独立准出并进入 GIT-26。

### GIT-26-DEATH-PRODUCERS-AND-MIXED

Owner：`954ef059-b17c-4842-bf46-5ebc1807b38e`，唯一 Git writer，阶段上限 6h。集成 root 已准出的
registered Combat death、direct player Vitals death 与公共 mixed series；使用 Direct Vitals 的最新 spec 字节和
mixed 的最终 settlement 字节。Classic policy、registered Needs 与迁移不在本批。

状态：REMOTE_DELIVERED。代码/tests/contracts/spec 提交为
`746282901e0c76b6fbe15a71b98b13a861f6dc40`，tree `31c7ad381d2d4df3c8da10914ddd2bb4a03517db`。
隔离 tree 中公共 `38/38`、registered death `11/11`、direct Vitals `11/11`、既有 registered combat `19/19`、
armor+food `12/12`、prepared combat `13/13`、player Vitals `4 passed / 1 skipped` 与三类 types/ESLint/Prettier
均 PASS。legacy equipment `1 failed / 2 passed` 与 Classic armor `1 failed / 5 passed` 是已冻结预期 RED；完整
legacy Vitals 文件另有 `grazer` fixture 预 producer 失败，player Vitals 定向已通过。证据/state 随第二笔语义提交
`5fcdc1dffe3b4a7fbcf5e43c91ae45189ed10708` 交付；root 已读回 local/ls-remote/PR 一致并核验 SOURCE/MANIFEST。

### V2-CLASSIC-DEATH-POLICY-INSTALL-01

Owner：`954ef059-b17c-4842-bf46-5ebc1807b38e`，阶段上限 6h。只安装 Classic death policy、固定 BUILD02
pre-death V4 exact predecessor、同步 pre-Media 精确投影并验证 Classic direct/registered producer；不改 Needs、公共
producer/runtime、spec，不运行 Git/build/browser/Cua/CI。

状态：CHECKPOINT_READY。有效 RED 为 Classic capability/predecessor `2 failed / 2 passed` 与 direct Vitals
`death-inventory-policy-unavailable`（`1 failed / 5 passed`）。最终 lineage `4/4`、Web Classic death/checkpoint
`18/18`、精确掉落 `9/9`、四类 types、ESLint、Prettier、scoped diff 均 PASS。完整 pre-death identity canonical
SHA-256 `e799b930b686da9a8bd34d9052e4179e8624013bcbc774da81ff672ed6cd724a`，原 capture SHA-256
`ebad22c315758e0b9e305aaff6ba7c0c4adc7026ac506fb6dfe4b82abd1db405` 保持不变。registered Needs 生产片已由
root 按 SOURCE `5df2e073c0dffc57d9d2d303efde6d9b6d8b85b545dab0089ec7fd762e9ca83d` / MANIFEST
`dc733d734807777782e38c4727987f0b1cdad7df68b935b785b8e085858f5faf` 独立准出；显式 Classic fixture closure
也已按 SOURCE `37359d1a71d516362e9a73b2a920ffd15c98724b2d5b8a18c7702c778547b111` / MANIFEST
`5f73de5fc2b71662a32687ef4d38756d02695f78978653e3eb94aef8ff61fc38` 准出，当前只待组合 Git。当前
artifact、Browser/Cua/CI 仍未验证，本片等待 root 独立准出。

### GIT-27-CLASSIC-DEATH-AND-NEEDS

Owner：`954ef059-b17c-4842-bf46-5ebc1807b38e`，唯一 Git writer，阶段上限 6h。组合 root 已准出的 registered
Needs、显式 Classic Needs fixture closure 与 Classic death policy/predecessor 三片；不包含 transport/Lighting/README/
package/CI 或 `mod-api.ts` 的并行改动。

状态：REMOTE_DELIVERED。代码/tests/contracts/spec 提交为
`c3ba7ea9fa83522ee1927791efa2add719980797`，tree `6ed1dc8505f8a40fa17b2dba299d8bd1061db30d`。detached
staged tree `/private/tmp/seedlands-git27-death` 内部 workspace 包解析到该树源码，第三方依赖只复用现有安装；Needs
`12/12`、public mixed `13/13`、existing registered Needs `10/10`、Classic lineage `4/4`、Classic death/checkpoint
`18/18`、registered Combat death `11/11`、direct Vitals `11/11`，合计 `79/79` PASS。四类 types、staged TS
ESLint、17 文件 Prettier 与 scoped diff PASS。证据/state 提交为
`b2b07417ec01870c4ce20befdf29f433f26fc88d`；local/upstream/origin/ls-remote 已读回一致且 ahead/behind
`0/0`，PR 41 保持 Draft/Open/base main。BUILD03 已从该已推送 SHA 唯一 build 与唯一 artifact verify PASS，
artifact evidence 待独立提交。

### V2-ARTIFACT-BUILD-03

状态：PASS。clean detached tree `/private/tmp/seedlands-v2-acceptance-b2b07417` 的唯一
`pnpm build` 与唯一 `pnpm harness:artifact` 均 PASS；sourceDigest `4e0e1af0...1445`、lockDigest
`44db46fb...1169`、artifactDigest `fee7cf82...3a60`、276 项 file map 与磁盘一致。生成 Pack 已包含唯一 Classic
death policy capability。当前 artifact 仍未运行 Browser/Cua/CI，真实死亡 UI/save 与完整 V2 不据此准出。

### V2-EQUIPMENT-HARNESS-ORACLE-01

Owner：`954ef059-b17c-4842-bf46-5ebc1807b38e`，阶段上限 4h。只扩展 BrowserProductHarness 的只读
equipment oracle，不改协议、权威 owner、持久化、动作或 761 的 scenario/e2e/spec。

状态：GIT28_COMBINED_STATIC_GREEN。`equipmentSnapshot()` 从同一 ready authority client/epoch/gameplay
对象复制 actor、bag、四槽 armor、cursor、player health/lifecycle 与 nullable armorPoints；完成复制后再次校验三重
身份，换代则 fail closed 为 null。最终 observability `8/8`、Web/Svelte types、root test types、目标 ESLint、Prettier、
scoped diff 均 PASS。原 Classic test types 并行阻塞已由 `V2-CANONICAL-EQUIPMENT-FIXTURE-CLOSE-02` 关闭，并在
GIT28 detached staged tree 与 fixture 组合复验 PASS；Browser/Cua/CI 尚未运行。

### V2-CANONICAL-EQUIPMENT-FIXTURE-CLOSE-02 / GIT-28-EQUIPMENT-JOURNEY

状态：REMOTE_DELIVERED。fixture 的 survival walk -> creative UI placement -> survival fresh physics/grounded、
equipment-origin close 同 runtime/actor 与 revision+1、C5 实际保存前 equipment baseline 已由独立阶段定向准出。GIT28
在 HEAD `484ddf39d7e3bb881dd3d3cbaec775bd091c220d` 加精确 14 路径 staged patch 的 detached tree 中验证：
observability `8/8` + scenario `7/7`、Web/Svelte types、root test types、Classic test types、staged TS ESLint、
editable Prettier 与 scoped diff 均 PASS；代码/tests/contracts/spec 提交为
`3df61d38b0b0de55c48ab709afd6315aa9f23ff2`。历史 oracle Classic-types FAIL 不改写，由本组合新证据说明阻塞关闭。
当前 Browser/Cua/devserver/CI 未运行，death/durability-1/drop/respawn 均 `NOT OBSERVED`；铁甲四槽抽样不代表 16
件护甲、194 项矩阵或完整 V2 GREEN。GIT28 证据/state 提交 `00009bf26c821d115264d224899dafde0d6cc163`、
BUILD04 evidence 提交 `a47d50c1a2c10f97952c454bb1b58b3a4a373af5` 均已推送。

### V2-ARTIFACT-BUILD-04

状态：PASS。已推送 source `00009bf26c821d115264d224899dafde0d6cc163` 的 clean detached tree 中，唯一
`pnpm build` 与唯一 `pnpm harness:artifact` 均 PASS；sourceDigest `315820d6...2dff`、lockDigest
`44db46fb...1169`、artifactDigest `fc7ac005...f6e2`，276 项 receipt map 与磁盘一致。tree/dist 保留供 root 后续唯一
Browser；本阶段未运行 Browser/Cua/CI，不能外推为装备旅程或完整 V2 GREEN。

### V1-DOOR-EXIT-FACE-CLOSE-01/02 / GIT-29-DOOR-EXIT-FACE

状态：REMOTE_DELIVERED。Browser13 唯一 canonical attempt `ca001977-b334-4fbc-962f-254c2bc44a46` 在 V2
前失败：upper 关闭后，真实 eye 指向 lower center 的 180 次校正持续命中 upper，lower click 未发送；V2 全部
`NOT REACHED`，lease 已释放。ExitFace C1 从同一 door collision plan 推导出口侧 adjacent，并将原 traverse 落点参数收紧
为 `.06/.08/80ms`；C2 补齐三个到达点的生产 raycast 收敛反例。GIT29 在 HEAD `a47d50c1...` 加精确 6 路径
staged patch 的 detached tree 中验证 4 files / 38 tests、Classic/root test types、4 TS ESLint、6 路径 Prettier 与
scoped diff 均 PASS；代码/tests/spec/contract 提交为 `f5747f4944efa5cc28bf0e656a5efef748b0d584`，evidence/state
提交为 `0a0a63188805f0a7d96221a841e2b6292fa97205`，均已推送。Browser14、Cua、CI 未运行；本阶段不宣称
Structure 拒绝、V2 defect 或产品 GREEN。

### V2-ARTIFACT-BUILD-05

状态：PASS。已推送 source `0a0a63188805f0a7d96221a841e2b6292fa97205` 的 clean detached tree 中，唯一
`pnpm build` 与唯一 `pnpm harness:artifact` 均 PASS；sourceDigest `c86e6471...4bc2`、lockDigest
`44db46fb...1169`、artifactDigest `fc7ac005...f6e2`，276 项 receipt map 与磁盘一致。tree/dist 保留供 root 后续唯一
Browser14；本阶段未运行 Browser/Cua/CI，不外推为门出口或装备产品 GREEN。

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
