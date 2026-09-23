# 交付快照

日期：2026-09-23。状态：代码、本地验收与独立审阅完成；最终 exact-head 远端 Chromium 仍在收尾。

## 已实现

- Pack 注册并冻结 namespaced voxel semantics；紧凑 `Uint16` storage ID、solid/targetable/renderable、光照、mesh kind、六面材质和 render category 由同一 registry 投影到 Authority、Gameplay、Browser、TS/Rust/Wasm mesh 与块光。
- actor archetype 改为有界字符串；Pack actor profile registry 是组合世界的唯一准入，旧 Classic 名称作为明确 legacy alias。
- presentation JSON 与每个外部 texture/model/icon 都必须在 Pack resource lock 中，经过同源、路径、大小、schema 与 SHA-256 校验；Blob URL 在失败和 Application 销毁时释放。
- Authority、compute、persistence Worker 各自从同一个已锁定 Pack 组装 worldgen provider；provider identity 在任务与存档边界复核，旧存档兼容规则由 provider 自己声明。
- host-owned `host-admissions.json` 在 ESM 执行前批准 Playbook/extension 的 exact identity、integrity 与权限；stdlib/Web 不枚举替代 Playbook ID。
- `sample:modular-world` 只经公开 API 提供 storageId 500、发光/碰撞、actor、worldgen 与 presentation，构成无 Classic 内容依赖的第二 Playbook。
- 旧“94%”停止使用；`classic-progress-ledger.mjs` 只按本 change 冻结任务与证据核销，未全部完成时拒绝 100%。

## 本地证据

