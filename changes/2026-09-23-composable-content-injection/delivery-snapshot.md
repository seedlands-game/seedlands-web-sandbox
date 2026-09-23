# 交付快照

日期：2026-09-23。状态：Complete；代码、本地验收、独立审阅与 exact-head 远端 CI 全部完成。

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

## 独立审阅

审阅 `830e26f7..cb5d3ef` 发现两个 P1：voxel 注册上限高于 mesh lookup，以及 presentation 资源在完整分配后才校验大小。修复提交 `312119b` 将注册上限统一为 0–4095，并改为流式 1 MiB 限额读取；精确复审 `cb5d3ef..312119b` 确认两项关闭，未发现新 P0/P1/P2。初次大 diff 审阅覆盖关键高风险切片而非 150 个文件逐行穷尽；修复范围复审完整。

## 证据边界

- 第二 Playbook smoke 是启动/worldgen/mesh/presentation/persistence 的有界证明，不宣称其具备 Classic 完整内容旅程。
- 当前 material slot 固定为 1–92；外部 voxel topology 支持 cube/water/glass/ice。Pack 自定义 model geometry 尚未纳入本期，装配时显式拒绝。
- V1 注册 storageId 为 0–4095，与有界 mesh semantics lookup 一致；底层 Chunk 存储继续使用 Uint16，不重解释 Classic bytes。
- 未宣称性能提升，因此没有新增性能 A/B。远端 CI 与 PR gate 在推送后读回。

## 文档与预算

长期 `docs/code-map.md` 已更新，因为 registry、Worker Pack loader、host admission 与 presentation 生命周期是跨 change 复用的职责边界。用户目标、实现假设、验收分层和 V1 限制保存在本 change spec。传统估算维持 12–20 PD；Agent 实际 credits/token/API 等价费用与额度分母不可得，记 unknown，不伪造为 0。