- `pnpm verify:static:ci`：PASS；远端首轮 `Architecture static checks`、`Deterministic module tests` 与 `Production build` 通过。
- `pnpm test:deterministic:ci`：Kernel 28/28、stdlib 606/606 PASS。
- 定向 Web：Pack loader/admission、presentation、第二 Playbook、compute/persistence、actor/mesh 共 45+ 项 PASS；Wasm mesh equivalence 6/6 PASS。
- Rust：`world-kernels` 12/12 PASS；`world-kernels-wasm` crate PASS；`pnpm wasm:rust:build` fingerprint PASS。
- 第二 Playbook production smoke：唯一 `classic-runtime.spec.ts`，production WebGL2 artifact 启动、storageId 500 可见、保存移除并重开仍为 0、无 page/network error，PASS。
- Classic production：同一 artifact 的 C0–C5 与视觉回归 2/2 PASS；run `d26e60e3-3313-4388-9229-e947b431e2bb`，`sourceDigest=ad9a32c9c0443c86fb571293427c7d93b35043409f8fdb17675e18e35888539a`，`artifactDigest=17beb0c47357a03c42daf21d3a3c25574b690abb38a4601c2e5f54412b76d349`，279 files。
- 第二 Playbook production smoke：`SEEDLANDS_PLAYBOOK=modular-world` 的 artifact 使用同一 `sourceDigest=ad9a32c9…`，`artifactDigest=977b79af9d0623056fc4fcd06b0cc55a6e259d7d3505471b1bf7578359d631a1`；唯一 Playwright spec 的定向 smoke 1/1 PASS，包含保存、reload 与同一 storageId 读回。
- 远端首轮 `Classic headless contracts` 因两个测试 fixture 未同步新增 presentation resource receipt 而失败；生产路径无同类问题。fixture 已修，完整 `pnpm test:classic:headless` 23 files / 62 tests PASS，等待新 head 的远端重跑。
- exact-head `204c116f` 的 run `35796243829` 中静态、确定性、Classic headless、production build 与视觉回归通过；C0–C5 在 hosted SwiftShader 低采样率下暴露 Harness 固定方向越过精确坐标仍持续按键、以及只接受瞬时 `streamCenter === 1` 的验收缺陷。修复保留真实键盘输入，以“进入容差或沿路线越过且未横向偏离”释放按键，并把跨 Chunk 完成边界绑定到 `streamCenter >= 1`、Authority 新 ack、落地且无碰撞。纯逻辑反例 2/2 PASS；当前工作树重新生产构建后，唯一 Classic spec 为 C0–C5 与视觉 2 passed、第二 Playbook 按 Classic artifact 预期 skipped。
- exact-head `0c774fb` 的 run `35798257813` 再次通过五个非浏览器门禁与视觉回归；C1 两次通过，C2 trace 显示真实转向留下 0.934 格横向偏移，测试把 0.65 格到点半径误作越界后的走廊宽度，持续后退至离开加载碰撞。到点半径保持 0.65，只有已沿 x 越过目标时使用 1.5 格路线走廊；超出走廊仍失败。
- exact-head `0bf8c83` 的 run `35799448730` 再次通过五个非浏览器门禁与视觉回归；C2 后退步骤已通过，但目标卡持续为空。失败 snapshot 显示玩家安全落地于 `[28.78, 61.6, 1.37]`，距离首个资源仍约 5.8 格；根因是既有 `adjustPitchToTarget` 只修正俯仰，无法消除 C1 真实水平转向残差。Harness snapshot 新增 controller 的只读 `viewAngles`，瞄准仍只发送真实 Pointer Lock 鼠标输入，并以玩家位置、当前角度和目标中心计算有界 dx/dy。
- 同一只读角度证据也用于战斗前把真实鼠标对准敌对实体中心；此前战斗 helper 直接沿用采矿后的向下视角，失败 snapshot 为 `yaw=-73.1, pitch=-47.2`，因此没有产生任何第一击或连击反馈。
- 本地验证确认战斗恢复后，下一次前往工作台仍继承战斗 yaw；`walkTo` 因此在每段路线开始前以真实水平鼠标输入重新对准目标方向（S 则背向目标），不再假设采矿/战斗后的 yaw 自动回到 x 轴。
- 方块瞄准保留 target-card 的可见面反馈：已有命中时按相邻面的高低小步修正，完全脱靶时才用只读 view angle 重获目标，避免对地板目标的中心射线被前一格地板遮挡。
- exact-head `1dbf0e5` 的 run `35802234986` 五个非浏览器门禁与视觉回归通过，但 C1 两次停在固定 `moveMouseBy(-80)` 后等待跨 Chunk；该段此前是唯一未复用通用路线对准的移动。初次 `+80px` 仍用于证明真实转向，随后按当前 yaw 与 chunk 目标计算真实鼠标纠偏，再执行 W+Space。
- exact-head `57ba2dc` 的 run `35803402652` 中 C1 已连续通过，但 failure snapshot 均显示 C2 开始时玩家已落到 y=19：旧 C1 把“观察到 streamCenter >= 1”与“释放按键”分开，低采样时可能跑过 224 格高架后才观测到跨 Chunk，随后在自然地形落地仍误判 C1 完成。C1 现直接复用 `walkTo(chunkCrossing)`，到 x≈33 即释放 W/Space，并额外断言仍位于高架高度。
- exact-head `a6c4c69` 的 run `35804761595` 证明单次 `walkTo` 在 hosted 低采样下仍可能因横向误差持续按键直至离开高架。`walkTo` 改为最多约 4 格一段的真实输入：每段重新对准，按键至实际到达或位移上限，释放后等待 Authority ack 与落地，并在支持面下降超过 2 格时立即失败；长途路线仍由真实 Pointer Lock/键盘完成。
- exact-head `8eba636` 的 run `35805790662` 全绿：Architecture static checks、Deterministic module tests、Classic headless contracts、Production build、Static verification 与 Chromium regression 全部 success；Chromium 7m29s，消费同次 identified production artifact。冻结 ledger 的 10/10 权重项均已核销。
- 后续纯文档 head `76980c8` 的 run `35806500887` 再次在 C1 暴露长按输入与主线程 snapshot 延迟的竞态，因此撤回完成核销。路线输入现改为测试进程计时的 300ms 真实 keydown/keyup 脉冲；固定时长只界定输入，不充当就绪条件，每段仍以 Authority ack、落地、位置和支持面状态验收。
- 本地短脉冲回归曾在第五次采集得到正确 target-card 但 `interactionAttempts=0`；真实鼠标采集/攻击现在先确认 Pointer Lock，采集还要求 interactionAttempts 前进后才等待体素结果，区分输入未送达与玩法未完成。
- hosted trace 证明失败集中在 C1 的 32 格长途移动，而 C4 已独立覆盖长途 streaming；不保留会改变低帧率正常长按语义的 Authority 输入租约。C1 固定起点改到 chunk 边界前 3.5 格，仍以真实转向、W+Space、Authority ack 和跨 Chunk 状态验收，不再把长途压力混入输入正确性阶段。
- exact-head `1743d13` 的 failure snapshot 首轮只有 5 个资源写入（`mutationCount=5`），说明 fixture 没有区分原子 no-op 与准备失败。fixture 准备现要求每次写入返回明确 `WorldCommitResult` 且没有失败 `reason`，并在 C1 前同时验证 `[31,59,0]`、`[32,59,0]` 的 Authority 与派生体素均为 Stone。
- 本地 fail-closed 首跑确认 air fill 可合法返回 `committed:false` 且无 `reason`（目标区原本已为空气）；fixture 因而拒绝缺失结果和 `chunk-unavailable`，但接受原子 no-op，最终状态仍由 C1 前 Authority/派生体素读回验收。
- 修正后本地 production journey run `30bdd385-7fa6-4ddc-bdaf-c5dbb704ef71` 一次通过 C0–C5 与视觉回归（2 passed、第二 Playbook 定向 smoke 按 Classic artifact 预期 skipped）；本次 artifact `sourceDigest=6d159e6665df34933df30a6aab7e99ba1980c264001bb2f5b83c60b94a6ba6b8`、`artifactDigest=985882ab3bcede946eb0638a27a2c4b395dc64c126c1c9bfbe7f1d7292f5c781`。因执行时修复尚未提交，该记录只作为 pre-commit 验证，提交后仍重建并重跑 exact-head。
- exact-head `2c8c9837` 的本地 production journey run `cc841e1d-0631-480e-bc60-9ee0eb9f5b1e` 单 attempt 通过；远端 run `35818671971` 两次均在 fixture floor 明确返回 `chunk-unavailable`，证明 hosted worldgen 在写入前尚未准备完长条 fixture 覆盖的全部 Chunk。fixture 现通过公开 `world.prepare({ kind: 'chunks' })` 一次性预热并核对完整 key 集合，再执行原子 fill；不以重试 mutation 掩盖部分提交。
- Authority 预热版本的本地 production journey run `09c93cff-6956-4200-b9c9-89f00bf43448` 单 attempt 通过 C0–C5 与视觉回归；`sourceDigest=e6d4aaf2d0b474e4834b9e27879dfabd0dd7f1e9571663deddbd99b4f736e001`。因预热修复尚未提交，该记录只作为 pre-commit 验证。
- exact-head `7bd90fdd` 的远端 run `35819877376` 已证明 fixture 预热和 C0/C1 稳定通过；首 attempt 在第三个资源前停于 `x=37.56`，距目标中心超过 5 格，retry 在 C3 刚放置方块前只首段跳跃并耗尽路线预算。采集 helper 现先以真实输入进入目标前固定工作距离、确认 Pointer Lock 后重新瞄准；跳跃路线的每个短脉冲都同时发送 Space，以跨越路线中新放置的障碍。
- 真实输入 helper 修正后的本地 production journey run `0e43da65-76f9-4c32-9bcb-85c090864d32` 单 attempt 通过 C0–C5 与视觉回归；在较低采样下 C4 用时 2.4 分钟仍由原有 90 秒双向分段预算完成。`sourceDigest=7d6cf11693b23f74d8e73d8d1477b9a4a8f02d612f12750ccf184423b629b2f3`，因修复尚未提交，只作 pre-commit 验证。
- exact-head `e8cb6d38` 的远端 run `35821592336` 已稳定通过 fixture、C0/C1，并分别推进到 C2/C3；failure snapshot 表明原“太近即后退”策略把首个资源从约 1.5 格退到 5 格外，工作台采集同样因进入点过冲而失去目标。采集现只在实际三维距离超过 4.5 格时向前接近，且在瞄准前显式确认不超过玩法 5 格交互范围。
- 帧同步目标获取版本的本地 production journey run `605bc82a-2c61-469e-898d-fc829f79a445` 单 attempt 通过 C0–C5 与视觉回归；鼠标 primitive 拆到独立 helper，每次 Pointer Lock 移动后等待两个渲染帧再读 target-card。`sourceDigest=68928292a182fc02bb7ef5e959d136fcb3538cc48256014c140bf5839dbcfb7b`，因修复尚未提交，只作 pre-commit 验证。
- exact-head `d5fe8e7f` 本地首次运行确认方块已破坏但掉落被立即拾取（`worldItemCount=0`、`inventoryOperationCount=1`），旧断言只接受仍可见的掉落实体而误报；修正为“世界中可见掉落或同物品库存已增加”，且后续库存增长断言不变。修正后的本地 run `46b031e5-5d95-48fe-b5ac-e40beb46561e` 单 attempt 通过 C0–C5 与视觉回归。
- exact-head `4d9fa4c7` 的远端 run `35824579338` 首 attempt 已通过 C0–C5，后续恢复交互在支撑方块外 5 格瞄准失败；retry 则站在首个资源上方并在相邻面间振荡。近距定位现用 100ms 真实输入脉冲进入 2.5–5 格工作带，默认路线仍为 300ms；C5 恢复后显式回到既有 stationApproach。修正后的本地 run `d08eeb88-bebe-4924-bf9c-72d568aae828` 单 attempt 通过完整 journey 与视觉回归。

## 独立审阅

审阅 `830e26f7..cb5d3ef` 发现两个 P1：voxel 注册上限高于 mesh lookup，以及 presentation 资源在完整分配后才校验大小。修复提交 `312119b` 将注册上限统一为 0–4095，并改为流式 1 MiB 限额读取；精确复审 `cb5d3ef..312119b` 确认两项关闭，未发现新 P0/P1/P2。初次大 diff 审阅覆盖关键高风险切片而非 150 个文件逐行穷尽；修复范围复审完整。

## 证据边界

- 第二 Playbook smoke 是启动/worldgen/mesh/presentation/persistence 的有界证明，不宣称其具备 Classic 完整内容旅程。
- 当前 material slot 固定为 1–92；外部 voxel topology 支持 cube/water/glass/ice。Pack 自定义 model geometry 尚未纳入本期，装配时显式拒绝。
- V1 注册 storageId 为 0–4095，与有界 mesh semantics lookup 一致；底层 Chunk 存储继续使用 Uint16，不重解释 Classic bytes。
- 未宣称性能提升，因此没有新增性能 A/B。远端 CI 与 PR gate 在推送后读回。

## 文档与预算

长期 `docs/code-map.md` 已更新，因为 registry、Worker Pack loader、host admission 与 presentation 生命周期是跨 change 复用的职责边界。用户目标、实现假设、验收分层和 V1 限制保存在本 change spec。传统估算维持 12–20 PD；Agent 实际 credits/token/API 等价费用与额度分母不可得，记 unknown，不伪造为 0。
